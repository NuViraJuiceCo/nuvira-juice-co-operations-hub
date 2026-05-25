import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const APPROVED_FAKE_BATCH_ID = (Deno.env.get('G17C1_FAKE_COMPLETE_PRODUCTION_BATCH_ID') || '').trim();
const APPROVED_FAKE_BATCH_DISPLAY_ID = (Deno.env.get('G17C1_FAKE_COMPLETE_PRODUCTION_BATCH_BATCH_ID') || '').trim();
const REAL_COMPLETE_ENABLED = (Deno.env.get('ENABLE_REAL_PRODUCTION_BATCH_COMPLETE') || '').trim().toLowerCase() === 'true';
const REAL_COMPLETE_ALLOWED_EMAILS = Deno.env.get('REAL_PRODUCTION_COMPLETE_ALLOWED_EMAILS') || '';
const REAL_COMPLETE_BATCH_ALLOWLIST = Deno.env.get('REAL_PRODUCTION_COMPLETE_BATCH_ALLOWLIST') || '';

const COMMAND = 'production_batch_complete';
const TARGET_TYPE = 'ProductionBatch';
const SOURCE = 'customer_app_admin';
const COMMAND_SOURCE = 'customer_app';
const FUNCTION_NAME = 'completeProductionBatchForCustomerApp';
const MAX_TEXT_LENGTH = 160;

const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'request_id',
  'batch_id',
  'expected_status',
  'actual_units',
  'actual_quantity_produced',
  'bottles_produced',
  'bottles_rejected_or_wasted',
  'final_usable_quantity',
  'storage_location',
  'use_by_date',
  'pH_result',
  'pH_passed_failed',
  'pH_meter_id',
  'ph_result',
  'ph_passed_failed',
  'ph_meter_id',
  'calibration_checked',
  'ccp_check_complete',
  'sanitation_verification_complete',
  'labels_applied',
  'passed_failed',
  'staff_on_duty',
  'notes',
  'reason',
  'actor_email',
  'actor_role',
  'source',
]);

const IDEMPOTENT_SUCCESS_STATUSES = new Set(['success', 'skipped']);
const TERMINAL_OR_BLOCKED_STATUSES = new Set([
  'planned',
  'ready_for_production',
  'completed_pending_verification',
  'verified_logged',
  'archived',
  'completed',
  'fulfilled',
]);

const COMPLIANCE_FINALIZATION_FIELDS = new Set([
  'compliance_log_id',
  'ccp_log_id',
  'corrective_action_log_id',
  'sanitation_log_id',
  'verified_by',
  'verified_at',
]);

