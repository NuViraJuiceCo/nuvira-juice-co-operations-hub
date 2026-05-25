import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const REAL_VERIFY_ENABLED = (Deno.env.get('ENABLE_REAL_PRODUCTION_BATCH_VERIFY') || '').trim().toLowerCase() === 'true';
const REAL_VERIFY_ALLOWED_EMAILS = Deno.env.get('REAL_PRODUCTION_VERIFY_ALLOWED_EMAILS') || '';
const REAL_VERIFY_BATCH_ALLOWLIST = Deno.env.get('REAL_PRODUCTION_VERIFY_BATCH_ALLOWLIST') || '';

const COMMAND = 'production_batch_verify';
const TARGET_TYPE = 'ProductionBatch';
const SOURCE = 'customer_app_admin';
const COMMAND_SOURCE = 'customer_app';
const FUNCTION_NAME = 'verifyProductionBatchForCustomerApp';
const MAX_TEXT_LENGTH = 160;

const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'batch_id',
  'expected_status',
  'request_id',
  'reason',
  'actor_email',
  'actor_role',
  'source',
]);

const IDEMPOTENT_SUCCESS_STATUSES = new Set(['success', 'skipped']);
const TERMINAL_OR_BLOCKED_STATUSES = new Set([
  'planned',
  'ready_for_production',
  'in_production',
  'verified_logged',
  'archived',
  'completed',
  'fulfilled',
]);

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

