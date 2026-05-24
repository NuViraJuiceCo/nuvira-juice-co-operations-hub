import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const APPROVED_FAKE_BATCH_ID = (Deno.env.get('G16C1_FAKE_PRODUCTION_BATCH_ID') || '').trim();
const APPROVED_FAKE_BATCH_DISPLAY_ID = (Deno.env.get('G16C1_FAKE_PRODUCTION_BATCH_BATCH_ID') || '').trim();
const APPROVED_FAKE_MANUAL_BATCH_ID = (Deno.env.get('G16C1_FAKE_MANUAL_PRODUCTION_BATCH_ID') || '').trim();
const REAL_START_ENABLED = (Deno.env.get('ENABLE_REAL_PRODUCTION_BATCH_START') || '').trim().toLowerCase() === 'true';
const REAL_START_ALLOWED_EMAILS = Deno.env.get('REAL_PRODUCTION_START_ALLOWED_EMAILS') || '';
const REAL_START_BATCH_ALLOWLIST = Deno.env.get('REAL_PRODUCTION_START_BATCH_ALLOWLIST') || '';

const COMMAND = 'production_batch_start';
const TARGET_TYPE = 'ProductionBatch';
const SOURCE = 'customer_app_admin';
const COMMAND_SOURCE = 'customer_app';
const FUNCTION_NAME = 'startProductionBatchForCustomerApp';

const MAX_TEXT_LENGTH = 120;
const ALLOWED_STATUSES = new Set(['planned', 'ready_for_production']);
const BLOCKED_STATUSES = new Set(['completed_pending_verification', 'verified_logged', 'archived']);
const TERMINAL_MANUAL_STATUSES = new Set(['produced', 'completed', 'cancelled']);
const IDEMPOTENT_SUCCESS_STATUSES = new Set(['success', 'skipped']);
const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'request_id',
  'batch_id',
  'expected_status',
  'reason',
  'actor_email',
  'actor_role',
  'source',
]);

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
  'customer_phone',
  'contact_phone',
  'phone',
  'address',
  'shipping_address',
  'billing_address',
  'street',
  'city',
  'state',
  'zip',
  'postal',
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