const OPERATIONAL_LINKAGE_KEY_TERMS = [
  'fulfillment_task',
  'task_id',
  'task_ids',
  'linked_task',
  'shopify_order',
  'customer_app_order',
  'purchase_order',
  'inventory',
  'stock',
  'supplier',
  'po_id',
  'batch_order',
  'review_queue',
  'stripe',
  'shopify',
  'provider',
  'payment',
  'subscription',
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

const RECALCULATION_KEY_TERMS = [
  'recalc',
  'recalculate',
  'recalculation',
  'stale',
  'needs_recalc',
  'demand_pending',
  'pending_recalc',
];

const SAFE_OPERATIONAL_KEYS = new Set([
  'batch_id',
  'batchid',
  'order_sources',
  'ordersources',
  'order_id',
  'orderid',
  'order_number',
  'ordernumber',
  'customer_name',
  'customername',
  'customer_email',
  'customeremail',
  'source_type',
  'sourcetype',
  'source_item',
  'sourceitem',
  'quantity',
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
  const status = normalizeSingleLine(value);
  if (!status) return '';
  if (status.length > 80 || !/^[A-Za-z0-9._ -]+$/.test(status)) {
    throw new Error('expected_status contains unsupported characters');
  }
  return status;
}

function normalizeActorEmail(value) {
  const email = normalizeSingleLine(value).toLowerCase();
  if (!email) return 'customer_app_admin';
  if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('actor_email must be a valid email address');
  }
  return email;
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

function isActorAllowedForRealComplete(actorEmail, actorRole) {
  if (normalizeLower(actorRole) !== 'admin') return false;
  const allowedEmails = parseEmailAllowlist(REAL_COMPLETE_ALLOWED_EMAILS);
  return allowedEmails.has(normalizeLower(actorEmail));
}

function findRealBatchAllowlistMatch(productionBatchId, batchDisplayId) {
  return parseRealBatchAllowlist(REAL_COMPLETE_BATCH_ALLOWLIST).some((entry) => (
    entry.productionBatchId === productionBatchId &&
    entry.batchDisplayId === batchDisplayId
  ));
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
  return Boolean(value);
}

function findUnsafeFieldKeys(source, terms, safeKeys = new Set(), depth = 0) {
  if (!source || typeof source !== 'object') return [];
  if (Array.isArray(source)) {
    return source.flatMap((item) => findUnsafeFieldKeys(item, terms, safeKeys, depth));
  }

  return Object.entries(source).reduce((keys, [key, value]) => {
    if (!hasMeaningfulFieldValue(value)) return keys;
    const normalized = normalizeFieldKey(key);
    if (safeKeys.has(normalized.snake) || safeKeys.has(normalized.compact)) return keys;
    if (fieldKeyMatchesTerms(key, terms)) keys.push(normalized.snake || 'unknown_field');
    if (typeof value === 'object' && depth < 2) {
      keys.push(...findUnsafeFieldKeys(value, terms, safeKeys, depth + 1));
    }
    return keys;
  }, []);
}

function findUnsupportedBodyKey(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const key of Object.keys(body)) {
    const normalized = normalizeLower(key);
    if (!ALLOWED_BODY_KEYS.has(normalized)) return key;
  }
  return null;
}

function positiveNumber(value, fieldName, required = false) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new Error(`${fieldName} is required`);
    return null;
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new Error(`${fieldName} must be a number greater than 0`);
  }
  return numberValue;
}

function nonNegativeNumber(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw new Error(`${fieldName} must be a number greater than or equal to 0`);
  }
  return numberValue;
}

function booleanValue(value) {
  return value === true;
}