const INVENTORY_PO_KEY_TERMS = [
  'purchase_order',
  'inventory',
  'stock',
  'supplier',
  'po_id',
  'ingredient_reservation',
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

const SAFE_OPERATIONAL_KEYS = new Set([
  'actual_end_time',
  'actualendtime',
  'actual_start_time',
  'actualstarttime',
  'actual_units',
  'actualunits',
  'audit_trail',
  'audittrail',
  'batch_id',
  'batchid',
  'completed_by',
  'completedby',
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
  'source_type',
  'sourcetype',
  'source_item',
  'sourceitem',
  'staff_on_duty',
  'staffonduty',
  'status',
  'unit',
  'units',
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
  if (!email) throw new Error('actor_email is required');
  if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('actor_email must be a valid email address');
  }
  return email;
}

function normalizeSource(value) {
  const source = normalizeLower(value);
  if (!source) throw new Error('source is required');
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

function isActorAllowedForRealVerify(actorEmail, actorRole) {
  if (normalizeLower(actorRole) !== 'admin') return false;
  const allowedEmails = parseEmailAllowlist(REAL_VERIFY_ALLOWED_EMAILS);
  return allowedEmails.has(normalizeLower(actorEmail));
}

function findRealBatchAllowlistMatch(productionBatchId, batchDisplayId) {
  return parseRealBatchAllowlist(REAL_VERIFY_BATCH_ALLOWLIST).some((entry) => (
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

function positiveNumber(value, fieldName) {
  if (value === null || value === undefined || value === '') {
    throw new Error(`${fieldName} is required`);
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new Error(`${fieldName} must be a number greater than 0`);
  }
  return numberValue;
}

function normalizeStaffOnDuty(value) {
  if (!Array.isArray(value)) return [];
  const staff = value
    .map((entry) => sanitizeText(entry, 80))
    .filter(Boolean)
    .slice(0, 12);
  return [...new Set(staff)];
}

function hasComplianceFinalization(batch) {
  return [
    'compliance_log_id',
    'ccp_log_id',
    'corrective_action_log_id',
    'sanitation_log_id',
    'verified_by',
    'verified_at',
  ].some((field) => hasMeaningfulFieldValue(batch?.[field]));
}

function hasPriorVerificationConflict(batch) {
  if (hasComplianceFinalization(batch)) return true;
  return (Array.isArray(batch?.audit_trail) ? batch.audit_trail : []).some((entry) => {
    const action = normalizeLower(entry?.action);
    return action.includes('verified') || action.includes('compliance') || action.includes('logged');
  });
}

function hasManualSources(orderSources) {
  return (Array.isArray(orderSources) ? orderSources : [])
    .some((source) => normalizeLower(source?.source_type) === 'manual_internal_batch');
}

function hasInventoryPoRisk(batch) {
  const shallow = { ...batch };
  delete shallow.order_sources;
  delete shallow.audit_trail;
  delete shallow.related_orders;
  return findUnsafeFieldKeys(shallow, INVENTORY_PO_KEY_TERMS, SAFE_OPERATIONAL_KEYS).length > 0;
}

function hasProofDropRisk(batch) {
  return findUnsafeFieldKeys(batch, PROOF_DROP_KEY_TERMS, SAFE_OPERATIONAL_KEYS).length > 0;
}

function hasProviderPaymentRisk(batch) {
  const shallow = { ...batch };
  delete shallow.order_sources;
  delete shallow.audit_trail;
  return findUnsafeFieldKeys(shallow, PROVIDER_PAYMENT_KEY_TERMS, SAFE_OPERATIONAL_KEYS).length > 0 ||
    findUnsafeFieldKeys(batch?.order_sources || [], PROVIDER_PAYMENT_KEY_TERMS, SAFE_OPERATIONAL_KEYS).length > 0;
}

function hasSecretAuthRisk(batch) {
  return findUnsafeFieldKeys(batch, SECRET_AUTH_KEY_TERMS, SAFE_OPERATIONAL_KEYS).length > 0;
}

function hasUnsafeCustomerContext(batch) {
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
  batchDisplayId,
  previousStatus,
  newStatus,
  verifiedAt,
  complianceLogId,
  staffOnDutyCount,
  actualUnitsPresent,
  linkedTaskCount,
  linkedOrderCount,
}) {
  return JSON.stringify({
    batch_id: sanitizeText(batchDisplayId, 160) || null,
    previous_status: sanitizeText(previousStatus, 40) || null,
    new_status: sanitizeText(newStatus, 40) || null,
    verified_at: sanitizeText(verifiedAt, 60) || null,
    compliance_log_id: sanitizeText(complianceLogId, 180) || null,
    source: SOURCE,
    request_id: sanitizeText(requestId, 160),
    staff_on_duty_count: Number.isFinite(staffOnDutyCount) ? staffOnDutyCount : 0,
    actual_units_present: actualUnitsPresent === true,
    cascades_deferred: true,
    linked_task_count: Number.isFinite(linkedTaskCount) ? linkedTaskCount : 0,
    linked_order_count: Number.isFinite(linkedOrderCount) ? linkedOrderCount : 0,
  });
}

function parseNotesMetadata(notes) {
  try {
    const parsed = JSON.parse(normalizeText(notes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return {
      batch_id: sanitizeText(parsed.batch_id, 160) || null,
      previous_status: sanitizeText(parsed.previous_status, 40) || null,
      new_status: sanitizeText(parsed.new_status, 40) || null,
      verified_at: sanitizeText(parsed.verified_at, 60) || null,
      compliance_log_id: sanitizeText(parsed.compliance_log_id, 180) || null,
      linked_task_count: Number.isFinite(Number(parsed.linked_task_count)) ? Number(parsed.linked_task_count) : 0,
      linked_order_count: Number.isFinite(Number(parsed.linked_order_count)) ? Number(parsed.linked_order_count) : 0,
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
  verifiedAt,
  verifiedBy,
  complianceLogId,
  requestId,
  skipped = false,
  updatedAt,
  batchLocked = true,
  linkedTaskCount = 0,
  linkedOrderCount = 0,
}) {
  return {
    success: success === true,
    production_batch_id: productionBatchId,
    batch_id: batchDisplayId || null,
    previous_status: previousStatus || null,
    status: status || null,
    verified_at: verifiedAt || null,
    verified_by: verifiedBy || null,
    compliance_log_id: complianceLogId || null,
    request_id: requestId,
    skipped: skipped === true,
    updated_at: updatedAt || null,
    batch_locked: batchLocked === true,
    cascades_deferred: true,
    linked_task_count: linkedTaskCount,
    linked_order_count: linkedOrderCount,
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
  verifiedAt,
  complianceLogId,
  status,
  errorCode,
  detailsSummary,
  timestamp,
  durationMs,
  staffOnDutyCount,
  actualUnitsPresent,
  linkedTaskCount,
  linkedOrderCount,
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
      batchDisplayId,
      previousStatus,
      newStatus,
      verifiedAt,
      complianceLogId,
      staffOnDutyCount,
      actualUnitsPresent,
      linkedTaskCount,
      linkedOrderCount,
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
  const orderSources = Array.isArray(batch?.order_sources) ? batch.order_sources : [];

  if (!REAL_VERIFY_ENABLED) failures.push('real_verify_not_enabled');
  if (!isActorAllowedForRealVerify(actorEmail, actorRole)) failures.push('actor_not_allowed');
  if (!requestBatchId) failures.push('batch_id_required');
  if (requestBatchId && requestBatchId !== batchDisplayId) failures.push('batch_id_mismatch');
  if (!findRealBatchAllowlistMatch(productionBatchId, batchDisplayId)) failures.push('batch_not_allowlisted');
  if (!expectedStatus) failures.push('expected_status_required');
  if (expectedStatus && expectedStatus !== currentStatus) failures.push('expected_status_mismatch');
  if (currentStatus !== 'completed_pending_verification') failures.push('invalid_status_transition');
  if (TERMINAL_OR_BLOCKED_STATUSES.has(currentStatus)) failures.push('terminal_status_blocked');
  if (batch?.is_locked === true) failures.push('batch_locked');
  if (hasComplianceFinalization(batch) || hasPriorVerificationConflict(batch)) failures.push('compliance_finalization_present');
  if (hasManualSources(orderSources)) failures.push('manual_sources_out_of_scope');
  if (hasInventoryPoRisk(batch)) failures.push('inventory_po_linkage_present');
  if (hasProofDropRisk(batch)) failures.push('proof_drop_out_of_scope');
  if (hasProviderPaymentRisk(batch)) failures.push('provider_payment_fields_present');
  if (hasSecretAuthRisk(batch)) failures.push('secret_or_auth_field_present');
  if (hasUnsafeCustomerContext(batch)) failures.push('unsafe_customer_context_present');
  if (hasRecalculationRisk(batch)) failures.push('recalculation_risk');

  try {
    validateVerificationReadiness(batch);
  } catch (error) {
    failures.push(error.message);
  }

  return [...new Set(failures)];
}

function statusForRealGateFailure(failures) {
  if (!failures.includes('real_verify_not_enabled') && failures.includes('actor_not_allowed')) return 403;
  return 409;
}

function errorCodeForRealGateFailure(failures) {
  const priority = [
    'real_verify_not_enabled',
    'actor_not_allowed',
    'batch_not_allowlisted',
    'batch_id_required',
    'batch_id_mismatch',
    'expected_status_required',
    'expected_status_mismatch',
  ];
  return priority.find((code) => failures.includes(code)) || failures[0] || 'real_verify_gate_failed';
}

function validateVerificationReadiness(batch) {
  if (!hasMeaningfulFieldValue(batch?.production_date)) throw new Error('missing_required_completion_fields');
  if (!hasMeaningfulFieldValue(batch?.batch_id)) throw new Error('missing_required_completion_fields');
  if (!hasMeaningfulFieldValue(batch?.product_name)) throw new Error('missing_required_completion_fields');
  if (!hasMeaningfulFieldValue(batch?.actual_start_time)) throw new Error('missing_required_completion_fields');
  if (!hasMeaningfulFieldValue(batch?.actual_end_time)) throw new Error('missing_required_completion_fields');
  if (!hasMeaningfulFieldValue(batch?.completed_by)) throw new Error('missing_required_completion_fields');
  if (!hasMeaningfulFieldValue(batch?.actual_units)) throw new Error('missing_quantity');
  if (normalizeStaffOnDuty(batch?.staff_on_duty).length < 1) throw new Error('missing_staff_on_duty');
  if (!hasMeaningfulFieldValue(batch?.pH_result) ||
    !hasMeaningfulFieldValue(batch?.pH_passed_failed) ||
    !hasMeaningfulFieldValue(batch?.passed_failed)) {
    throw new Error('missing_qc_fields');
  }

  const actualUnits = positiveNumber(batch.actual_units, 'actual_units');
  const phResult = positiveNumber(batch.pH_result, 'pH_result');
  if (phResult >= 4.6) throw new Error('ph_result_out_of_range');
  if (normalizeLower(batch.pH_passed_failed) !== 'passed') throw new Error('ph_status_not_passed');
  if (normalizeLower(batch.passed_failed) !== 'passed') throw new Error('batch_status_not_passed');

  return {
    actualUnits,
    staffOnDuty: normalizeStaffOnDuty(batch.staff_on_duty),
    phResult,
  };
}

async function readCascadeCounts(base44, batch) {
  const orderSources = Array.isArray(batch?.order_sources) ? batch.order_sources : [];
  const sourceOrderIds = orderSources
    .map((source) => normalizeSingleLine(source?.order_id))
    .filter(Boolean);
  const relatedOrderIds = (Array.isArray(batch?.related_orders) ? batch.related_orders : [])
    .map((orderId) => normalizeSingleLine(orderId))
    .filter(Boolean);
  const orderIds = [...new Set([...sourceOrderIds, ...relatedOrderIds])];

  let linkedTaskCount = 0;
  const productionDate = normalizeSingleLine(batch?.production_date);
  if (productionDate) {
    const deliveryDate = new Date(productionDate);
    deliveryDate.setDate(deliveryDate.getDate() + 1);
    const deliveryDateStr = Number.isNaN(deliveryDate.getTime()) ? '' : deliveryDate.toISOString().split('T')[0];
    const [tasksByProdDate, tasksBySchedDate] = await Promise.all([
      base44.asServiceRole.entities.FulfillmentTask.filter({ production_date: productionDate }).catch(() => []),
      deliveryDateStr
        ? base44.asServiceRole.entities.FulfillmentTask.filter({ scheduled_date: deliveryDateStr }).catch(() => [])
        : Promise.resolve([]),
    ]);
    const tasksById = {};
    for (const task of [...tasksByProdDate, ...tasksBySchedDate]) {
      if (task?.id) tasksById[task.id] = task;
    }
    linkedTaskCount = Object.values(tasksById)
      .filter((task) => orderIds.length === 0 || orderIds.includes(normalizeSingleLine(task?.order_id)))
      .length;
  }

  return {
    linkedTaskCount,
    linkedOrderCount: orderIds.length,
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
    if (!authHeader.startsWith('Bearer ') || authHeader !== `Bearer ${SYNC_SECRET}`) {
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
    let requestBatchId;
    let expectedStatus;
    let requestId;
    let actorEmail;
    let actorRole;

    try {
      productionBatchId = normalizeId(body.production_batch_id, 'production_batch_id');
      requestBatchId = normalizeId(body.batch_id, 'batch_id');
      expectedStatus = normalizeOptionalStatus(body.expected_status);
      if (!expectedStatus) throw new Error('expected_status is required');
      requestId = normalizeId(body.request_id, 'request_id');
      actorEmail = normalizeActorEmail(body.actor_email);
      actorRole = sanitizeText(body.actor_role, 60);
      if (!actorRole) throw new Error('actor_role is required');
      normalizeSource(body.source);
      if (body.reason !== undefined) sanitizeText(body.reason, 180);
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
        batchDisplayId: metadata.batch_id || sanitizeText(batch.batch_id, 160),
        previousStatus: metadata.previous_status || sanitizeText(batch.status, 80),
        status: metadata.new_status || sanitizeText(batch.status, 80),
        verifiedAt: metadata.verified_at || sanitizeText(batch.verified_at, 80),
        verifiedBy: sanitizeText(batch.verified_by, 160) || null,
        complianceLogId: metadata.compliance_log_id || sanitizeText(batch.compliance_log_id, 180),
        requestId,
        skipped: true,
        updatedAt: sanitizeText(existingLog.completed_at || existingLog.updated_date, 80) || null,
        batchLocked: batch.is_locked === true,
        linkedTaskCount: metadata.linked_task_count || 0,
        linkedOrderCount: metadata.linked_order_count || 0,
      }));
    }
    if (existingLog) {
      return Response.json(safeError('Conflicting idempotency record exists', 'idempotency_conflict'), { status: 409 });
    }

    const realBatchAllowlisted = findRealBatchAllowlistMatch(productionBatchId, normalizeSingleLine(batch.batch_id));
    const gateFailures = evaluateRealGate({
      batch,
      productionBatchId,
      requestBatchId,
      expectedStatus,
      actorEmail,
      actorRole,
    });

    if (gateFailures.length > 0) {
      const errorCode = errorCodeForRealGateFailure(gateFailures);
      return Response.json(
        safeError('Real verify gate failed', errorCode),
        { status: statusForRealGateFailure(gateFailures) },
      );
    }

    if (hasComplianceFinalization(batch) || normalizeSingleLine(batch.status) === 'verified_logged') {
      return Response.json(safeError('Batch already has verification finalization', 'idempotency_conflict'), { status: 409 });
    }

    const readiness = validateVerificationReadiness(batch);
    const cascadeCounts = await readCascadeCounts(base44, batch);
    const now = new Date().toISOString();
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
        newStatus: 'verified_logged',
        verifiedAt: '',
        complianceLogId: '',
        status: 'processing',
        timestamp: submittedAt,
        durationMs,
        staffOnDutyCount: readiness.staffOnDuty.length,
        actualUnitsPresent: true,
        linkedTaskCount: cascadeCounts.linkedTaskCount,
        linkedOrderCount: cascadeCounts.linkedOrderCount,
      }));
    } catch {
      return Response.json(safeError('Command audit could not be created', 'command_log_failed'), { status: 500 });
    }

    let complianceLog;
    try {
      complianceLog = await base44.asServiceRole.entities.BatchComplianceLog.create({
        date: normalizeSingleLine(batch.production_date),
        batch_id: normalizeSingleLine(batch.batch_id),
        juice_flavor: sanitizeText(batch.product_name, 160),
        start_time: normalizeSingleLine(batch.actual_start_time),
        end_time: normalizeSingleLine(batch.actual_end_time),
        quantity_produced: readiness.actualUnits,
        staff_on_duty: readiness.staffOnDuty,
        pH_result: readiness.phResult,
        passed_failed: normalizeLower(batch.passed_failed),
        verified_by: actorEmail,
        verified_at: now,
        source_production_batch_id: batch.id,
        locked: true,
        notes: '',
      });
    } catch {
      await base44.asServiceRole.entities.HubCommandLog.update(commandLog.id, buildLogPayload({
        requestId,
        productionBatchId,
        batchDisplayId: batch.batch_id,
        actorEmail,
        actorRole,
        previousStatus: batch.status,
        newStatus: batch.status,
        verifiedAt: '',
        complianceLogId: '',
        status: 'failed',
        errorCode: 'compliance_log_create_failed',
        detailsSummary: 'Compliance log could not be created',
        timestamp: submittedAt,
        durationMs: Date.now() - startedMs,
        staffOnDutyCount: readiness.staffOnDuty.length,
        actualUnitsPresent: true,
        linkedTaskCount: cascadeCounts.linkedTaskCount,
        linkedOrderCount: cascadeCounts.linkedOrderCount,
      })).catch(() => null);
      return Response.json(safeError('Compliance log could not be created', 'compliance_log_create_failed'), { status: 500 });
    }

    const existingAuditTrail = Array.isArray(batch.audit_trail) ? batch.audit_trail : [];
    const auditEntry = {
      timestamp: now,
      action: 'BatchVerifiedAndComplianceLogged',
      performed_by: actorEmail,
      before: { status: batch.status },
      after: { status: 'verified_logged' },
      source: SOURCE,
      request_id: requestId,
      compliance_log_id: complianceLog.id,
      cascades_deferred: true,
    };

    try {
      await base44.asServiceRole.entities.ProductionBatch.update(batch.id, {
        status: 'verified_logged',
        production_status: 'bottled',
        verified_by: actorEmail,
        verified_at: now,
        compliance_log_id: complianceLog.id,
        is_locked: true,
        audit_trail: [...existingAuditTrail, auditEntry],
      });
    } catch {
      await base44.asServiceRole.entities.HubCommandLog.update(commandLog.id, buildLogPayload({
        requestId,
        productionBatchId,
        batchDisplayId: batch.batch_id,
        actorEmail,
        actorRole,
        previousStatus: batch.status,
        newStatus: batch.status,
        verifiedAt: now,
        complianceLogId: complianceLog.id,
        status: 'failed',
        errorCode: 'partial_compliance_log_created',
        detailsSummary: 'Compliance log was created but ProductionBatch was not finalized',
        timestamp: submittedAt,
        durationMs: Date.now() - startedMs,
        staffOnDutyCount: readiness.staffOnDuty.length,
        actualUnitsPresent: true,
        linkedTaskCount: cascadeCounts.linkedTaskCount,
        linkedOrderCount: cascadeCounts.linkedOrderCount,
      })).catch(() => null);
      return Response.json(safeError('Compliance log was created but batch was not finalized', 'partial_compliance_log_created'), { status: 500 });
    }

    try {
      await base44.asServiceRole.entities.HubCommandLog.update(commandLog.id, buildLogPayload({
        requestId,
        productionBatchId,
        batchDisplayId: batch.batch_id,
        actorEmail,
        actorRole,
        previousStatus: batch.status,
        newStatus: 'verified_logged',
        verifiedAt: now,
        complianceLogId: complianceLog.id,
        status: 'success',
        timestamp: submittedAt,
        durationMs: Date.now() - startedMs,
        staffOnDutyCount: readiness.staffOnDuty.length,
        actualUnitsPresent: true,
        linkedTaskCount: cascadeCounts.linkedTaskCount,
        linkedOrderCount: cascadeCounts.linkedOrderCount,
      }));
    } catch {
      return Response.json(safeError('Batch verified but command audit was not finalized', 'command_log_update_failed'), { status: 500 });
    }

    return Response.json(safeResponse({
      success: true,
      productionBatchId,
      batchDisplayId: sanitizeText(batch.batch_id, 160),
      previousStatus: sanitizeText(batch.status, 80),
      status: 'verified_logged',
      verifiedAt: now,
      verifiedBy: actorEmail,
      complianceLogId: complianceLog.id,
      requestId,
      skipped: false,
      updatedAt: now,
      batchLocked: true,
      linkedTaskCount: cascadeCounts.linkedTaskCount,
      linkedOrderCount: cascadeCounts.linkedOrderCount,
    }));
  } catch {
    console.error('[verifyProductionBatchForCustomerApp] Error');
    return Response.json(safeError('Unable to verify Hub production batch', 'internal_error'), { status: 500 });
  }
});
