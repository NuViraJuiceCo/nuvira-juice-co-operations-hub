import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

const FUNCTION_NAME = 'previewSubscriptionFulfillmentProductionStatusForCustomerApp';
const PROPOSED_FULFILLMENT_STATUS = 'packaged';

const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'batch_id',
  'hub_order_id',
  'fulfillment_task_id',
  'fulfillment_number',
  'production_date',
  'delivery_date',
  'expected_task_status',
  'expected_fulfillment_status',
  'request_id',
]);

const TERMINAL_TASK_STATUSES = new Set(['Completed', 'Unable To Deliver', 'Cancelled']);
const TERMINAL_FULFILLMENT_STATUSES = new Set(['delivered', 'cancelled', 'canceled']);
const SECRET_OR_AUTH_KEY_PATTERN = /(secret|token|api[_-]?key|apikey|auth|authorization|bearer|credential|password|private[_-]?key|access[_-]?key|refresh[_-]?token|session[_-]?token|webhook[_-]?secret)/i;
const PROOF_DROP_KEY_PATTERN = /(proof|photo|drop|delivery_photo|delivery_drop)/i;
const PROVIDER_PAYMENT_KEY_PATTERN = /(payment_intent|charge|checkout_session|stripe_|shopify_|provider|refund|invoice)/i;

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeSingleLine(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function normalizeLower(value) {
  return normalizeSingleLine(value).toLowerCase();
}

function sanitizeText(value, maxLength = 160) {
  const text = normalizeSingleLine(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl)\b/gi, '[redacted address]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]');

  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function safeError(error, errorCode, message = error) {
  return {
    error: sanitizeText(error, 180),
    error_code: sanitizeText(errorCode, 80),
    message: sanitizeText(message, 220),
  };
}

function findUnsupportedBodyKey(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const key of Object.keys(body)) {
    if (!ALLOWED_BODY_KEYS.has(normalizeLower(key))) return key;
  }
  return null;
}

function normalizeId(value, fieldName, required = true) {
  const text = normalizeSingleLine(value);
  if (!text) {
    if (required) throw new Error(`${fieldName} is required`);
    return '';
  }
  if (text.length > 180 || !/^[A-Za-z0-9._:@/-]+$/.test(text)) {
    throw new Error(`${fieldName} contains unsupported characters`);
  }
  return text;
}

