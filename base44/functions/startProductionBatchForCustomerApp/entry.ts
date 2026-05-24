import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const APPROVED_FAKE_BATCH_ID = (Deno.env.get('G16C1_FAKE_PRODUCTION_BATCH_ID') || '').trim();
const APPROVED_FAKE_BATCH_DISPLAY_ID = (Deno.env.get('G16C1_FAKE_PRODUCTION_BATCH_BATCH_ID') || '').trim();
const APPROVED_FAKE_MANUAL_BATCH_ID = (Deno.env.get('G16C1_FAKE_MANUAL_PRODUCTION_BATCH_ID') || '').trim();

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

function hasUnsafeProviderPaymentFields(batch) {
  return findUnsafeFieldKeys(batch, {
    terms: PROVIDER_PAYMENT_KEY_TERMS,
    safeKeys: SAFE_PROVIDER_PAYMENT_KEYS,
  }).length > 0;
}

function hasProofOrDropFields(batch) {
  return findUnsafeFieldKeys(batch, { terms: PROOF_DROP_KEY_TERMS }).length > 0;
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
}) {
  return JSON.stringify({
    previous_status: sanitizeMetadataValue(previousStatus, 40) || null,
    new_status: sanitizeMetadataValue(newStatus, 40) || null,
    started_at: sanitizeMetadataValue(startedAt, 60) || null,
    source: SOURCE,
    request_id: sanitizeMetadataValue(requestId, 160),
    linked_manual_batch_present: linkedManualBatchPresent === true,
    linked_manual_batch_updated_count: Number(linkedManualBatchUpdatedCount) || 0,
    fake_test_only: true,
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
  return normalizeLower(batch?.status) === 'in_production' &&
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

function evaluateTransition(batch) {
  const previousStatus = normalizeSingleLine(batch?.status);
  const normalizedStatus = normalizeLower(previousStatus);

  if (isCoherentInProduction(batch)) {
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

  if (!normalizedStatus || BLOCKED_STATUSES.has(normalizedStatus)) {
    return {
      allowed: false,
      skipped: false,
      previousStatus,
      newStatus: previousStatus || null,
      errorCode: 'invalid_batch_status',
      message: 'Batch status cannot be started through this command',
    };
  }

  if (!ALLOWED_STATUSES.has(normalizedStatus)) {
    return {
      allowed: false,
      skipped: false,
      previousStatus,
      newStatus: previousStatus || null,
      errorCode: 'invalid_batch_status',
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
    fake_test_only: true,
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

    if (!APPROVED_FAKE_BATCH_ID) {
      return Response.json({
        error: 'Fake production batch allowlist is not configured',
        error_code: 'fake_batch_not_configured',
      }, { status: 409 });
    }

    const base44 = createClientFromRequest(req);
    const batch = await findProductionBatch(base44, productionBatchId);
    if (!batch) {
      return Response.json({ error: 'Production batch not found', error_code: 'batch_not_found' }, { status: 404 });
    }

    const batchDisplayId = normalizeSingleLine(batch.batch_id);
    if (expectedBatchDisplayId && expectedBatchDisplayId !== batchDisplayId) {
      return Response.json({ error: 'batch_id does not match target batch', error_code: 'batch_id_mismatch' }, { status: 409 });
    }

    const previousStatus = normalizeSingleLine(batch.status);
    if (expectedStatus && expectedStatus !== previousStatus) {
      return Response.json({ error: 'expected_status does not match target batch', error_code: 'expected_status_mismatch' }, { status: 409 });
    }

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
        }));
      }
      if (isCoherentInProduction(batch)) {
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
        }));
      }
      return Response.json({
        error: 'Conflicting prior command log for request_id',
        error_code: 'idempotency_conflict',
      }, { status: 409 });
    }

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
        errorCode: 'fake_test_gate_failed',
        detailsSummary: fakeGate.failures.join(', '),
        timestamp: now,
        durationMs: Date.now() - startTime,
      })).catch(() => null);
      return Response.json({
        error: 'Fake/test batch gate failed',
        error_code: 'fake_test_gate_failed',
      }, { status: 409 });
    }

    const transition = evaluateTransition(batch);
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

    const manualResult = await updateLinkedManualBatch(base44, batch, now);

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
    }));
  } catch (error) {
    console.error(`[${FUNCTION_NAME}]`, sanitizeText(error?.message || 'Unexpected error', 200));
    return Response.json({
      error: 'Unable to start production batch',
      error_code: 'internal_error',
    }, { status: 500 });
  }
});
