import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const ENABLE_REAL_BOTTLE = Deno.env.get('ENABLE_VERIFY_ORDER_BOTTLED_CASCADE') === 'true';
const ALLOWED_EMAILS = Deno.env.get('VERIFY_ORDER_BOTTLED_ALLOWED_EMAILS') || '';
const BATCH_ALLOWLIST = Deno.env.get('VERIFY_ORDER_BOTTLED_BATCH_ALLOWLIST') || '';
const ORDER_ALLOWLIST = Deno.env.get('VERIFY_ORDER_BOTTLED_ORDER_ALLOWLIST') || '';

const FUNCTION_NAME = 'bottleProductionVerifyShopifyOrderForCustomerApp';
const COMMAND = 'production_verify_shopify_order_bottled';
const TARGET_TYPE = 'ShopifyOrder';
const SOURCE = 'customer_app_admin';
const COMMAND_SOURCE = 'customer_app';
const PROJECTED_STATUS = 'bottled';

const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'batch_id',
  'expected_status',
  'shopify_order_id',
  'expected_production_status',
  'request_id',
  'reason',
  'actor_email',
  'actor_role',
  'source',
]);

const TERMINAL_ORDER_STATUSES = new Set(['fulfilled', 'canceled', 'cancelled', 'refunded']);
const NON_BOTTLEABLE_ORDER_STATUSES = new Set([
  ...TERMINAL_ORDER_STATUSES,
  PROJECTED_STATUS,
]);

const SECRET_OR_AUTH_KEY_PATTERN = /(secret|token|api[_-]?key|apikey|auth|authorization|bearer|credential|password|private[_-]?key|access[_-]?key|refresh[_-]?token|session[_-]?token|webhook[_-]?secret)/i;
const PROOF_DROP_KEY_PATTERN = /(proof|photo|drop|delivery_photo|delivery_drop)/i;
const RAW_PAYLOAD_KEY_PATTERN = /(raw|payload|webhook|event_body|request_body|response_body)/i;

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

function normalizeStatus(value, fieldName) {
  const text = normalizeSingleLine(value);
  if (!text) throw new Error(`${fieldName} is required`);
  if (text.length > 80 || !/^[A-Za-z0-9._ -]+$/.test(text)) {
    throw new Error(`${fieldName} contains unsupported characters`);
  }
  return text;
}

function findUnsupportedBodyKey(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const key of Object.keys(body)) {
    if (!ALLOWED_BODY_KEYS.has(normalizeLower(key))) return key;
  }
  return null;
}

function parseEmailAllowlist(value) {
  return new Set(value.split(',').map(normalizeLower).filter(Boolean));
}

function parseIdAllowlist(value) {
  return new Set(value.split(',').map(normalizeSingleLine).filter(Boolean));
}

function parseBatchAllowlist(value) {
  return new Set(
    value.split(',')
      .map(normalizeSingleLine)
      .filter(Boolean)
      .filter((entry) => entry.includes(':')),
  );
}

function isBatchAllowlisted(productionBatchId, batchId) {
  return parseBatchAllowlist(BATCH_ALLOWLIST).has(`${productionBatchId}:${batchId}`);
}

function isOrderAllowlisted(orderId) {
  const allowlist = parseIdAllowlist(ORDER_ALLOWLIST);
  return allowlist.size > 0 && allowlist.has(orderId);
}

function collectOrderIds(batch) {
  const sourceIds = (Array.isArray(batch?.order_sources) ? batch.order_sources : [])
    .map((source) => normalizeSingleLine(source?.order_id))
    .filter(Boolean);
  const relatedIds = (Array.isArray(batch?.related_orders) ? batch.related_orders : [])
    .map((orderId) => normalizeSingleLine(orderId))
    .filter(Boolean);
  return new Set([...sourceIds, ...relatedIds]);
}