const UNEXPECTED_CUSTOMER_KEY_TERMS = [
  'customer_email',
  'customer_name',
  'customer_phone',
  'contact_email',
  'contact_name',
  'contact_phone',
  'recipient',
  'phone',
  'address',
  'shipping_address',
  'billing_address',
  'street',
  'city',
  'state',
  'zip',
  'postal',
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

const SECRET_AUTH_KEY_TERMS = [
  'secret',
  'token',
  'api_key',
  'apikey',
  'auth',
  'authorization',
  'bearer',
  'credential',
  'password',
  'private_key',
  'access_key',
  'refresh_token',
  'session_token',
  'webhook_secret',
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
  'customer_app_order',
  'purchase_order',
  'inventory',
  'stock',
  'supplier',
  'po_id',
  'batch_order',
  'review_queue',
  'customer',
  'email',
  'phone',
  'address',
  'stripe',
  'shopify',
  'provider',
  'payment',
  'subscription',
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

const COMPLIANCE_FINALIZATION_FIELDS = new Set([
  'compliance_log_id',
  'ccp_log_id',
  'corrective_action_log_id',
  'sanitation_log_id',
  'verified_by',
  'verified_at',
  'actual_end_time',
]);

const SAFE_PROVIDER_PAYMENT_KEYS = new Set([
  'production_status',
  'payment_status',
  'batch_id',
]);

const SAFE_OPERATIONAL_LINKAGE_KEYS = new Set([
  'batch_id',
  'source_type',
]);

const REAL_ORDER_SOURCE_SAFE_KEYS = new Set([
  'batch_id',
  'batchid',
  'customer_email',
  'customeremail',
  'customer_name',
  'customername',
  'fulfillment_method',
  'fulfillmentmethod',
  'fulfillment_type',
  'fulfillmenttype',
  'order_id',
  'orderid',
  'order_number',
  'ordernumber',
  'order_type',
  'ordertype',
  'quantity',
  'source_type',
  'sourcetype',
]);

const REAL_BATCH_METADATA_SAFE_KEYS = new Set([
  'action',
  'actual_units',
  'actualunits',
  'assigned_to',
  'assignedto',
  'audit_trail',
  'audittrail',
  'batch_date',
  'batchdate',
  'batch_id',
  'batchid',
  'created_by',
  'createdby',
  'created_date',
  'createddate',
  'id',
  'is_locked',
  'islocked',
  'name',
  'notes',
  'order_sources',
  'ordersources',
  'performed_by',
  'performedby',
  'planned_units',
  'plannedunits',
  'product_category',
  'productcategory',
  'product_name',
  'productname',
  'production_date',
  'productiondate',
  'production_status',
  'productionstatus',
  'quantity',
  'source_type',
  'sourcetype',
  'status',
  'timestamp',
  'unit',
  'units',
  'updated_date',
  'updateddate',
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

function sanitizeMetadataValue(value, maxLength = MAX_TEXT_LENGTH) {
  const text = normalizeSingleLine(value)
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

function normalizeActorEmail(value) {
  const email = normalizeSingleLine(value).toLowerCase();
  if (!email) return 'customer_app_admin';
  if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('actor_email must be a valid email address');
  }
  return email;
}

function normalizeActorRole(value) {
  const role = sanitizeMetadataValue(value, 60);
  return role || 'admin';
}

function normalizeSource(value) {
  const source = normalizeLower(value || SOURCE);
  if (source !== SOURCE) throw new Error('source must be customer_app_admin');
  return source;
}

function parseEmailAllowlist(raw) {
  return new Set((raw || '')
    .split(',')
    .map((email) => normalizeLower(email))
    .filter(Boolean));
}

function parseRealBatchAllowlist(raw) {
  return (raw || '')
    .split(',')
    .map((entry) => normalizeSingleLine(entry))
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(':');
      if (separator <= 0 || separator === entry.length - 1) return null;
      return {
        productionBatchId: entry.slice(0, separator).trim(),
        batchDisplayId: entry.slice(separator + 1).trim(),
      };
    })
    .filter(Boolean);
}

function isActorAllowedForRealStart(actorEmail, actorRole) {
  if (normalizeLower(actorRole) !== 'admin') return false;
  const allowedEmails = parseEmailAllowlist(REAL_START_ALLOWED_EMAILS);
  return allowedEmails.has(normalizeLower(actorEmail));
}

function findRealBatchAllowlistMatch(productionBatchId, batchDisplayId) {
  return parseRealBatchAllowlist(REAL_START_BATCH_ALLOWLIST).some((entry) => (
    entry.productionBatchId === productionBatchId &&
    entry.batchDisplayId === batchDisplayId
  ));
}

function findUnsupportedBodyKey(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const key of Object.keys(body)) {
    const normalized = normalizeLower(key);
    if (!ALLOWED_BODY_KEYS.has(normalized)) return key;
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

function findUnsafeFieldKeys(source, { terms, safeKeys = new Set(), isAllowed = () => false }, depth = 0) {
  if (!source || typeof source !== 'object') return [];
  if (Array.isArray(source)) {
    return source.flatMap((item) => findUnsafeFieldKeys(item, { terms, safeKeys, isAllowed }, depth));
  }

  return Object.entries(source).reduce((keys, [key, value]) => {
    if (!hasMeaningfulFieldValue(value)) return keys;
    const normalized = normalizeFieldKey(key);
    if (safeKeys.has(normalized.snake) || safeKeys.has(normalized.compact)) return keys;
    if (isAllowed({ key, normalized, value })) return keys;
    if (fieldKeyMatchesTerms(key, terms)) keys.push(normalized.snake || 'unknown_field');
    if (typeof value === 'object' && depth < 2) {
      keys.push(...findUnsafeFieldKeys(value, { terms, safeKeys, isAllowed }, depth + 1));
    }
    return keys;
  }, []);
}

function isFakeText(value) {
  const text = normalizeLower(value);
  return !text || text.includes('fake') || text.includes('test') || text.includes('g16');
}

function allowsManualSourceCustomerLabel({ normalized, value }) {
  if (normalized.compact === 'customername') return isFakeText(value);
  return false;
}

function hasCustomerDataInSources(orderSources) {
  return findUnsafeFieldKeys(orderSources, {
    terms: CUSTOMER_DATA_KEY_TERMS,
    isAllowed: allowsManualSourceCustomerLabel,
  }).length > 0;
}

function hasUnsafeRealOrderSourceCustomerData(orderSources) {
  return findUnsafeFieldKeys(orderSources, {
    terms: UNSAFE_CUSTOMER_CONTEXT_KEY_TERMS,
    safeKeys: REAL_ORDER_SOURCE_SAFE_KEYS,
  }).length > 0;
}

function hasUnsafeUnexpectedCustomerData(batch) {
  const batchWithoutKnownSources = { ...batch };
  delete batchWithoutKnownSources.order_sources;
  delete batchWithoutKnownSources.audit_trail;
  return findUnsafeFieldKeys(batchWithoutKnownSources, {
    terms: UNEXPECTED_CUSTOMER_KEY_TERMS,
    safeKeys: REAL_BATCH_METADATA_SAFE_KEYS,
  }).length > 0;
}

function hasUnsafeAuditTrailCustomerData(auditTrail) {
  return findUnsafeFieldKeys(auditTrail, {
    terms: UNEXPECTED_CUSTOMER_KEY_TERMS,
    safeKeys: REAL_BATCH_METADATA_SAFE_KEYS,
  }).length > 0;
}

function hasSecretOrAuthFields(source) {
  return findUnsafeFieldKeys(source, {
    terms: SECRET_AUTH_KEY_TERMS,
  }).length > 0;
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

function allowsExactFakeManualLink({ key, normalized, value, parent }) {
  if (normalized.compact !== 'orderid') return false;
  if (normalizeLower(parent?.source_type) !== 'manual_internal_batch') return false;
  return Boolean(APPROVED_FAKE_MANUAL_BATCH_ID) &&
    normalizeSingleLine(value) === APPROVED_FAKE_MANUAL_BATCH_ID;
}

function allowsSafeFakeManualMarker({ normalized, value, parent }) {
  if (normalizeLower(parent?.source_type) !== 'manual_internal_batch') return false;
  if (!['customername', 'batchname', 'displayname'].includes(normalized.compact)) return false;
  return isFakeText(value);
}

function findOperationalLinkageKeys(source, depth = 0, parent = null) {
  if (!source || typeof source !== 'object') return [];
  if (Array.isArray(source)) {
    return source.flatMap((item) => findOperationalLinkageKeys(item, depth, parent));
  }

  return Object.entries(source).reduce((keys, [key, value]) => {
    if (!hasMeaningfulFieldValue(value)) return keys;
    const normalized = normalizeFieldKey(key);
    const isSafeKey = SAFE_OPERATIONAL_LINKAGE_KEYS.has(normalized.snake) ||
      SAFE_OPERATIONAL_LINKAGE_KEYS.has(normalized.compact);
    const isAllowedFakeManualLink = allowsExactFakeManualLink({ key, normalized, value, parent: source });
    const isAllowedFakeManualMarker = allowsSafeFakeManualMarker({ key, normalized, value, parent: source });

    if (
      !isSafeKey &&
      !isAllowedFakeManualLink &&
      !isAllowedFakeManualMarker &&
      fieldKeyMatchesTerms(key, OPERATIONAL_LINKAGE_KEY_TERMS)
    ) {
      keys.push(normalized.snake || 'unknown_field');
    }
    if (typeof value === 'object' && depth < 2) {
      keys.push(...findOperationalLinkageKeys(value, depth + 1, source));
    }
    return keys;
  }, []);
}

function hasOperationalLinkage(batch) {
  return findOperationalLinkageKeys(batch).length > 0;
}

function hasRealOperationalLinkage(batch) {
  const batchWithoutKnownSources = { ...batch };
  delete batchWithoutKnownSources.order_sources;
  return findUnsafeFieldKeys(batchWithoutKnownSources, {
    terms: OPERATIONAL_LINKAGE_KEY_TERMS,
    safeKeys: SAFE_OPERATIONAL_LINKAGE_KEYS,
  }).length > 0 || hasMeaningfulFieldValue(batch?.related_orders);
}

function hasInventoryPoLinkage(batch) {
  const batchWithoutKnownSources = { ...batch };
  delete batchWithoutKnownSources.order_sources;
  return findUnsafeFieldKeys(batchWithoutKnownSources, {
    terms: ['inventory', 'purchase_order', 'po_id', 'supplier', 'stock'],
  }).length > 0;
}

function hasRecalculationRisk(batch) {
  return findUnsafeFieldKeys(batch, {
    terms: RECALCULATION_KEY_TERMS,
  }).length > 0;
}

function hasComplianceFinalization(batch) {
  return [...COMPLIANCE_FINALIZATION_FIELDS].some((field) => hasMeaningfulFieldValue(batch?.[field]));
}

function isBlockedDemand(batch) {
  const tags = Array.isArray(batch?.tags) ? batch.tags.map((tag) => normalizeLower(tag)) : [];
  const status = normalizeLower(batch?.status);
  const productionStatus = normalizeLower(batch?.production_status);
  const visibility = normalizeLower(batch?.operational_visibility);
  const syncStatus = normalizeLower(batch?.sync_status);
  const dataQualityStatus = normalizeLower(batch?.data_quality_status);

  return status === 'cancelled' ||
    status === 'canceled' ||
    productionStatus === 'refunded' ||
    productionStatus === 'cancelled' ||
    productionStatus === 'canceled' ||
    visibility === 'archived' ||
    visibility === 'excluded' ||
    syncStatus === 'do_not_sync' ||
    dataQualityStatus === 'quarantined' ||
    tags.includes('do_not_sync') ||
    tags.includes('do-not-sync') ||
    tags.includes('excluded') ||
    tags.includes('quarantined') ||
    tags.includes('refunded') ||
    tags.includes('cancelled') ||
    tags.includes('canceled');
}

function manualSources(batch) {
  return (Array.isArray(batch?.order_sources) ? batch.order_sources : [])
    .filter((source) => normalizeLower(source?.source_type) === 'manual_internal_batch');
}

function hasNonManualOrderSources(batch) {
  return (Array.isArray(batch?.order_sources) ? batch.order_sources : [])
    .some((source) => normalizeLower(source?.source_type) !== 'manual_internal_batch');
}

function commandId(requestId, batchId) {
  return `${COMMAND}:${TARGET_TYPE}:${batchId}:${requestId}`;
}

function buildNotes({
  requestId,
  previousStatus,
  newStatus,
  startedAt,
  linkedManualBatchPresent,
  linkedManualBatchUpdatedCount,
  fakeTestOnly = true,
  realStartEnabled = false,
  realBatchAllowlisted = false,
}) {
  return JSON.stringify({
    previous_status: sanitizeMetadataValue(previousStatus, 40) || null,
    new_status: sanitizeMetadataValue(newStatus, 40) || null,
    started_at: sanitizeMetadataValue(startedAt, 60) || null,
    source: SOURCE,
    request_id: sanitizeMetadataValue(requestId, 160),
    linked_manual_batch_present: linkedManualBatchPresent === true,
    linked_manual_batch_updated_count: Number(linkedManualBatchUpdatedCount) || 0,
    fake_test_only: fakeTestOnly === true,
    real_start_enabled: realStartEnabled === true,
    real_batch_allowlisted: realBatchAllowlisted === true,
  });
}

function parseNotesMetadata(notes) {
  try {
    const parsed = JSON.parse(normalizeText(notes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return {
      previous_status: sanitizeMetadataValue(parsed.previous_status, 40) || null,
      new_status: sanitizeMetadataValue(parsed.new_status, 40) || null,
      started_at: sanitizeMetadataValue(parsed.started_at, 60) || null,
      fake_test_only: parsed.fake_test_only === true,
      real_start_enabled: parsed.real_start_enabled === true,
      real_batch_allowlisted: parsed.real_batch_allowlisted === true,
    };
  } catch {
    return {};
  }
}

function buildLogPayload({
  requestId,
  productionBatchId,
  batchDisplayId,
  actorEmail,
  actorRole,
  previousStatus,
  newStatus,
  startedAt,
  linkedManualBatchPresent,
  linkedManualBatchUpdatedCount,
  status,
  errorCode,
  detailsSummary,
  timestamp,
  durationMs,
  fakeTestOnly,
  realStartEnabled,
  realBatchAllowlisted,
}) {
  return {
    command_id: commandId(requestId, productionBatchId),
    command_type: COMMAND,
    command_source: COMMAND_SOURCE,
    status,
    target_entity: TARGET_TYPE,
    target_id: productionBatchId,
    target_display_id: batchDisplayId || productionBatchId,
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
      previousStatus,
      newStatus,
      startedAt,
      linkedManualBatchPresent,
      linkedManualBatchUpdatedCount,
      fakeTestOnly,
      realStartEnabled,
      realBatchAllowlisted,
    }),
    error_code: errorCode || null,
    error_message: errorCode ? sanitizeText(detailsSummary, 200) : null,
  };
}

async function createCommandLog(base44, payload) {
  await base44.asServiceRole.entities.HubCommandLog.create(payload);
}

async function findExistingCommandLog(base44, requestId, productionBatchId) {
  const candidates = await base44.asServiceRole.entities.HubCommandLog.filter(
    { idempotency_key: requestId },
    '-created_date',
    20,
  ).catch(() => []);

  return (candidates || []).find(log => (
    log.command_type === COMMAND &&
    log.target_entity === TARGET_TYPE &&
    log.target_id === productionBatchId &&
    log.idempotency_key === requestId
  )) || null;
}

async function findProductionBatch(base44, productionBatchId) {
  const batches = await base44.asServiceRole.entities.ProductionBatch.filter(
    { id: productionBatchId },
    '-updated_date',
    1,
  );
  return batches?.[0] || null;
}

function isCoherentInProduction(batch) {
  return normalizeSingleLine(batch?.status) === 'in_production' &&
    Boolean(normalizeSingleLine(batch?.actual_start_time));
}

function evaluateFakeGate(batch, productionBatchId) {
  const failures = [];
  const sources = Array.isArray(batch?.order_sources) ? batch.order_sources : [];

  if (!APPROVED_FAKE_BATCH_ID) failures.push('fake_batch_not_configured');
  if (APPROVED_FAKE_BATCH_ID && productionBatchId !== APPROVED_FAKE_BATCH_ID) failures.push('batch_id_not_allowlisted');
  if (APPROVED_FAKE_BATCH_DISPLAY_ID && normalizeSingleLine(batch?.batch_id) !== APPROVED_FAKE_BATCH_DISPLAY_ID) {
    failures.push('batch_display_id_not_allowlisted');
  }
  if (batch?.is_locked === true) failures.push('batch_locked');
  if (hasNonManualOrderSources(batch)) failures.push('real_order_sources_present');
  if (hasCustomerDataInSources(sources)) failures.push('customer_data_present');
  if (hasMeaningfulFieldValue(batch?.related_orders)) failures.push('linked_shopify_orders_present');
  if (hasOperationalLinkage(batch)) failures.push('operational_linkage_blocked');
  if (hasComplianceFinalization(batch)) failures.push('compliance_finalization_present');
  if (isBlockedDemand(batch)) failures.push('blocked_batch_state');
  if (hasUnsafeProviderPaymentFields(batch)) failures.push('provider_payment_fields_present');
  if (hasProofOrDropFields(batch)) failures.push('proof_drop_out_of_scope');

  const manual = manualSources(batch);
  if (manual.length > 0) {
    if (!APPROVED_FAKE_MANUAL_BATCH_ID) {
      failures.push('manual_batch_not_configured');
    }
    if (manual.length !== 1) {
      failures.push('ambiguous_manual_sources');
    }
    const manualId = normalizeSingleLine(manual[0]?.order_id);
    if (!manualId || (APPROVED_FAKE_MANUAL_BATCH_ID && manualId !== APPROVED_FAKE_MANUAL_BATCH_ID)) {
      failures.push('manual_batch_not_allowlisted');
    }
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}

function evaluateRealGate({
  batch,
  productionBatchId,
  batchDisplayId,
  expectedBatchDisplayId,
  expectedStatus,
  previousStatus,
  actorEmail,
  actorRole,
}) {
  if (!REAL_START_ENABLED) {
    return {
      passed: false,
      errorCode: 'real_start_not_enabled',
      statusCode: 409,
      message: 'Real production batch start is not enabled',
      realBatchAllowlisted: false,
    };
  }

  if (!isActorAllowedForRealStart(actorEmail, actorRole)) {
    return {
      passed: false,
      errorCode: 'actor_not_allowed',
      statusCode: 403,
      message: 'Actor is not allowed to start real production batches',
      realBatchAllowlisted: false,
    };
  }

  if (!expectedBatchDisplayId || expectedBatchDisplayId !== batchDisplayId) {
    return {
      passed: false,
      errorCode: 'batch_id_mismatch',
      statusCode: 409,
      message: 'batch_id does not match target batch',
      realBatchAllowlisted: false,
    };
  }

  const realBatchAllowlisted = findRealBatchAllowlistMatch(productionBatchId, batchDisplayId);
  if (!realBatchAllowlisted) {
    return {
      passed: false,
      errorCode: 'batch_not_allowlisted',
      statusCode: 409,
      message: 'Production batch is not allowlisted for real start',
      realBatchAllowlisted: false,
    };
  }

  if (!expectedStatus || expectedStatus !== previousStatus) {
    return {
      passed: false,
      errorCode: 'expected_status_mismatch',
      statusCode: 409,
      message: 'expected_status does not match target batch',
      realBatchAllowlisted,
    };
  }

  if (batch?.is_locked === true) {
    return {
      passed: false,
      errorCode: 'batch_locked',
      statusCode: 409,
      message: 'Locked batches cannot be started through this command',
      realBatchAllowlisted,
    };
  }

  if (hasComplianceFinalization(batch)) {
    return {
      passed: false,
      errorCode: 'compliance_finalization_present',
      statusCode: 409,
      message: 'Batch has compliance finalization fields',
      realBatchAllowlisted,
    };
  }

  if (manualSources(batch).length > 0) {
    return {
      passed: false,
      errorCode: 'manual_sources_out_of_scope',
      statusCode: 409,
      message: 'Manual-linked batches are out of scope for real start',
      realBatchAllowlisted,
    };
  }

  if (hasRealOperationalLinkage(batch)) {
    return {
      passed: false,
      errorCode: 'operational_linkage_blocked',
      statusCode: 409,
      message: 'Batch has operational linkage outside the real-start v1 scope',
      realBatchAllowlisted,
    };
  }

  if (hasInventoryPoLinkage(batch)) {
    return {
      passed: false,
      errorCode: 'inventory_po_linkage_present',
      statusCode: 409,
      message: 'Inventory or purchase order linkage is out of scope',
      realBatchAllowlisted,
    };
  }

  if (hasProofOrDropFields(batch)) {
    return {
      passed: false,
      errorCode: 'proof_drop_out_of_scope',
      statusCode: 409,
      message: 'Proof/drop fields are out of scope',
      realBatchAllowlisted,
    };
  }

  if (hasUnsafeProviderPaymentFields(batch)) {
    return {
      passed: false,
      errorCode: 'provider_payment_fields_present',
      statusCode: 409,
      message: 'Provider or payment fields are out of scope',
      realBatchAllowlisted,
    };
  }

  if (
    hasUnsafeUnexpectedCustomerData(batch) ||
    hasUnsafeAuditTrailCustomerData(batch?.audit_trail) ||
    hasUnsafeRealOrderSourceCustomerData(batch?.order_sources)
  ) {
    return {
      passed: false,
      errorCode: 'customer_data_present',
      statusCode: 409,
      message: 'Unsafe customer data is out of scope',
      realBatchAllowlisted,
    };
  }

  if (hasSecretOrAuthFields(batch)) {
    return {
      passed: false,
      errorCode: 'secret_or_auth_field_present',
      statusCode: 409,
      message: 'Secret or auth-like fields are out of scope',
      realBatchAllowlisted,
    };
  }

  if (hasRecalculationRisk(batch)) {
    return {
      passed: false,
      errorCode: 'recalculation_risk',
      statusCode: 409,
      message: 'Batch has recalculation risk',
      realBatchAllowlisted,
    };
  }

  if (isBlockedDemand(batch)) {
    return {
      passed: false,
      errorCode: 'blocked_batch_state',
      statusCode: 409,
      message: 'Batch has a blocked demand state',
      realBatchAllowlisted,
    };
  }

  return {
    passed: true,
    errorCode: null,
    statusCode: 200,
    message: null,
    realBatchAllowlisted,
  };
}

function evaluateTransition(batch, { allowAlreadyInProductionSkip = true } = {}) {
  const previousStatus = normalizeSingleLine(batch?.status);

  if (isCoherentInProduction(batch)) {
    if (!allowAlreadyInProductionSkip) {
      return {
        allowed: false,
        skipped: false,
        previousStatus,
        newStatus: 'in_production',
        errorCode: 'idempotency_conflict',
        message: 'Batch is already in production for a different request_id',
      };
    }
    return {
      allowed: true,
      skipped: true,
      previousStatus,
      newStatus: 'in_production',
      errorCode: null,
      message: 'Batch is already in production',
    };
  }

  if (batch?.is_locked === true) {
    return {
      allowed: false,
      skipped: false,
      previousStatus,
      newStatus: previousStatus || null,
      errorCode: 'batch_locked',
      message: 'Locked batches cannot be started through this command',
    };
  }

  if (!previousStatus || BLOCKED_STATUSES.has(previousStatus)) {
    return {
      allowed: false,
      skipped: false,
      previousStatus,
      newStatus: previousStatus || null,
      errorCode: 'invalid_status_transition',
      message: 'Batch status cannot be started through this command',
    };
  }

  if (!ALLOWED_STATUSES.has(previousStatus)) {
    return {
      allowed: false,
      skipped: false,
      previousStatus,
      newStatus: previousStatus || null,
      errorCode: 'non_canonical_status_blocked',
      message: 'Batch status cannot be started through this command',
    };
  }

  return {
    allowed: true,
    skipped: false,
    previousStatus,
    newStatus: 'in_production',
    errorCode: null,
    message: null,
  };
}

async function updateLinkedManualBatch(base44, batch, now) {
  const manual = manualSources(batch);
  if (manual.length === 0) {
    return { present: false, updatedCount: 0 };
  }

  const manualBatchId = normalizeSingleLine(manual[0]?.order_id);
  const manualBatch = await base44.asServiceRole.entities.ManualProductionBatch.get(manualBatchId).catch(() => null);
  if (!manualBatch) {
    throw new Error('linked_manual_batch_not_found');
  }

  const manualStatus = normalizeLower(manualBatch.status);
  if (TERMINAL_MANUAL_STATUSES.has(manualStatus)) {
    return { present: true, updatedCount: 0 };
  }

  const linkedIds = [...new Set([...(manualBatch.linked_production_batch_ids || []), batch.batch_id].filter(Boolean))];
  await base44.asServiceRole.entities.ManualProductionBatch.update(manualBatchId, {
    status: 'in_production',
    linked_production_batch_ids: linkedIds,
  });

  return { present: true, updatedCount: 1, updatedAt: now };
}

function safeResponse({
  productionBatchId,
  batchDisplayId,
  previousStatus,
  status,
  startedAt,
  requestId,
  skipped,
  updatedAt,
  linkedManualBatchUpdatedCount,
  fakeTestOnly = true,
  realStartEnabled = false,
  realBatchAllowlisted = false,
}) {
  return {
    success: true,
    production_batch_id: productionBatchId,
    batch_id: batchDisplayId || null,
    previous_status: previousStatus || null,
    status: status || null,
    started_at: startedAt || null,
    request_id: requestId,
    skipped: skipped === true,
    updated_at: updatedAt || null,
    linked_manual_batch_updated: Number(linkedManualBatchUpdatedCount) > 0,
    linked_manual_batch_updated_count: Number(linkedManualBatchUpdatedCount) || 0,
    fake_test_only: fakeTestOnly === true,
    real_start_enabled: realStartEnabled === true,
    real_batch_allowlisted: realBatchAllowlisted === true,
  };
}

Deno.serve(async (req) => {
  const startTime = Date.now();

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
    let requestId;
    let expectedBatchDisplayId;
    let expectedStatus;
    let actorEmail;
    let actorRole;

    try {
      productionBatchId = normalizeId(body.production_batch_id, 'production_batch_id');
      requestId = normalizeId(body.request_id, 'request_id');
      expectedBatchDisplayId = normalizeId(body.batch_id, 'batch_id', false);
      expectedStatus = sanitizeMetadataValue(body.expected_status, 60);
      actorEmail = normalizeActorEmail(body.actor_email);
      actorRole = normalizeActorRole(body.actor_role);
      normalizeSource(body.source);
      sanitizeText(body.reason, 200);
    } catch (error) {
      return Response.json({ error: error.message, error_code: 'invalid_input' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const batch = await findProductionBatch(base44, productionBatchId);
    if (!batch) {
      return Response.json({ error: 'Production batch not found', error_code: 'batch_not_found' }, { status: 404 });
    }

    const batchDisplayId = normalizeSingleLine(batch.batch_id);
    const isFakeTarget = Boolean(APPROVED_FAKE_BATCH_ID) && productionBatchId === APPROVED_FAKE_BATCH_ID;
    const isRealTarget = !isFakeTarget;
    if (expectedBatchDisplayId && expectedBatchDisplayId !== batchDisplayId) {
      return Response.json({ error: 'batch_id does not match target batch', error_code: 'batch_id_mismatch' }, { status: 409 });
    }

    const previousStatus = normalizeSingleLine(batch.status);
    const existingLog = await findExistingCommandLog(base44, requestId, productionBatchId);
    if (existingLog) {
      const existingStatus = normalizeLower(existingLog.status);
      const metadata = parseNotesMetadata(existingLog.notes);
      if (IDEMPOTENT_SUCCESS_STATUSES.has(existingStatus)) {
        return Response.json(safeResponse({
          productionBatchId,
          batchDisplayId,
          previousStatus: metadata.previous_status || previousStatus,
          status: metadata.new_status || batch.status,
          startedAt: metadata.started_at || batch.actual_start_time,
          requestId,
          skipped: true,
          updatedAt: existingLog.completed_at || existingLog.updated_date || null,
          linkedManualBatchUpdatedCount: 0,
          fakeTestOnly: metadata.fake_test_only !== false && isFakeTarget,
          realStartEnabled: metadata.real_start_enabled === true || (isRealTarget && REAL_START_ENABLED),
          realBatchAllowlisted: metadata.real_batch_allowlisted === true ||
            (isRealTarget && findRealBatchAllowlistMatch(productionBatchId, batchDisplayId)),
        }));
      }
      if (isFakeTarget && isCoherentInProduction(batch)) {
        return Response.json(safeResponse({
          productionBatchId,
          batchDisplayId,
          previousStatus: metadata.previous_status || previousStatus,
          status: 'in_production',
          startedAt: batch.actual_start_time,
          requestId,
          skipped: true,
          updatedAt: batch.updated_date || null,
          linkedManualBatchUpdatedCount: 0,
          fakeTestOnly: true,
          realStartEnabled: false,
          realBatchAllowlisted: false,
        }));
      }
      return Response.json({
        error: 'Conflicting prior command log for request_id',
        error_code: 'idempotency_conflict',
      }, { status: 409 });
    }

    let fakeTestOnly = true;
    let realBatchAllowlisted = false;

    if (isFakeTarget) {
      const fakeGate = evaluateFakeGate(batch, productionBatchId);
      if (!fakeGate.passed) {
        const now = new Date().toISOString();
        await createCommandLog(base44, buildLogPayload({
          requestId,
          productionBatchId,
          batchDisplayId,
          actorEmail,
          actorRole,
          previousStatus,
          newStatus: previousStatus,
          startedAt: null,
          linkedManualBatchPresent: manualSources(batch).length > 0,
          linkedManualBatchUpdatedCount: 0,
          status: 'rejected',
          errorCode: fakeGate.failures.includes('fake_batch_not_configured') ? 'fake_batch_not_configured' : 'fake_test_gate_failed',
          detailsSummary: fakeGate.failures.join(', '),
          timestamp: now,
          durationMs: Date.now() - startTime,
          fakeTestOnly: true,
          realStartEnabled: false,
          realBatchAllowlisted: false,
        })).catch(() => null);
        return Response.json({
          error: fakeGate.failures.includes('fake_batch_not_configured')
            ? 'Fake production batch allowlist is not configured'
            : 'Fake/test batch gate failed',
          error_code: fakeGate.failures.includes('fake_batch_not_configured')
            ? 'fake_batch_not_configured'
            : 'fake_test_gate_failed',
        }, { status: 409 });
      }
    } else {
      fakeTestOnly = false;
      const realGate = evaluateRealGate({
        batch,
        productionBatchId,
        batchDisplayId,
        expectedBatchDisplayId,
        expectedStatus,
        previousStatus,
        actorEmail,
        actorRole,
      });
      realBatchAllowlisted = realGate.realBatchAllowlisted === true;
      if (!realGate.passed) {
        const now = new Date().toISOString();
        await createCommandLog(base44, buildLogPayload({
          requestId,
          productionBatchId,
          batchDisplayId,
          actorEmail,
          actorRole,
          previousStatus,
          newStatus: previousStatus,
          startedAt: null,
          linkedManualBatchPresent: manualSources(batch).length > 0,
          linkedManualBatchUpdatedCount: 0,
          status: 'rejected',
          errorCode: realGate.errorCode,
          detailsSummary: realGate.message,
          timestamp: now,
          durationMs: Date.now() - startTime,
          fakeTestOnly: false,
          realStartEnabled: REAL_START_ENABLED,
          realBatchAllowlisted,
        })).catch(() => null);
        return Response.json({
          error: realGate.message,
          error_code: realGate.errorCode,
        }, { status: realGate.statusCode });
      }
    }

    if (isFakeTarget && expectedStatus && expectedStatus !== previousStatus) {
      return Response.json({ error: 'expected_status does not match target batch', error_code: 'expected_status_mismatch' }, { status: 409 });
    }

    const transition = evaluateTransition(batch, { allowAlreadyInProductionSkip: isFakeTarget });
    if (!transition.allowed) {
      const now = new Date().toISOString();
      await createCommandLog(base44, buildLogPayload({
        requestId,
        productionBatchId,
        batchDisplayId,
        actorEmail,
        actorRole,
        previousStatus: transition.previousStatus,
        newStatus: transition.newStatus,
        startedAt: null,
        linkedManualBatchPresent: manualSources(batch).length > 0,
        linkedManualBatchUpdatedCount: 0,
        status: 'rejected',
        errorCode: transition.errorCode,
        detailsSummary: transition.message,
        timestamp: now,
        durationMs: Date.now() - startTime,
        fakeTestOnly,
        realStartEnabled: !fakeTestOnly && REAL_START_ENABLED,
        realBatchAllowlisted,
      })).catch(() => null);
      return Response.json({
        error: transition.message,
        error_code: transition.errorCode,
      }, { status: 409 });
    }

    if (transition.skipped) {
      const now = new Date().toISOString();
      await createCommandLog(base44, buildLogPayload({
        requestId,
        productionBatchId,
        batchDisplayId,
        actorEmail,
        actorRole,
        previousStatus: transition.previousStatus,
        newStatus: transition.newStatus,
        startedAt: batch.actual_start_time,
        linkedManualBatchPresent: manualSources(batch).length > 0,
        linkedManualBatchUpdatedCount: 0,
        status: 'skipped',
        errorCode: null,
        detailsSummary: null,
        timestamp: now,
        durationMs: Date.now() - startTime,
        fakeTestOnly,
        realStartEnabled: !fakeTestOnly && REAL_START_ENABLED,
        realBatchAllowlisted,
      }));
      return Response.json(safeResponse({
        productionBatchId,
        batchDisplayId,
        previousStatus: transition.previousStatus,
        status: transition.newStatus,
        startedAt: batch.actual_start_time,
        requestId,
        skipped: true,
        updatedAt: now,
        linkedManualBatchUpdatedCount: 0,
        fakeTestOnly,
        realStartEnabled: !fakeTestOnly && REAL_START_ENABLED,
        realBatchAllowlisted,
      }));
    }

    const now = new Date().toISOString();
    const auditTrail = Array.isArray(batch.audit_trail) ? [...batch.audit_trail] : [];
    auditTrail.push({
      timestamp: now,
      action: 'CustomerAppBatchStarted',
      performed_by: actorEmail,
      before: { status: transition.previousStatus },
      after: { status: 'in_production' },
    });

    await base44.asServiceRole.entities.ProductionBatch.update(batch.id, {
      status: 'in_production',
      actual_start_time: now,
      started_by: actorEmail,
      audit_trail: auditTrail,
    });

    const manualResult = isFakeTarget
      ? await updateLinkedManualBatch(base44, batch, now)
      : { present: false, updatedCount: 0 };

    await createCommandLog(base44, buildLogPayload({
      requestId,
      productionBatchId,
      batchDisplayId,
      actorEmail,
      actorRole,
      previousStatus: transition.previousStatus,
      newStatus: 'in_production',
      startedAt: now,
      linkedManualBatchPresent: manualResult.present,
      linkedManualBatchUpdatedCount: manualResult.updatedCount,
      status: 'success',
      errorCode: null,
      detailsSummary: null,
      timestamp: now,
      durationMs: Date.now() - startTime,
      fakeTestOnly,
      realStartEnabled: !fakeTestOnly && REAL_START_ENABLED,
      realBatchAllowlisted,
    }));

    return Response.json(safeResponse({
      productionBatchId,
      batchDisplayId,
      previousStatus: transition.previousStatus,
      status: 'in_production',
      startedAt: now,
      requestId,
      skipped: false,
      updatedAt: now,
      linkedManualBatchUpdatedCount: manualResult.updatedCount,
      fakeTestOnly,
      realStartEnabled: !fakeTestOnly && REAL_START_ENABLED,
      realBatchAllowlisted,
    }));
  } catch (error) {
    console.error(`[${FUNCTION_NAME}]`, sanitizeText(error?.message || 'Unexpected error', 200));
    return Response.json({
      error: 'Unable to start production batch',
      error_code: 'internal_error',
    }, { status: 500 });
  }
});
