import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

const MAX_TEXT_LENGTH = 120;
const SAFE_ORDER_SOURCE_SUMMARY_LIMIT = 10;
const ALLOWED_STATUSES = new Set(['planned', 'ready_for_production']);
const TERMINAL_STATUSES = new Set(['completed_pending_verification', 'verified_logged', 'archived']);
const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'batch_id',
  'expected_status',
  'request_id',
]);

const PROJECTED_WRITES = [
  'ProductionBatch.status',
  'ProductionBatch.actual_start_time',
  'ProductionBatch.started_by',
  'ProductionBatch.audit_trail',
  'HubCommandLog',
];

const COMPLIANCE_FINALIZATION_FIELDS = [
  'compliance_log_id',
  'ccp_log_id',
  'corrective_action_log_id',
  'sanitation_log_id',
  'verified_by',
  'verified_at',
  'actual_end_time',
];

const CUSTOMER_DATA_KEY_TERMS = [
  'email',
  'contact',
  'customer',
  'recipient',
  'name',
  'phone',
  'address',
  'shipping',
  'billing',
  'street',
  'city',
  'state',
  'zip',
  'postal',
  'apartment',
  'unit',
  'lat',
  'lng',
  'longitude',
  'latitude',
  'geo',
];

const UNSAFE_CUSTOMER_CONTEXT_KEY_TERMS = [
  'phone',
  'address',
  'shipping',
  'billing',
  'street',
  'city',
  'state',
  'zip',
  'postal',
  'apartment',
  'unit',
  'lat',
  'lng',
  'longitude',
  'latitude',
  'geo',
  'raw_payload',
  'payload',
  'raw_order',
  'order_payload',
  'customer_payload',
  'provider_payload',
];

const PROVIDER_PAYMENT_KEY_TERMS = [
  'stripe',
  'shopify',
  'payment_intent',
  'checkout_session',
  'session_id',
  'subscription_id',
  'provider',
  'external_id',
  'gateway',
  'transaction',
  'charge',
  'invoice',
  'payment_method',
  'processor',
  'fulfillment_provider',
  'payment',
];

const PROOF_DROP_KEY_TERMS = [
  'proof',
  'photo',
  'image',
  'file',
  'attachment',
  'upload',
  'drop',
  'dropoff',
  'drop_location',
  'delivery_photo',
  'delivery_proof',
];

const OPERATIONAL_LINKAGE_KEY_TERMS = [
  'fulfillment_task',
  'task_id',
  'task_ids',
  'linked_task',
  'order_id',
  'order_ids',
  'shopify_order',
  'purchase_order',
  'inventory',
  'stock',
  'supplier',
  'po_id',
  'batch_order',
  'review_queue',
  'customer_app_order',
];

const RECALCULATION_KEY_TERMS = [
  'recalc',
  'recalculate',
  'recalculation',
  'stale',
  'needs_recalc',
  'demand_pending',
  'pending_recalc',
];

const SAFE_PROVIDER_PAYMENT_KEYS = new Set([
  'production_status',
  'payment_status',
  'batch_id',
]);

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeSingleLine(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function normalizeLower(value) {
  return normalizeSingleLine(value).toLowerCase();
}

function sanitizeText(value, maxLength = MAX_TEXT_LENGTH) {
  const text = normalizeSingleLine(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl)\b/gi, '[redacted address]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]');

  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function sanitizeAdminPreviewText(value, maxLength = MAX_TEXT_LENGTH) {
  const text = normalizeSingleLine(value)
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl)\b/gi, '[redacted address]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]');

  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
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