function hasShallowKeyRisk(value, patterns, maxDepth = 2) {
  const seen = new Set();
  const stack = [{ value, depth: 0 }];

  while (stack.length > 0) {
    const item = stack.pop();
    if (!item?.value || typeof item.value !== 'object') continue;
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

function commandId(requestId, orderId) {
  return `${COMMAND}:${TARGET_TYPE}:${orderId}:${requestId}`;
}

function buildNotes({
  requestId,
  productionBatchId,
  batchId,
  shopifyOrderId,
  orderNumber,
  previousProductionStatus,
  newProductionStatus,
  source,
  reason,
}) {
  return JSON.stringify({
    production_batch_id: sanitizeText(productionBatchId, 180),
    batch_id: sanitizeText(batchId, 180),
    shopify_order_id: sanitizeText(shopifyOrderId, 180),
    order_number: sanitizeText(orderNumber, 80) || null,
    previous_production_status: sanitizeText(previousProductionStatus, 80) || null,
    new_production_status: sanitizeText(newProductionStatus, 80) || null,
    source: sanitizeText(source, 80) || SOURCE,
    request_id: sanitizeText(requestId, 180),
    reason: sanitizeText(reason, 180) || null,
    cascade_type: 'shopify_order_bottled_only',
    customer_app_sync_deferred: true,
    notifications_deferred: true,
  });
}

function buildLogPayload({
  requestId,
  productionBatchId,
  batchId,
  shopifyOrderId,
  orderNumber,
  actorEmail,
  actorRole,
  previousProductionStatus,
  newProductionStatus,
  status,
  errorCode,
  errorMessage,
  reason,
  timestamp,
  durationMs,
}) {
  return {
    command_id: commandId(requestId, shopifyOrderId),
    command_type: COMMAND,
    command_source: COMMAND_SOURCE,
    status,
    target_entity: TARGET_TYPE,
    target_id: shopifyOrderId,
    target_display_id: orderNumber || shopifyOrderId,
    actor_email: actorEmail,
    actor_role: actorRole,
    actor_type: 'admin',
    idempotency_key: requestId,
    idempotent_skipped: status === 'skipped',
    submitted_at: timestamp,
    started_at: timestamp,
    completed_at: timestamp,
    duration_ms: durationMs,
    function_name: FUNCTION_NAME,
    notes: buildNotes({
      requestId,
      productionBatchId,
      batchId,
      shopifyOrderId,
      orderNumber,
      previousProductionStatus,
      newProductionStatus,
      source: SOURCE,
      reason,
    }),
    error_code: errorCode || null,
    error_message: errorMessage ? sanitizeText(errorMessage, 220) : null,
  };
}

async function findExistingCommandLog(base44, requestId, orderId) {
  const candidates = await base44.asServiceRole.entities.HubCommandLog.filter(
    { idempotency_key: requestId },
    '-created_date',
    20,
  ).catch(() => []);

  return (candidates || []).find((log) => (
    log.command_type === COMMAND &&
    log.target_entity === TARGET_TYPE &&
    log.target_id === orderId &&
    log.idempotency_key === requestId
  )) || null;
}

async function findOneById(entity, id) {
  const rows = await entity.filter({ id }, '-updated_date', 2);
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

function safeSuccessResponse({
  productionBatchId,
  batchId,
  shopifyOrderId,
  orderNumber,
  previousProductionStatus,
  productionStatus,
  requestId,
  skipped,
  updatedAt,
}) {
  return {
    success: true,
    production_batch_id: productionBatchId,
    batch_id: batchId,
    shopify_order_id: shopifyOrderId,
    order_number: orderNumber || null,
    previous_production_status: previousProductionStatus || null,
    production_status: productionStatus || null,
    request_id: requestId,
    skipped: skipped === true,
    updated_at: updatedAt || null,
    customer_app_sync_deferred: true,
    notifications_deferred: true,
    task_cascade_deferred: true,
  };
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  let base44 = null;
  let commandLog = null;
  let failureContext = null;

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!SYNC_SECRET || !authHeader.startsWith('Bearer ') || authHeader !== `Bearer ${SYNC_SECRET}`) {
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
    let expectedStatus;
    let shopifyOrderId;
    let expectedProductionStatus;
    let requestId;

    try {
      productionBatchId = normalizeId(body.production_batch_id, 'production_batch_id');
      batchId = normalizeId(body.batch_id, 'batch_id');
      expectedStatus = normalizeStatus(body.expected_status, 'expected_status');
      shopifyOrderId = normalizeId(body.shopify_order_id, 'shopify_order_id');
      expectedProductionStatus = normalizeStatus(body.expected_production_status, 'expected_production_status');
      requestId = normalizeId(body.request_id, 'request_id');
    } catch (error) {
      return Response.json(safeError(error.message, 'invalid_input'), { status: 400 });
    }

    const actorEmail = normalizeLower(body.actor_email);
    const actorRole = normalizeLower(body.actor_role);
    const source = normalizeSingleLine(body.source);
    const reason = sanitizeText(body.reason, 180);

    if (actorRole !== 'admin' || source !== SOURCE) {
      return Response.json(safeError('Actor is not allowed', 'actor_not_allowed'), { status: 403 });
    }

    const allowedEmails = parseEmailAllowlist(ALLOWED_EMAILS);
    if (!actorEmail || !allowedEmails.has(actorEmail)) {
      return Response.json(safeError('Actor is not allowed', 'actor_not_allowed'), { status: 403 });
    }

    if (!ENABLE_REAL_BOTTLE) {
      return Response.json(safeError('Order bottled cascade is not enabled', 'order_bottled_not_enabled'), { status: 409 });
    }

    if (!isBatchAllowlisted(productionBatchId, batchId)) {
      return Response.json(safeError('Batch is not allowlisted', 'batch_not_allowlisted'), { status: 409 });
    }

    if (!isOrderAllowlisted(shopifyOrderId)) {
      return Response.json(safeError('ShopifyOrder is not allowlisted', 'order_not_allowlisted'), { status: 409 });
    }

    base44 = createClientFromRequest(req);
    const existingLog = await findExistingCommandLog(base44, requestId, shopifyOrderId);
    if (existingLog) {
      if (existingLog.status === 'success' || existingLog.status === 'skipped') {
        return Response.json(safeSuccessResponse({
          productionBatchId,
          batchId,
          shopifyOrderId,
          orderNumber: null,
          previousProductionStatus: expectedProductionStatus,
          productionStatus: PROJECTED_STATUS,
          requestId,
          skipped: true,
          updatedAt: existingLog.completed_at || null,
        }));
      }

      return Response.json(safeError('Matching request is not safely replayable', 'idempotency_conflict'), { status: 409 });
    }

    const [batch, order] = await Promise.all([
      findOneById(base44.asServiceRole.entities.ProductionBatch, productionBatchId),
      findOneById(base44.asServiceRole.entities.ShopifyOrder, shopifyOrderId),
    ]);

    if (!batch) return Response.json(safeError('Batch not found', 'batch_not_found'), { status: 404 });
    if (!order) return Response.json(safeError('ShopifyOrder not found', 'order_not_found'), { status: 404 });

    const currentBatchStatus = normalizeSingleLine(batch.status);
    const currentBatchId = normalizeSingleLine(batch.batch_id);
    const currentProductionStatus = normalizeLower(order.production_status || order.status);
    const orderNumber = sanitizeText(order.shopify_order_number || order.order_number, 80);
    const orderType = normalizeLower(order.order_type);
    const fulfillmentMode = normalizeLower(order.fulfillment_mode);
    const linkedOrderIds = collectOrderIds(batch);

    if (currentBatchId !== batchId) {
      return Response.json(safeError('Batch id mismatch', 'batch_id_mismatch'), { status: 409 });
    }
    if (currentBatchStatus !== expectedStatus) {
      return Response.json(safeError('Expected status mismatch', 'expected_status_mismatch'), { status: 409 });
    }
    if (currentBatchStatus !== 'verified_logged') {
      return Response.json(safeError('Batch is not verified/logged', 'batch_not_verified_logged'), { status: 409 });
    }
    if (batch.is_locked !== true) {
      return Response.json(safeError('Batch is not locked after verification', 'batch_not_locked'), { status: 409 });
    }
    if (!batch.compliance_log_id || !batch.verified_at || !batch.verified_by) {
      return Response.json(safeError('Batch verification metadata is missing', 'missing_verification_metadata'), { status: 409 });
    }
    if (!linkedOrderIds.has(shopifyOrderId)) {
      return Response.json(safeError('ShopifyOrder is not linked to the batch', 'order_not_linked_to_batch'), { status: 409 });
    }
    if (currentProductionStatus !== normalizeLower(expectedProductionStatus)) {
      return Response.json(safeError('Expected production status mismatch', 'expected_production_status_mismatch'), { status: 409 });
    }
    if (orderType === 'subscription' || fulfillmentMode === 'multi_delivery') {
      return Response.json(safeError('Subscription or multi-delivery order is out of scope', 'subscription_order_out_of_scope'), { status: 409 });
    }
    if (Array.isArray(order.fulfillments) && order.fulfillments.length > 1) {
      return Response.json(safeError('Multi-fulfillment order is out of scope', 'multi_fulfillment_order_out_of_scope'), { status: 409 });
    }
    if (NON_BOTTLEABLE_ORDER_STATUSES.has(currentProductionStatus)) {
      const errorCode = currentProductionStatus === PROJECTED_STATUS
        ? 'order_already_bottled_conflict'
        : TERMINAL_ORDER_STATUSES.has(currentProductionStatus)
          ? 'terminal_order_status'
          : 'order_status_not_bottleable';
      return Response.json(safeError('ShopifyOrder is not bottleable', errorCode), { status: 409 });
    }

    if (hasShallowKeyRisk(order, [SECRET_OR_AUTH_KEY_PATTERN], 2)) {
      return Response.json(safeError('Secret or auth-like field is present', 'secret_or_auth_field_present'), { status: 409 });
    }
    if (hasShallowKeyRisk(order, [PROOF_DROP_KEY_PATTERN], 2)) {
      return Response.json(safeError('Proof/drop field is out of scope', 'proof_drop_out_of_scope'), { status: 409 });
    }
    if (hasShallowKeyRisk(order, [RAW_PAYLOAD_KEY_PATTERN], 2)) {
      return Response.json(safeError('Raw payload field is out of scope', 'raw_payload_out_of_scope'), { status: 409 });
    }

    const now = new Date().toISOString();
    const processingLogPayload = buildLogPayload({
      requestId,
      productionBatchId,
      batchId,
      shopifyOrderId,
      orderNumber,
      actorEmail,
      actorRole,
      previousProductionStatus: currentProductionStatus,
      newProductionStatus: PROJECTED_STATUS,
      status: 'processing',
      reason,
      timestamp: now,
      durationMs: 0,
    });

    failureContext = {
      requestId,
      productionBatchId,
      batchId,
      shopifyOrderId,
      orderNumber,
      actorEmail,
      actorRole,
      previousProductionStatus: currentProductionStatus,
      newProductionStatus: PROJECTED_STATUS,
      reason,
    };

    commandLog = await base44.asServiceRole.entities.HubCommandLog.create(processingLogPayload);

    await base44.asServiceRole.entities.ShopifyOrder.update(shopifyOrderId, {
      production_status: PROJECTED_STATUS,
    });

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startTime;
    await base44.asServiceRole.entities.HubCommandLog.update(commandLog.id, buildLogPayload({
      requestId,
      productionBatchId,
      batchId,
      shopifyOrderId,
      orderNumber,
      actorEmail,
      actorRole,
      previousProductionStatus: currentProductionStatus,
      newProductionStatus: PROJECTED_STATUS,
      status: 'success',
      reason,
      timestamp: completedAt,
      durationMs,
    }));

    return Response.json(safeSuccessResponse({
      productionBatchId,
      batchId,
      shopifyOrderId,
      orderNumber,
      previousProductionStatus: currentProductionStatus,
      productionStatus: PROJECTED_STATUS,
      requestId,
      skipped: false,
      updatedAt: completedAt,
    }));
  } catch {
    console.error(`[${FUNCTION_NAME}] Error`);
    if (base44 && commandLog?.id && failureContext) {
      try {
        const failedAt = new Date().toISOString();
        await base44.asServiceRole.entities.HubCommandLog.update(commandLog.id, buildLogPayload({
          ...failureContext,
          status: 'failed',
          errorCode: 'internal_error',
          errorMessage: 'Unable to bottle verified production ShopifyOrder',
          timestamp: failedAt,
          durationMs: Date.now() - startTime,
        }));
      } catch {
        console.error(`[${FUNCTION_NAME}] Could not update failed command log`);
      }
    }
    return Response.json(safeError('Unable to bottle verified production ShopifyOrder', 'internal_error'), { status: 500 });
  }
});