function validateIsoDate(value, fieldName) {
  const text = normalizeSingleLine(value);
  if (!text) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${fieldName} must be YYYY-MM-DD`);
  return text;
}

function validatePassedFailed(value, fieldName) {
  const status = normalizeLower(value);
  if (!['passed', 'failed'].includes(status)) throw new Error(`${fieldName} must be passed or failed`);
  return status;
}

function normalizeStaffOnDuty(value) {
  if (value === null || value === undefined || value === '') return [];
  if (!Array.isArray(value)) throw new Error('staff_on_duty must be an array');

  const staff = value
    .map((entry) => sanitizeText(entry, 80))
    .filter(Boolean)
    .slice(0, 12);

  return [...new Set(staff)];
}

function hasComplianceFinalization(batch) {
  return [...COMPLIANCE_FINALIZATION_FIELDS].some((field) => hasMeaningfulFieldValue(batch?.[field]));
}

function hasManualSources(batch) {
  return (Array.isArray(batch?.order_sources) ? batch.order_sources : [])
    .some((source) => normalizeLower(source?.source_type) === 'manual_internal_batch');
}

function hasOperationalLinkageRisk(batch) {
  const shallow = { ...batch };
  delete shallow.order_sources;
  delete shallow.audit_trail;
  return findUnsafeFieldKeys(shallow, OPERATIONAL_LINKAGE_KEY_TERMS, SAFE_OPERATIONAL_KEYS).length > 0 ||
    hasMeaningfulFieldValue(batch?.related_orders);
}

function hasProofDropRisk(batch) {
  return findUnsafeFieldKeys(batch, PROOF_DROP_KEY_TERMS).length > 0;
}

function hasProviderPaymentRisk(batch) {
  const shallow = { ...batch };
  delete shallow.order_sources;
  delete shallow.audit_trail;
  return findUnsafeFieldKeys(shallow, PROVIDER_PAYMENT_KEY_TERMS, SAFE_OPERATIONAL_KEYS).length > 0 ||
    findUnsafeFieldKeys(batch?.order_sources || [], PROVIDER_PAYMENT_KEY_TERMS, SAFE_OPERATIONAL_KEYS).length > 0;
}

function hasSecretAuthRisk(source) {
  return findUnsafeFieldKeys(source, SECRET_AUTH_KEY_TERMS).length > 0;
}

function hasUnsafeCustomerContextRisk(batch) {
  const shallow = { ...batch };
  delete shallow.order_sources;
  delete shallow.audit_trail;
  return findUnsafeFieldKeys(shallow, UNSAFE_CUSTOMER_CONTEXT_KEY_TERMS, SAFE_OPERATIONAL_KEYS).length > 0 ||
    findUnsafeFieldKeys(batch?.order_sources || [], UNSAFE_CUSTOMER_CONTEXT_KEY_TERMS, SAFE_OPERATIONAL_KEYS).length > 0;
}

function hasRecalculationRisk(batch) {
  return findUnsafeFieldKeys(batch, RECALCULATION_KEY_TERMS, SAFE_OPERATIONAL_KEYS).length > 0;
}

function commandId(requestId, batchId) {
  return `${COMMAND}:${TARGET_TYPE}:${batchId}:${requestId}`;
}

function buildNotes({
  requestId,
  previousStatus,
  newStatus,
  completedAt,
  fakeTestOnly = true,
  realCompleteEnabled = false,
  realBatchAllowlisted = false,
}) {
  return JSON.stringify({
    previous_status: sanitizeText(previousStatus, 40) || null,
    new_status: sanitizeText(newStatus, 40) || null,
    completed_at: sanitizeText(completedAt, 60) || null,
    source: SOURCE,
    request_id: sanitizeText(requestId, 160),
    fake_test_only: fakeTestOnly === true,
    real_complete_enabled: realCompleteEnabled === true,
    real_batch_allowlisted: realBatchAllowlisted === true,
    verification_excluded: true,
    side_effects_excluded: true,
  });
}

function parseNotesMetadata(notes) {
  try {
    const parsed = JSON.parse(normalizeText(notes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return {
      previous_status: sanitizeText(parsed.previous_status, 40) || null,
      new_status: sanitizeText(parsed.new_status, 40) || null,
      completed_at: sanitizeText(parsed.completed_at, 60) || null,
      fake_test_only: parsed.fake_test_only === true,
      real_complete_enabled: parsed.real_complete_enabled === true,
      real_batch_allowlisted: parsed.real_batch_allowlisted === true,
    };
  } catch {
    return {};
  }
}

function safeResponse({
  success,
  productionBatchId,
  batchDisplayId,
  previousStatus,
  status,
  completedAt,
  requestId,
  skipped = false,
  updatedAt,
  fakeTestOnly = true,
  realCompleteEnabled = false,
  realBatchAllowlisted = false,
}) {
  return {
    success: success === true,
    production_batch_id: productionBatchId,
    batch_id: batchDisplayId || null,
    previous_status: previousStatus || null,
    status: status || null,
    completed_at: completedAt || null,
    request_id: requestId,
    skipped: skipped === true,
    updated_at: updatedAt || null,
    fake_test_only: fakeTestOnly === true,
    real_complete_enabled: realCompleteEnabled === true,
    real_batch_allowlisted: realBatchAllowlisted === true,
    verification_excluded: true,
    linked_manual_batch_updated: false,
    linked_manual_batch_updated_count: 0,
  };
}

function safeError(error, errorCode, message = error) {
  return {
    error: sanitizeText(error, 160),
    error_code: sanitizeText(errorCode, 80),
    message: sanitizeText(message, 180),
  };
}

function buildLogPayload({
  requestId,
  productionBatchId,
  batchDisplayId,
  actorEmail,
  actorRole,
  previousStatus,
  newStatus,
  completedAt,
  status,
  errorCode,
  detailsSummary,
  timestamp,
  durationMs,
  fakeTestOnly,
  realCompleteEnabled,
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
      completedAt,
      fakeTestOnly,
      realCompleteEnabled,
      realBatchAllowlisted,
    }),
    error_code: errorCode || null,
    error_message: errorCode ? sanitizeText(detailsSummary, 200) : null,
  };
}

async function createCommandLog(base44, payload) {
  return base44.asServiceRole.entities.HubCommandLog.create(payload);
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

function evaluateFakeGate(batch, productionBatchId) {
  const failures = [];
  const orderSources = Array.isArray(batch?.order_sources) ? batch.order_sources : [];
  if (!APPROVED_FAKE_BATCH_ID) failures.push('fake_batch_not_configured');
  if (APPROVED_FAKE_BATCH_ID && productionBatchId !== APPROVED_FAKE_BATCH_ID) failures.push('batch_id_not_allowlisted');
  if (APPROVED_FAKE_BATCH_DISPLAY_ID && normalizeSingleLine(batch?.batch_id) !== APPROVED_FAKE_BATCH_DISPLAY_ID) {
    failures.push('batch_display_id_not_allowlisted');
  }
  if (batch?.is_locked === true) failures.push('batch_locked');
  if (orderSources.length > 0) failures.push('order_sources_out_of_scope');
  if (hasManualSources(batch)) failures.push('manual_sources_out_of_scope');
  if (hasMeaningfulFieldValue(batch?.related_orders)) failures.push('linked_orders_present');
  if (hasOperationalLinkageRisk(batch)) failures.push('operational_linkage_blocked');
  if (hasComplianceFinalization(batch)) failures.push('compliance_finalization_present');
  if (hasProofDropRisk(batch)) failures.push('proof_drop_out_of_scope');
  if (hasSecretAuthRisk(orderSources)) failures.push('secret_or_auth_field_present');
  return failures;
}

function evaluateRealGate({
  batch,
  productionBatchId,
  requestBatchId,
  expectedStatus,
  actorEmail,
  actorRole,
}) {
  const failures = [];
  const currentStatus = normalizeSingleLine(batch?.status);
  const batchDisplayId = normalizeSingleLine(batch?.batch_id);

  if (!REAL_COMPLETE_ENABLED) failures.push('real_complete_not_enabled');
  if (!isActorAllowedForRealComplete(actorEmail, actorRole)) failures.push('actor_not_allowed');
  if (!requestBatchId) failures.push('batch_id_required');
  if (requestBatchId && requestBatchId !== batchDisplayId) failures.push('batch_id_mismatch');
  if (!findRealBatchAllowlistMatch(productionBatchId, batchDisplayId)) failures.push('batch_not_allowlisted');
  if (!expectedStatus) failures.push('expected_status_required');
  if (expectedStatus && expectedStatus !== currentStatus) failures.push('expected_status_mismatch');
  if (currentStatus !== 'in_production') failures.push('invalid_status_transition');
  if (!normalizeSingleLine(batch?.actual_start_time)) failures.push('incoherent_batch_state');
  if (batch?.is_locked === true) failures.push('batch_locked');
  if (hasComplianceFinalization(batch)) failures.push('compliance_finalization_present');
  if (hasManualSources(batch)) failures.push('manual_sources_out_of_scope');
  if (hasOperationalLinkageRisk(batch)) failures.push('operational_linkage_blocked');
  if (hasProofDropRisk(batch)) failures.push('proof_drop_out_of_scope');
  if (hasProviderPaymentRisk(batch)) failures.push('provider_payment_fields_present');
  if (hasSecretAuthRisk(batch)) failures.push('secret_or_auth_field_present');
  if (hasUnsafeCustomerContextRisk(batch)) failures.push('unsafe_customer_context_present');
  if (hasRecalculationRisk(batch)) failures.push('recalculation_risk');
  if (TERMINAL_OR_BLOCKED_STATUSES.has(currentStatus)) failures.push('terminal_status_blocked');

  return [...new Set(failures)];
}

function statusForRealGateFailure(failures) {
  if (!failures.includes('real_complete_not_enabled') && failures.includes('actor_not_allowed')) return 403;
  return 409;
}

function errorCodeForRealGateFailure(failures) {
  const priority = [
    'real_complete_not_enabled',
    'actor_not_allowed',
    'batch_not_allowlisted',
    'batch_id_required',
    'batch_id_mismatch',
    'expected_status_required',
    'expected_status_mismatch',
  ];
  return priority.find((code) => failures.includes(code)) || failures[0] || 'real_complete_gate_failed';
}

function normalizeCompletionInput(body) {
  const actualUnits = positiveNumber(
    body.actual_units ?? body.actual_quantity_produced,
    'actual_units',
    true,
  );
  const pHResult = positiveNumber(body.pH_result, 'pH_result', true);
  if (pHResult >= 4.6) throw new Error('pH_result must be below 4.6 for v1 completion');

  const pHStatus = validatePassedFailed(body.pH_passed_failed, 'pH_passed_failed');
  const batchStatus = validatePassedFailed(body.passed_failed, 'passed_failed');
  if (pHStatus !== 'passed' || batchStatus !== 'passed') {
    throw new Error('failed completion requires a dedicated corrective-action workflow');
  }

  return {
    actualUnits,
    bottlesProduced: positiveNumber(body.bottles_produced, 'bottles_produced', false),
    bottlesRejectedOrWasted: nonNegativeNumber(body.bottles_rejected_or_wasted, 'bottles_rejected_or_wasted'),
    finalUsableQuantity: positiveNumber(body.final_usable_quantity, 'final_usable_quantity', false),
    storageLocation: sanitizeText(body.storage_location, 80),
    useByDate: validateIsoDate(body.use_by_date, 'use_by_date'),
    pHResult,
    pHStatus,
    pHMeterId: sanitizeText(body.pH_meter_id, 80),
    calibrationChecked: booleanValue(body.calibration_checked),
    ccpCheckComplete: booleanValue(body.ccp_check_complete),
    sanitationVerificationComplete: booleanValue(body.sanitation_verification_complete),
    labelsApplied: booleanValue(body.labels_applied),
    passedFailed: batchStatus,
    staffOnDuty: normalizeStaffOnDuty(body.staff_on_duty),
    notes: sanitizeText(body.notes, 240),
  };
}

Deno.serve(async (req) => {
  const submittedAt = new Date().toISOString();
  const startedMs = Date.now();

  try {
    if (!SYNC_SECRET) {
      return Response.json(safeError('Unauthorized', 'unauthorized'), { status: 401 });
    }

    const authHeader = req.headers.get('Authorization') || '';
    const expectedHeader = `Bearer ${SYNC_SECRET}`;
    if (!authHeader.startsWith('Bearer ') || authHeader !== expectedHeader) {
      return Response.json(safeError('Unauthorized', 'unauthorized'), { status: 401 });
    }

    if (req.method !== 'POST') {
      return Response.json(safeError('Method not allowed', 'method_not_allowed'), { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const unsupportedKey = findUnsupportedBodyKey(body);
    if (unsupportedKey) {
      return Response.json({
        ...safeError(`Unsupported field: ${unsupportedKey}`, 'unsupported_field'),
      }, { status: 400 });
    }

    let productionBatchId;
    let requestId;
    let requestBatchId;
    let expectedStatus;
    let actorEmail;
    let actorRole;
    let completionInput;

    try {
      productionBatchId = normalizeId(body.production_batch_id, 'production_batch_id');
      requestId = normalizeId(body.request_id, 'request_id');
      requestBatchId = normalizeId(body.batch_id, 'batch_id', false);
      expectedStatus = normalizeOptionalStatus(body.expected_status);
      actorEmail = normalizeActorEmail(body.actor_email);
      actorRole = sanitizeText(body.actor_role, 60) || 'admin';
      normalizeSource(body.source);
      completionInput = normalizeCompletionInput(body);
    } catch (error) {
      return Response.json(safeError(error.message, 'invalid_input'), { status: 400 });
    }

    const batch = await findProductionBatch(base44, productionBatchId);
    if (!batch) {
      return Response.json(safeError('ProductionBatch not found', 'batch_not_found'), { status: 404 });
    }

    const existingLog = await findExistingCommandLog(base44, requestId, productionBatchId);
    if (existingLog && IDEMPOTENT_SUCCESS_STATUSES.has(normalizeLower(existingLog.status))) {
      const metadata = parseNotesMetadata(existingLog.notes);
      return Response.json(safeResponse({
        success: true,
        productionBatchId,
        batchDisplayId: sanitizeText(batch.batch_id, 160),
        previousStatus: metadata.previous_status || sanitizeText(batch.status, 80),
        status: sanitizeText(batch.status, 80),
        completedAt: metadata.completed_at || sanitizeText(batch.actual_end_time, 80),
        requestId,
        skipped: true,
        updatedAt: sanitizeText(existingLog.completed_at || existingLog.updated_date, 80) || null,
        fakeTestOnly: metadata.fake_test_only !== false,
        realCompleteEnabled: metadata.real_complete_enabled === true,
        realBatchAllowlisted: metadata.real_batch_allowlisted === true,
      }));
    }
    if (existingLog) {
      return Response.json(safeError('Conflicting idempotency record exists', 'idempotency_conflict'), { status: 409 });
    }

    const fakeGateFailures = evaluateFakeGate(batch, productionBatchId);
    const realBatchAllowlisted = findRealBatchAllowlistMatch(productionBatchId, normalizeSingleLine(batch.batch_id));
    let fakeTestOnly = true;
    let realCompleteEnabled = false;

    if (fakeGateFailures.length > 0) {
      const realGateFailures = evaluateRealGate({
        batch,
        productionBatchId,
        requestBatchId,
        expectedStatus,
        actorEmail,
        actorRole,
      });

      if (realGateFailures.length > 0) {
        const errorCode = errorCodeForRealGateFailure(realGateFailures);
        return Response.json(
          safeError('Real complete gate failed', errorCode),
          { status: statusForRealGateFailure(realGateFailures) },
        );
      }

      fakeTestOnly = false;
      realCompleteEnabled = true;
    }

    if (!requestBatchId || requestBatchId !== normalizeSingleLine(batch.batch_id)) {
      return Response.json(safeError('batch_id does not match target batch', 'batch_id_mismatch'), { status: 409 });
    }

    if (!expectedStatus || expectedStatus !== normalizeSingleLine(batch.status)) {
      return Response.json(safeError('expected_status does not match target batch', 'expected_status_mismatch'), { status: 409 });
    }

    if (normalizeSingleLine(batch.status) !== 'in_production') {
      const errorCode = TERMINAL_OR_BLOCKED_STATUSES.has(normalizeSingleLine(batch.status))
        ? 'invalid_status_transition'
        : 'non_canonical_status_blocked';
      return Response.json(safeError('Batch is not eligible for completion', errorCode), { status: 409 });
    }

    if (!normalizeSingleLine(batch.actual_start_time)) {
      return Response.json(safeError('Batch has no coherent actual_start_time', 'incoherent_batch_state'), { status: 409 });
    }

    const now = new Date().toISOString();
    const existingAuditTrail = Array.isArray(batch.audit_trail) ? batch.audit_trail : [];
    const auditEntry = {
      timestamp: now,
      action: 'BatchCompletedPendingVerification',
      performed_by: actorEmail,
      before: { status: batch.status },
      after: { status: 'completed_pending_verification' },
      source: SOURCE,
      request_id: requestId,
      fake_test_only: fakeTestOnly,
      real_complete_enabled: realCompleteEnabled,
      real_batch_allowlisted: realBatchAllowlisted,
      verification_excluded: true,
    };

    const updateData = {
      status: 'completed_pending_verification',
      actual_end_time: now,
      completed_by: actorEmail,
      actual_units: completionInput.actualUnits,
      bottles_produced: completionInput.bottlesProduced ?? completionInput.actualUnits,
      bottles_rejected_or_wasted: completionInput.bottlesRejectedOrWasted ?? null,
      final_usable_quantity: completionInput.finalUsableQuantity ?? completionInput.actualUnits,
      storage_location: completionInput.storageLocation || '',
      use_by_date: completionInput.useByDate || null,
      pH_result: completionInput.pHResult,
      pH_passed_failed: completionInput.pHStatus,
      pH_meter_id: completionInput.pHMeterId || null,
      calibration_checked: completionInput.calibrationChecked,
      ccp_check_complete: completionInput.ccpCheckComplete,
      sanitation_verification_complete: completionInput.sanitationVerificationComplete,
      labels_applied: completionInput.labelsApplied,
      passed_failed: completionInput.passedFailed,
      corrective_action_required: false,
      ...(completionInput.staffOnDuty.length > 0 ? { staff_on_duty: completionInput.staffOnDuty } : {}),
      notes: completionInput.notes || '',
      audit_trail: [...existingAuditTrail, auditEntry],
    };

    const durationMs = Date.now() - startedMs;
    let commandLog;
    try {
      commandLog = await createCommandLog(base44, buildLogPayload({
        requestId,
        productionBatchId,
        batchDisplayId: batch.batch_id,
        actorEmail,
        actorRole,
        previousStatus: batch.status,
        newStatus: 'completed_pending_verification',
        completedAt: '',
        status: 'processing',
        timestamp: submittedAt,
        durationMs,
        fakeTestOnly,
        realCompleteEnabled,
        realBatchAllowlisted,
      }));
    } catch {
      return Response.json(safeError('Command audit could not be created', 'command_log_failed'), { status: 500 });
    }

    await base44.asServiceRole.entities.ProductionBatch.update(batch.id, updateData);

    try {
      await base44.asServiceRole.entities.HubCommandLog.update(commandLog.id, buildLogPayload({
        requestId,
        productionBatchId,
        batchDisplayId: batch.batch_id,
        actorEmail,
        actorRole,
        previousStatus: batch.status,
        newStatus: 'completed_pending_verification',
        completedAt: now,
        status: 'success',
        timestamp: submittedAt,
        durationMs,
        fakeTestOnly,
        realCompleteEnabled,
        realBatchAllowlisted,
      }));
    } catch {
      return Response.json(safeError('Batch completed but command audit was not finalized', 'command_log_update_failed'), { status: 500 });
    }

    return Response.json(safeResponse({
      success: true,
      productionBatchId,
      batchDisplayId: sanitizeText(batch.batch_id, 160),
      previousStatus: sanitizeText(batch.status, 80),
      status: 'completed_pending_verification',
      completedAt: now,
      requestId,
      skipped: false,
      updatedAt: now,
      fakeTestOnly,
      realCompleteEnabled,
      realBatchAllowlisted,
    }));
  } catch {
    console.error('[completeProductionBatchForCustomerApp] Error');
    return Response.json(safeError('Unable to complete Hub production batch', 'internal_error'), { status: 500 });
  }
});