function normalizeOptionalStatus(value) {
  const text = normalizeSingleLine(value);
  if (!text) return '';
  if (text.length > 80 || !/^[A-Za-z0-9._ -]+$/.test(text)) {
    throw new Error('expected_status contains unsupported characters');
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

function normalizeFieldKey(key) {
  const snake = (key ?? '').toString().trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
  return {
    snake,
    compact: snake.replace(/[^a-z0-9]/g, ''),
  };
}

function fieldKeyMatchesTerms(key, terms) {
  const normalized = normalizeFieldKey(key);
  return terms.some((term) => {
    const normalizedTerm = normalizeFieldKey(term);
    return normalized.snake.includes(normalizedTerm.snake) ||
      normalized.compact.includes(normalizedTerm.compact);
  });
}

function hasMeaningfulFieldValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return Boolean(normalizeSingleLine(value));
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(normalizeSingleLine(value));
}

function findUnsafeFieldKeys(source, { terms, safeKeys = new Set(), skipKeys = new Set() }, depth = 0) {
  if (!source || typeof source !== 'object') return [];
  if (Array.isArray(source)) {
    return source.flatMap((item) => findUnsafeFieldKeys(item, { terms, safeKeys, skipKeys }, depth));
  }

  return Object.entries(source).reduce((keys, [key, value]) => {
    if (!hasMeaningfulFieldValue(value)) return keys;
    const normalized = normalizeFieldKey(key);
    if (skipKeys.has(normalized.snake) || skipKeys.has(normalized.compact)) return keys;
    if (safeKeys.has(normalized.snake) || safeKeys.has(normalized.compact)) return keys;
    if (fieldKeyMatchesTerms(key, terms)) keys.push(normalized.snake || 'unknown_field');
    if (typeof value === 'object' && depth < 2) {
      keys.push(...findUnsafeFieldKeys(value, { terms, safeKeys, skipKeys }, depth + 1));
    }
    return keys;
  }, []);
}

function countOrderSources(orderSources) {
  const sources = Array.isArray(orderSources) ? orderSources : [];
  const sourceTypeCounts = {};
  const orderNumbers = new Set();

  for (const source of sources) {
    const sourceType = sanitizeText(source?.source_type || 'unknown', 80) || 'unknown';
    sourceTypeCounts[sourceType] = (sourceTypeCounts[sourceType] || 0) + 1;
    const orderNumber = normalizeSingleLine(source?.order_number);
    if (orderNumber) orderNumbers.add(orderNumber);
  }

  return {
    orderSourcesCount: sources.length,
    sourceTypeCounts,
    orderNumberCount: orderNumbers.size,
    manualSourceCount: sources.filter((source) => normalizeLower(source?.source_type) === 'manual_internal_batch').length,
  };
}

function buildSafeOrderSourceSummaries(orderSources) {
  const sources = Array.isArray(orderSources) ? orderSources : [];
  return sources.slice(0, SAFE_ORDER_SOURCE_SUMMARY_LIMIT).map((source) => {
    const summary = {};
    const sourceType = sanitizeAdminPreviewText(source?.source_type, 80);
    const orderNumber = sanitizeAdminPreviewText(source?.order_number, 80);
    const customerName = sanitizeAdminPreviewText(source?.customer_name, 100);
    const customerEmail = sanitizeAdminPreviewText(source?.customer_email, 120);
    const fulfillmentType = sanitizeAdminPreviewText(source?.fulfillment_type || source?.fulfillment_method || source?.order_type, 80);

    if (sourceType) summary.source_type = sourceType;
    if (orderNumber) summary.order_number = orderNumber;
    if (customerName) summary.customer_name = customerName;
    if (customerEmail) summary.customer_email = customerEmail;
    if (fulfillmentType) summary.fulfillment_type = fulfillmentType;

    return summary;
  }).filter((summary) => Object.keys(summary).length > 0);
}

function hasUnexpectedCustomerData(batch) {
  const batchWithoutKnownSources = { ...batch };
  delete batchWithoutKnownSources.order_sources;
  return findUnsafeFieldKeys(batchWithoutKnownSources, {
    terms: CUSTOMER_DATA_KEY_TERMS,
    safeKeys: new Set([
      'batch_id',
      'batchid',
      'product_name',
      'productname',
      'product_category',
      'productcategory',
      'production_date',
      'productiondate',
      'assigned_to',
      'assignedto',
      'started_by',
      'startedby',
      'completed_by',
      'completedby',
      'verified_by',
      'verifiedby',
    ]),
  }).length > 0;
}

function hasUnsafeOrderSourceCustomerData(orderSources) {
  return findUnsafeFieldKeys(orderSources, {
    terms: UNSAFE_CUSTOMER_CONTEXT_KEY_TERMS,
    safeKeys: new Set([
      'customer_email',
      'customeremail',
      'customer_name',
      'customername',
      'order_number',
      'ordernumber',
      'order_id',
      'orderid',
      'source_type',
      'sourcetype',
      'fulfillment_type',
      'fulfillmenttype',
      'fulfillment_method',
      'fulfillmentmethod',
      'order_type',
      'ordertype',
      'quantity',
    ]),
  }).length > 0;
}

function hasComplianceFinalization(batch) {
  return COMPLIANCE_FINALIZATION_FIELDS.some((field) => hasMeaningfulFieldValue(batch?.[field]));
}

function hasUnsafeProviderPaymentFields(batch) {
  return findUnsafeFieldKeys(batch, {
    terms: PROVIDER_PAYMENT_KEY_TERMS,
    safeKeys: SAFE_PROVIDER_PAYMENT_KEYS,
  }).length > 0;
}

function hasProofOrDropFields(batch) {
  return findUnsafeFieldKeys(batch, { terms: PROOF_DROP_KEY_TERMS }).length > 0;
}

function hasOperationalLinkage(batch) {
  const batchWithoutKnownSources = { ...batch };
  delete batchWithoutKnownSources.order_sources;
  const unsafeKeys = findUnsafeFieldKeys(batchWithoutKnownSources, {
    terms: OPERATIONAL_LINKAGE_KEY_TERMS,
    safeKeys: new Set([
      'batch_id',
      'batchid',
      'source_type',
      'sourcetype',
    ]),
  });
  return unsafeKeys.length > 0 || hasMeaningfulFieldValue(batch?.related_orders);
}

function hasInventoryPoLinkage(batch) {
  return findUnsafeFieldKeys(batch, {
    terms: ['inventory', 'purchase_order', 'po_id', 'supplier', 'stock'],
  }).length > 0;
}

function hasRecalculationRisk(batch) {
  return findUnsafeFieldKeys(batch, {
    terms: RECALCULATION_KEY_TERMS,
  }).length > 0;
}

function hasPriorLifecycleConflict(batch) {
  if (hasMeaningfulFieldValue(batch?.actual_start_time) || hasMeaningfulFieldValue(batch?.actual_end_time)) return true;
  const trail = Array.isArray(batch?.audit_trail) ? batch.audit_trail : [];
  return trail.some((entry) => {
    const action = normalizeLower(entry?.action);
    const afterStatus = normalizeLower(entry?.after?.status);
    return action.includes('started') ||
      action.includes('completed') ||
      action.includes('verified') ||
      afterStatus === 'in_production' ||
      afterStatus === 'completed_pending_verification' ||
      afterStatus === 'verified_logged';
  });
}

function statusBlocker(status) {
  const currentStatus = normalizeSingleLine(status);
  if (!currentStatus || TERMINAL_STATUSES.has(currentStatus)) return 'invalid_status_transition';
  if (!ALLOWED_STATUSES.has(currentStatus)) return 'non_canonical_status_blocked';
  return null;
}

function buildPreview({ batch, productionBatchId, expectedBatchId, expectedStatus, requestId }) {
  const blockers = [];
  const warnings = [];
  const batchDisplayId = normalizeSingleLine(batch?.batch_id);
  const currentStatus = normalizeSingleLine(batch?.status);
  const orderSourceSummary = countOrderSources(batch?.order_sources);
  const safeOrderSourceSummaries = buildSafeOrderSourceSummaries(batch?.order_sources);
  const complianceFinalizationPresent = hasComplianceFinalization(batch);
  const inventoryPoLinkagePresent = hasInventoryPoLinkage(batch);
  const recalculationRisk = hasRecalculationRisk(batch);
  const linkedOrderCount = Array.isArray(batch?.related_orders) ? batch.related_orders.length : 0;
  const linkedTaskCount = Array.isArray(batch?.fulfillment_task_ids) ? batch.fulfillment_task_ids.length : 0;
  const unexpectedCustomerDataPresent = hasUnexpectedCustomerData(batch);
  const unsafeOrderSourceCustomerDataPresent = hasUnsafeOrderSourceCustomerData(batch?.order_sources);
  const customerContextPresent = orderSourceSummary.orderSourcesCount > 0 && (
    safeOrderSourceSummaries.length > 0 ||
    orderSourceSummary.orderNumberCount > 0
  );
  const customerDataBlocking = unexpectedCustomerDataPresent || unsafeOrderSourceCustomerDataPresent;

  if (expectedBatchId && expectedBatchId !== batchDisplayId) blockers.push('batch_id_mismatch');
  if (expectedStatus && expectedStatus !== currentStatus) blockers.push('expected_status_mismatch');

  const transitionBlocker = statusBlocker(currentStatus);
  if (transitionBlocker) blockers.push(transitionBlocker);

  if (batch?.is_locked === true) blockers.push('batch_locked');
  if (complianceFinalizationPresent) blockers.push('compliance_finalization_present');
  if (orderSourceSummary.manualSourceCount > 0) blockers.push('manual_sources_out_of_scope');
  if (hasOperationalLinkage(batch)) blockers.push('operational_linkage_blocked');
  if (hasProofOrDropFields(batch)) blockers.push('proof_drop_out_of_scope');
  if (hasUnsafeProviderPaymentFields(batch)) blockers.push('provider_payment_fields_present');
  if (customerDataBlocking) blockers.push('customer_data_present');
  if (recalculationRisk) blockers.push('recalculation_risk');
  if (hasPriorLifecycleConflict(batch)) blockers.push('prior_lifecycle_conflict');

  if (orderSourceSummary.orderSourcesCount > 0) {
    warnings.push('order_sources_summarized_only');
  }

  if (customerContextPresent && !customerDataBlocking) {
    warnings.push('customer_context_allowed_for_preview');
  }

  return {
    success: true,
    dry_run: true,
    production_batch_id: productionBatchId,
    batch_id: batchDisplayId || null,
    current_status: currentStatus || null,
    eligible_status: !transitionBlocker,
    is_locked: batch?.is_locked === true,
    order_sources_count: orderSourceSummary.orderSourcesCount,
    order_source_type_counts: orderSourceSummary.sourceTypeCounts,
    order_number_count: orderSourceSummary.orderNumberCount,
    customer_context_present: customerContextPresent,
    customer_context_allowed_for_preview: customerContextPresent && !customerDataBlocking,
    order_sources_preview_allowed: orderSourceSummary.orderSourcesCount > 0 && !customerDataBlocking,
    customer_data_blocking: customerDataBlocking,
    safe_order_source_summaries: safeOrderSourceSummaries,
    manual_source_count: orderSourceSummary.manualSourceCount,
    linked_task_count: linkedTaskCount,
    linked_order_count: linkedOrderCount,
    compliance_finalization_present: complianceFinalizationPresent,
    inventory_po_linkage_present: inventoryPoLinkagePresent,
    recalculation_risk: recalculationRisk,
    projected_writes: PROJECTED_WRITES,
    live_allowed: blockers.length === 0,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    ...(requestId ? { request_id: requestId } : {}),
  };
}

async function findProductionBatch(base44, productionBatchId) {
  const batches = await base44.asServiceRole.entities.ProductionBatch.filter(
    { id: productionBatchId },
    '-updated_date',
    1,
  );
  return batches?.[0] || null;
}

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return Response.json({ error: 'Missing or invalid Authorization header' }, { status: 401 });
    }

    const token = authHeader.slice(7);
    if (!SYNC_SECRET || token !== SYNC_SECRET) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const body = await req.json().catch(() => ({}));
    const unsupportedKey = findUnsupportedBodyKey(body);
    if (unsupportedKey) {
      return Response.json({
        error: `Unsupported field: ${unsupportedKey}`,
        error_code: 'unsupported_field',
      }, { status: 400 });
    }

    let productionBatchId;
    let expectedBatchId;
    let expectedStatus;
    let requestId;

    try {
      productionBatchId = normalizeId(body.production_batch_id, 'production_batch_id');
      expectedBatchId = normalizeId(body.batch_id, 'batch_id', false);
      expectedStatus = normalizeOptionalStatus(body.expected_status);
      requestId = normalizeId(body.request_id, 'request_id', false);
    } catch (error) {
      return Response.json({ error: error.message, error_code: 'invalid_input' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const batch = await findProductionBatch(base44, productionBatchId);
    if (!batch) {
      return Response.json({
        error: 'Production batch not found',
        error_code: 'batch_not_found',
      }, { status: 404 });
    }

    return Response.json(buildPreview({
      batch,
      productionBatchId,
      expectedBatchId,
      expectedStatus,
      requestId,
    }));
  } catch (error) {
    console.error('[previewProductionBatchStartForCustomerApp]', sanitizeText(error?.message || 'Unexpected error', 200));
    return Response.json({
      error: 'Unable to preview production batch start',
      error_code: 'internal_error',
    }, { status: 500 });
  }
});
