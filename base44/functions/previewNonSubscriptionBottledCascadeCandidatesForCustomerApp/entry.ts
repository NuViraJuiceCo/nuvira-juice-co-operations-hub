import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

const FUNCTION_NAME = 'previewNonSubscriptionBottledCascadeCandidatesForCustomerApp';
const MAX_SCAN_BATCHES = 200;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const PROJECTED_WRITES = [
  'ShopifyOrder.production_status',
  'HubCommandLog',
];

const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'batch_id',
  'limit',
  'request_id',
]);

const TERMINAL_ORDER_STATUSES = new Set(['fulfilled', 'canceled', 'cancelled', 'refunded']);
const BLOCKED_ORDER_STATUSES = new Set([...TERMINAL_ORDER_STATUSES, 'bottled']);
const SECRET_OR_AUTH_KEY_PATTERN = /(secret|token|api[_-]?key|apikey|auth|authorization|bearer|credential|password|private[_-]?key|access[_-]?key|refresh[_-]?token|session[_-]?token|webhook[_-]?secret)/i;
const PROOF_DROP_KEY_PATTERN = /(proof|photo|drop|delivery_photo|delivery_drop)/i;
const RAW_PAYLOAD_KEY_PATTERN = /(raw|payload|webhook|event_body|request_body|response_body)/i;
const PAYMENT_PROVIDER_KEY_PATTERN = /(payment_intent|checkout_session|charge_id|stripe_|refund|invoice|payment_method|transaction_id)/i;

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

function normalizeOptionalId(value, fieldName) {
  const text = normalizeSingleLine(value);
  if (!text) return '';
  if (text.length > 180 || !/^[A-Za-z0-9._:@/-]+$/.test(text)) {
    throw new Error(`${fieldName} contains unsupported characters`);
  }
  return text;
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_LIMIT;
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 1 || numberValue > MAX_LIMIT) {
    throw new Error(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  return numberValue;
}

function findUnsupportedBodyKey(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const key of Object.keys(body)) {
    if (!ALLOWED_BODY_KEYS.has(normalizeLower(key))) return key;
  }
  return null;
}

function hasMeaningfulFieldValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return Boolean(normalizeSingleLine(value));
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