function normalizeDate(value, fieldName) {
  const text = normalizeSingleLine(value);
  if (!text) throw new Error(`${fieldName} is required`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${fieldName} must be YYYY-MM-DD`);
  }
  return text;
}

function normalizeFulfillmentNumber(value) {
  const text = normalizeSingleLine(value);
  if (!text) throw new Error('fulfillment_number is required');
  const numberValue = Number(text);
  if (!Number.isInteger(numberValue) || numberValue < 1 || numberValue > 52) {
    throw new Error('fulfillment_number must be a positive integer');
  }
  return numberValue;
}

function normalizeOptionalStatus(value, fieldName) {
  const text = normalizeSingleLine(value);
  if (!text) return '';
  if (text.length > 80 || !/^[A-Za-z0-9._ -]+$/.test(text)) {
    throw new Error(`${fieldName} contains unsupported characters`);
  }
  return text;
}

function collectBatchOrderIds(batch) {
  const orderSourceIds = (Array.isArray(batch?.order_sources) ? batch.order_sources : [])
    .map((source) => normalizeSingleLine(source?.order_id))
    .filter(Boolean);
  const relatedOrderIds = (Array.isArray(batch?.related_orders) ? batch.related_orders : [])
    .map((orderId) => normalizeSingleLine(orderId))
    .filter(Boolean);
  return new Set([...orderSourceIds, ...relatedOrderIds]);
}

function readShallowKeyRisk(value, patterns, maxDepth = 2) {
  const seen = new Set();
  const stack = [{ value, depth: 0 }];

  while (stack.length > 0) {
    const item = stack.pop();
    if (!item || !item.value || typeof item.value !== 'object') continue;
    if (seen.has(item.value)) continue;
    seen.add(item.value);

    if (Array.isArray(item.value)) {
      if (item.depth >= maxDepth) continue;
      for (const child of item.value) stack.push({ value: child, depth: item.depth + 1 });
      continue;
    }

    for (const [key, child] of Object.entries(item.value)) {
      if (patterns.some((pattern) => pattern.test(key))) return true;
      if (child && typeof child === 'object' && item.depth < maxDepth) {
        stack.push({ value: child, depth: item.depth + 1 });
      }
    }
  }

  return false;
}

function safeFulfillmentSummary(fulfillment) {
  return {
    fulfillment_number: fulfillment?.fulfillment_number ?? null,
    current_status: sanitizeText(fulfillment?.status, 80) || null,
    production_date: sanitizeText(fulfillment?.production_date, 40) || null,
    delivery_date: sanitizeText(fulfillment?.delivery_date || fulfillment?.scheduled_date, 40) || null,
    item_count: Array.isArray(fulfillment?.items) ? fulfillment.items.length : 0,
  };
}

async function findOneById(entity, id) {
  const rows = await entity.filter({ id }, '-updated_date', 2);
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

Deno.serve(async (req) => {
  try {
    if (!SYNC_SECRET) {
      return Response.json(safeError('Unauthorized', 'unauthorized'), { status: 401 });
    }

    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ') || authHeader !== `Bearer ${SYNC_SECRET}`) {
      return Response.json(safeError('Unauthorized', 'unauthorized'), { status: 401 });
    }

    if (req.method !== 'POST') {
      return Response.json(safeError('Method not allowed', 'method_not_allowed'), { status: 405 });
    }

    const body = await req.json().catch(() => ({}));
    const unsupportedKey = findUnsupportedBodyKey(body);
    if (unsupportedKey) {
      return Response.json(safeError(`Unsupported field: ${unsupportedKey}`, 'unsupported_field'), { status: 400 });
    }

    let productionBatchId;
    let batchId;
    let hubOrderId;
    let fulfillmentTaskId;
    let fulfillmentNumber;
    let productionDate;
    let deliveryDate;
    let expectedTaskStatus;
    let expectedFulfillmentStatus;
    let requestId;

    try {
      productionBatchId = normalizeId(body.production_batch_id, 'production_batch_id');
      batchId = normalizeId(body.batch_id, 'batch_id');
      hubOrderId = normalizeId(body.hub_order_id, 'hub_order_id');
      fulfillmentTaskId = normalizeId(body.fulfillment_task_id, 'fulfillment_task_id');
      fulfillmentNumber = normalizeFulfillmentNumber(body.fulfillment_number);
      productionDate = normalizeDate(body.production_date, 'production_date');
      deliveryDate = normalizeDate(body.delivery_date, 'delivery_date');
      expectedTaskStatus = normalizeOptionalStatus(body.expected_task_status, 'expected_task_status');
      expectedFulfillmentStatus = normalizeOptionalStatus(body.expected_fulfillment_status, 'expected_fulfillment_status');
      requestId = normalizeId(body.request_id, 'request_id', false);
    } catch (error) {
      return Response.json(safeError(error.message, 'invalid_input'), { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const [batch, order, task] = await Promise.all([
      findOneById(base44.asServiceRole.entities.ProductionBatch, productionBatchId),
      findOneById(base44.asServiceRole.entities.ShopifyOrder, hubOrderId),
      findOneById(base44.asServiceRole.entities.FulfillmentTask, fulfillmentTaskId),
    ]);

    const blockers = [];
    const warnings = [];

    if (!batch) blockers.push('batch_not_found');
    if (!order) blockers.push('order_not_found');
    if (!task) blockers.push('fulfillment_task_not_found');

    const currentBatchId = normalizeSingleLine(batch?.batch_id);
    const batchStatus = normalizeSingleLine(batch?.status);
    const batchOrderIds = batch ? collectBatchOrderIds(batch) : new Set();
    const taskOrderId = normalizeSingleLine(task?.order_id);
    const taskStatus = normalizeSingleLine(task?.status);
    const taskProductionDate = normalizeSingleLine(task?.production_date);
    const taskDeliveryDate = normalizeSingleLine(task?.scheduled_date || task?.delivery_date);
    const taskFulfillmentNumber = Number(task?.fulfillment_number);
    const orderType = normalizeLower(order?.order_type);
    const fulfillmentMode = normalizeLower(order?.fulfillment_mode);
    const parentProductionStatus = normalizeSingleLine(order?.production_status);

    if (batch && currentBatchId !== batchId) blockers.push('batch_id_mismatch');
    if (batch && batchStatus !== 'verified_logged') blockers.push('batch_not_verified_logged');
    if (batch && batch.is_locked !== true) blockers.push('batch_not_locked');
    if (batch && (!batch.verified_at || !batch.verified_by || !batch.compliance_log_id)) {
      blockers.push('missing_verification_metadata');
    }

    if (order) {
      if (orderType !== 'subscription' && fulfillmentMode !== 'multi_delivery') {
        blockers.push('order_not_subscription_multi_delivery');
      }
      if (normalizeSingleLine(order.id) !== hubOrderId) blockers.push('parent_order_mismatch');
    }

    if (task) {
      if (taskOrderId !== hubOrderId) blockers.push('task_order_mismatch');
      if (batchOrderIds.size > 0 && !batchOrderIds.has(taskOrderId)) blockers.push('task_not_linked_to_batch');
      if (taskFulfillmentNumber !== fulfillmentNumber) blockers.push('task_fulfillment_number_mismatch');
      if (taskProductionDate !== productionDate) blockers.push('task_production_date_mismatch');
      if (taskDeliveryDate !== deliveryDate) blockers.push('task_delivery_date_mismatch');
      if (expectedTaskStatus && taskStatus !== expectedTaskStatus) blockers.push('expected_task_status_mismatch');
      if (taskStatus !== 'Packed') {
        blockers.push(TERMINAL_TASK_STATUSES.has(taskStatus)
          ? 'terminal_task_status'
          : 'task_not_packed');
      }
    }

    const fulfillments = Array.isArray(order?.fulfillments) ? order.fulfillments : [];
    const matchingFulfillments = fulfillments.filter((fulfillment) => {
      const numberMatches = Number(fulfillment?.fulfillment_number) === fulfillmentNumber;
      const productionMatches = normalizeSingleLine(fulfillment?.production_date) === productionDate;
      const deliveryMatches = normalizeSingleLine(fulfillment?.delivery_date || fulfillment?.scheduled_date) === deliveryDate;
      return numberMatches && productionMatches && deliveryMatches;
    });

    const fulfillment = matchingFulfillments[0] || null;
    const currentFulfillmentStatus = normalizeSingleLine(fulfillment?.status);

    if (order && fulfillments.length === 0) blockers.push('order_fulfillments_missing');
    if (matchingFulfillments.length === 0) blockers.push('fulfillment_occurrence_not_found');
    if (matchingFulfillments.length > 1) blockers.push('multiple_fulfillment_occurrence_matches');
    if (fulfillment && expectedFulfillmentStatus && currentFulfillmentStatus !== expectedFulfillmentStatus) {
      blockers.push('expected_fulfillment_status_mismatch');
    }
    if (fulfillment && TERMINAL_FULFILLMENT_STATUSES.has(normalizeLower(currentFulfillmentStatus))) {
      blockers.push('terminal_fulfillment_status');
    }
    if (fulfillment && currentFulfillmentStatus === PROPOSED_FULFILLMENT_STATUS) {
      warnings.push('fulfillment_already_packaged');
    }

    const unsafeKeyRisk = readShallowKeyRisk(order, [SECRET_OR_AUTH_KEY_PATTERN], 2) ||
      readShallowKeyRisk(fulfillment, [SECRET_OR_AUTH_KEY_PATTERN], 2) ||
      readShallowKeyRisk(task, [SECRET_OR_AUTH_KEY_PATTERN], 1);
    const proofDropRisk = readShallowKeyRisk(fulfillment, [PROOF_DROP_KEY_PATTERN], 1) ||
      readShallowKeyRisk(task, [PROOF_DROP_KEY_PATTERN], 1);
    const providerPaymentRisk = readShallowKeyRisk(fulfillment, [PROVIDER_PAYMENT_KEY_PATTERN], 1);

    if (unsafeKeyRisk) blockers.push('secret_or_auth_field_present');
    if (proofDropRisk) blockers.push('proof_drop_out_of_scope');
    if (providerPaymentRisk) blockers.push('provider_payment_fields_present');
    if (order?.stripe_subscription_id || task?.stripe_subscription_id) warnings.push('subscription_provider_linkage_present');

    warnings.push('parent_order_status_will_not_change');
    warnings.push('customer_app_status_sync_deferred');
    warnings.push('notifications_deferred');

    const uniqueBlockers = [...new Set(blockers)];
    const uniqueWarnings = [...new Set(warnings)];
    const liveAllowed = uniqueBlockers.length === 0 && currentFulfillmentStatus !== PROPOSED_FULFILLMENT_STATUS;

    return Response.json({
      success: true,
      dry_run: true,
      function_name: FUNCTION_NAME,
      production_batch_id: productionBatchId,
      batch_id: sanitizeText(batchId, 180),
      hub_order_id: sanitizeText(hubOrderId, 180),
      fulfillment_task_id: sanitizeText(fulfillmentTaskId, 180),
      fulfillment_number: fulfillmentNumber,
      production_date: sanitizeText(productionDate, 40),
      delivery_date: sanitizeText(deliveryDate, 40),
      request_id: requestId ? sanitizeText(requestId, 180) : null,
      current_batch_status: sanitizeText(batchStatus, 80) || null,
      parent_order_type: sanitizeText(orderType, 80) || null,
      parent_fulfillment_mode: sanitizeText(fulfillmentMode, 80) || null,
      parent_production_status: sanitizeText(parentProductionStatus, 80) || null,
      parent_status_will_change: false,
      current_task_status: sanitizeText(taskStatus, 80) || null,
      current_fulfillment_status: sanitizeText(currentFulfillmentStatus, 80) || null,
      proposed_task_status: sanitizeText(taskStatus, 80) || null,
      proposed_fulfillment_status: liveAllowed ? PROPOSED_FULFILLMENT_STATUS : null,
      task_linked_to_batch: task && (batchOrderIds.size === 0 || batchOrderIds.has(taskOrderId)),
      fulfillment_match_count: matchingFulfillments.length,
      fulfillment_summary: fulfillment ? safeFulfillmentSummary(fulfillment) : null,
      customer_facing_status_will_change: false,
      status_history_will_change: false,
      notifications_will_send: false,
      projected_writes_if_approved: [
        'ShopifyOrder.fulfillments[].status',
        'HubCommandLog',
      ],
      live_allowed: liveAllowed,
      blockers: uniqueBlockers,
      warnings: uniqueWarnings,
    });
  } catch (error) {
    console.error(`[${FUNCTION_NAME}] Error`);
    return Response.json(safeError('Unable to preview subscription fulfillment production status', 'internal_error'), { status: 500 });
  }
});