function collectOrderIds(batch) {
  const sourceIds = (Array.isArray(batch?.order_sources) ? batch.order_sources : [])
    .map((source) => normalizeSingleLine(source?.order_id))
    .filter(Boolean);
  const relatedIds = (Array.isArray(batch?.related_orders) ? batch.related_orders : [])
    .map((orderId) => normalizeSingleLine(orderId))
    .filter(Boolean);
  return [...new Set([...sourceIds, ...relatedIds])];
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

async function findProductionBatch(base44, productionBatchId) {
  const batches = await base44.asServiceRole.entities.ProductionBatch.filter(
    { id: productionBatchId },
    '-updated_date',
    1,
  );
  return batches?.[0] || null;
}

async function readOrder(base44, orderId) {
  return await base44.asServiceRole.entities.ShopifyOrder.get(orderId).catch(() => null);
}

function evaluateBatch(batch, requestedBatchId) {
  const blockers = [];
  const batchId = normalizeSingleLine(batch?.batch_id);
  const status = normalizeSingleLine(batch?.status);

  if (requestedBatchId && batchId !== requestedBatchId) blockers.push('batch_id_mismatch');
  if (status !== 'verified_logged') blockers.push('batch_not_verified_logged');
  if (batch?.is_locked !== true) blockers.push('batch_not_locked');
  if (!hasMeaningfulFieldValue(batch?.verified_at) || !hasMeaningfulFieldValue(batch?.verified_by)) {
    blockers.push('missing_verification_metadata');
  }
  if (!hasMeaningfulFieldValue(batch?.compliance_log_id)) blockers.push('missing_compliance_log_id');
  if (batch?.archived === true || batch?.is_archived === true) blockers.push('batch_archived');

  return blockers;
}

function evaluateOrder(order) {
  const blockers = [];
  const warnings = [];
  const productionStatus = normalizeLower(order?.production_status || order?.status);
  const orderType = normalizeLower(order?.order_type);
  const fulfillmentMode = normalizeLower(order?.fulfillment_mode);
  const fulfillments = Array.isArray(order?.fulfillments) ? order.fulfillments : [];

  if (orderType === 'subscription' || fulfillmentMode === 'multi_delivery') {
    blockers.push('subscription_order_out_of_scope');
  }
  if (fulfillments.length > 1) blockers.push('multi_fulfillment_order_out_of_scope');
  if (BLOCKED_ORDER_STATUSES.has(productionStatus)) {
    blockers.push(productionStatus === 'bottled'
      ? 'already_bottled'
      : TERMINAL_ORDER_STATUSES.has(productionStatus)
        ? 'terminal_order_status'
        : 'order_status_not_bottleable');
  }
  if (hasShallowKeyRisk(order, [SECRET_OR_AUTH_KEY_PATTERN], 2)) blockers.push('secret_or_auth_field_present');
  if (hasShallowKeyRisk(order, [PROOF_DROP_KEY_PATTERN], 2)) blockers.push('proof_drop_out_of_scope');
  if (hasShallowKeyRisk(order, [RAW_PAYLOAD_KEY_PATTERN], 2)) blockers.push('raw_payload_out_of_scope');
  if (hasShallowKeyRisk(order, [PAYMENT_PROVIDER_KEY_PATTERN], 1)) warnings.push('payment_provider_field_present');

  return { blockers: [...new Set(blockers)], warnings: [...new Set(warnings)] };
}

function safeCandidateSummary(batch, order, batchBlockers, orderEvaluation) {
  const orderBlockers = orderEvaluation.blockers || [];
  const warnings = orderEvaluation.warnings || [];
  const blockers = [...new Set([...batchBlockers, ...orderBlockers])];
  const fulfillments = Array.isArray(order?.fulfillments) ? order.fulfillments : [];
  const currentProductionStatus = normalizeLower(order?.production_status || order?.status);

  return {
    production_batch_id: sanitizeText(batch?.id, 180) || null,
    batch_id: sanitizeText(batch?.batch_id, 180) || null,
    batch_status: sanitizeText(batch?.status, 80) || null,
    production_date: sanitizeText(batch?.production_date, 40) || null,
    is_locked: batch?.is_locked === true,
    verified_at_present: hasMeaningfulFieldValue(batch?.verified_at),
    verified_by_present: hasMeaningfulFieldValue(batch?.verified_by),
    compliance_log_id_present: hasMeaningfulFieldValue(batch?.compliance_log_id),
    shopify_order_id: sanitizeText(order?.id, 180) || null,
    order_number: sanitizeText(order?.shopify_order_number || order?.order_number, 80) || null,
    order_type: sanitizeText(order?.order_type, 80) || null,
    fulfillment_mode: sanitizeText(order?.fulfillment_mode, 80) || null,
    fulfillment_count: fulfillments.length,
    current_production_status: sanitizeText(currentProductionStatus, 80) || null,
    projected_production_status: blockers.length === 0 ? 'bottled' : null,
    live_allowed: blockers.length === 0,
    projected_writes: blockers.length === 0 ? PROJECTED_WRITES : [],
    customer_app_sync_deferred: true,
    notifications_deferred: true,
    blockers,
    warnings,
  };
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
    let requestedBatchId;
    let requestId;
    let limit;

    try {
      productionBatchId = normalizeOptionalId(body.production_batch_id, 'production_batch_id');
      requestedBatchId = normalizeOptionalId(body.batch_id, 'batch_id');
      requestId = normalizeOptionalId(body.request_id, 'request_id');
      limit = normalizeLimit(body.limit);
    } catch (error) {
      return Response.json(safeError(error.message, 'invalid_input'), { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const batches = productionBatchId
      ? [await findProductionBatch(base44, productionBatchId)].filter(Boolean)
      : await base44.asServiceRole.entities.ProductionBatch.list('-updated_date', MAX_SCAN_BATCHES);

    const candidates = [];
    const blockedSummaries = [];
    let scannedBatchCount = 0;
    let scannedLinkedOrderCount = 0;
    let missingOrderCount = 0;

    for (const batch of batches || []) {
      if (!batch) continue;
      scannedBatchCount += 1;
      const batchBlockers = evaluateBatch(batch, requestedBatchId);
      const orderIds = collectOrderIds(batch);

      if (orderIds.length === 0) {
        blockedSummaries.push({
          production_batch_id: sanitizeText(batch?.id, 180) || null,
          batch_id: sanitizeText(batch?.batch_id, 180) || null,
          batch_status: sanitizeText(batch?.status, 80) || null,
          live_allowed: false,
          blockers: [...new Set([...batchBlockers, 'no_linked_order_ids'])],
          warnings: [],
        });
        continue;
      }

      for (const orderId of orderIds) {
        scannedLinkedOrderCount += 1;
        const order = await readOrder(base44, orderId);
        if (!order) {
          missingOrderCount += 1;
          continue;
        }

        const summary = safeCandidateSummary(batch, order, batchBlockers, evaluateOrder(order));
        if (summary.live_allowed && candidates.length < limit) {
          candidates.push(summary);
        } else if (!summary.live_allowed && blockedSummaries.length < limit) {
          blockedSummaries.push(summary);
        }
      }

      if (candidates.length >= limit && !productionBatchId) break;
    }

    return Response.json({
      success: true,
      dry_run: true,
      function_name: FUNCTION_NAME,
      scanned_batch_count: scannedBatchCount,
      scanned_linked_order_count: scannedLinkedOrderCount,
      missing_order_count: missingOrderCount,
      candidate_count: candidates.length,
      blocked_summary_count: blockedSummaries.length,
      candidates,
      blocked_summaries: blockedSummaries,
      projected_writes_if_approved: PROJECTED_WRITES,
      customer_app_sync_deferred: true,
      notifications_deferred: true,
      ...(requestId ? { request_id: requestId } : {}),
    });
  } catch {
    console.error(`[${FUNCTION_NAME}] Error`);
    return Response.json(safeError('Unable to preview non-subscription bottled candidates', 'internal_error'), { status: 500 });
  }
});
