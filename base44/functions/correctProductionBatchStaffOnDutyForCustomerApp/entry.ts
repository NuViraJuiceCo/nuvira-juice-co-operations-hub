import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const ALLOWED_EMAILS = Deno.env.get('PRODUCTION_STAFF_CORRECTION_ALLOWED_EMAILS') || '';

const FUNCTION_NAME = 'correctProductionBatchStaffOnDutyForCustomerApp';
const COMMAND = 'production_batch_staff_on_duty_correction';
const COMMAND_SOURCE = 'customer_app';
const SOURCE = 'customer_app_admin';
const TARGET_TYPE = 'ProductionBatch';
const TARGET_PRODUCTION_BATCH_ID = '6a0801a8c1bc6f6b2cbfb174';
const TARGET_BATCH_ID = 'BATCH-20260522-RE-NU';
const REQUIRED_STATUS = 'completed_pending_verification';
const MAX_TEXT_LENGTH = 160;
const MAX_STAFF_COUNT = 12;
const MAX_STAFF_LENGTH = 80;

const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'batch_id',
  'request_id',
  'staff_on_duty',
  'reason',
  'actor_email',
  'actor_role',
  'source',
]);

const IDEMPOTENT_SUCCESS_STATUSES = new Set(['success', 'skipped']);
const PLACEHOLDER_STAFF_VALUES = new Set([
  'paste exact approved staff values here',
  'paste exact staff on duty value here',
  'paste_exact_approved_staff_values_here',
  '[paste exact staff on duty value here]',
  '[paste_exact_approved_staff_values_here]',
  'unknown',
  'tbd',
  'test',
  'none',
  'n/a',
  'na',
  'placeholder',
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

function normalizeId(value, fieldName) {
  const text = normalizeSingleLine(value);
  if (!text) throw new Error(`${fieldName} is required`);
  if (text.length > 180 || !/^[A-Za-z0-9._:@/-]+$/.test(text)) {
    throw new Error(`${fieldName} contains unsupported characters`);
  }
  return text;
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

function isActorAllowed(actorEmail, actorRole) {
  if (normalizeLower(actorRole) !== 'admin') return false;
  return parseEmailAllowlist(ALLOWED_EMAILS).has(normalizeLower(actorEmail));
}

function findUnsupportedBodyKey(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const key of Object.keys(body)) {
    if (!ALLOWED_BODY_KEYS.has(normalizeLower(key))) return key;
  }
  return null;
}

function normalizeStaffOnDuty(value) {
  if (!Array.isArray(value)) throw new Error('staff_on_duty must be an array');
  if (value.length > MAX_STAFF_COUNT) throw new Error('staff_on_duty contains too many entries');

  const staff = value.map((entry) => {
    if (typeof entry !== 'string') throw new Error('staff_on_duty values must be strings');
    const text = normalizeSingleLine(entry);
    if (!text) throw new Error('staff_on_duty cannot include empty values');
    if (text.length > MAX_STAFF_LENGTH) throw new Error('staff_on_duty contains an overly long value');
    return text;
  });

  const deduped = [...new Set(staff)];
  if (deduped.length === 0) throw new Error('staff_on_duty must include at least one approved staff value');

  for (const entry of deduped) {
    const normalized = normalizeLower(entry);
    if (PLACEHOLDER_STAFF_VALUES.has(normalized) || normalized.includes('paste exact')) {
      throw new Error('staff_on_duty contains a placeholder value');
    }
    if (!/^[A-Za-z0-9 .,'&()/-]+$/.test(entry)) {
      throw new Error('staff_on_duty contains unsupported characters');
    }
  }

  return deduped;
}

function hasMeaningfulStaff(value) {
  return Array.isArray(value) && value.map(normalizeSingleLine).filter(Boolean).length > 0;
}

function sameStaffList(left, right) {
  const normalizeList = (list) => (Array.isArray(list) ? list : [])
    .map(normalizeSingleLine)
    .filter(Boolean);
  return JSON.stringify(normalizeList(left)) === JSON.stringify(normalizeList(right));
}

function commandId(requestId, productionBatchId) {
  return `${COMMAND}:${TARGET_TYPE}:${productionBatchId}:${requestId}`;
}

function safeError(error, errorCode, message = error) {
  return {
    error: sanitizeText(error, 160),
    error_code: sanitizeText(errorCode, 80),
    message: sanitizeText(message, 180),
  };
}

function safeResponse({
  success,
  productionBatchId,
  batchDisplayId,
  previousStaffCount,
  staffCount,
  status,
  requestId,
  skipped = false,
  updatedAt,
}) {
  return {
    success: success === true,
    production_batch_id: productionBatchId,
    batch_id: batchDisplayId || null,
    previous_staff_on_duty_count: Number(previousStaffCount) || 0,
    staff_on_duty_count: Number(staffCount) || 0,
    status: status || null,
    request_id: requestId,
    skipped: skipped === true,
    updated_at: updatedAt || null,
  };
}

function buildNotes({
  requestId,
  batchDisplayId,
  previousStaffCount,
  newStaffCount,
  previousStatus,
  status,
}) {
  return JSON.stringify({
    batch_id: sanitizeText(batchDisplayId, 80),
    previous_staff_on_duty_count: Number(previousStaffCount) || 0,
    new_staff_on_duty_count: Number(newStaffCount) || 0,
    previous_status: sanitizeText(previousStatus, 80),
    status: sanitizeText(status, 80),
    source: SOURCE,
    request_id: sanitizeText(requestId, 160),
    correction_type: 'staff_on_duty_only',
    verification_excluded: true,
    compliance_log_excluded: true,
    side_effects_excluded: true,
  });
}

function parseNotesMetadata(notes) {
  try {
    const parsed = JSON.parse(normalizeText(notes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return {
      previous_staff_on_duty_count: Number(parsed.previous_staff_on_duty_count) || 0,
      new_staff_on_duty_count: Number(parsed.new_staff_on_duty_count) || 0,
      status: sanitizeText(parsed.status, 80),
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
  previousStaffCount,
  newStaffCount,
  previousStatus,
  status,
  timestamp,
  durationMs,
  errorCode,
  detailsSummary,
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
      previousStaffCount,
      newStaffCount,
      previousStatus,
      status: previousStatus,
    }),
    error_code: errorCode || null,
    error_message: errorCode ? sanitizeText(detailsSummary, 200) : null,
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

async function findExistingCommandLog(base44, requestId, productionBatchId) {
  const candidates = await base44.asServiceRole.entities.HubCommandLog.filter(
    { idempotency_key: requestId },
    '-created_date',
    20,
  ).catch(() => []);

  return (candidates || []).find((log) => (
    log.command_type === COMMAND &&
    log.target_entity === TARGET_TYPE &&
    log.target_id === productionBatchId &&
    log.idempotency_key === requestId
  )) || null;
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
    let batchDisplayId;
    let requestId;
    let staffOnDuty;
    let actorEmail;
    let actorRole;

    try {
      productionBatchId = normalizeId(body.production_batch_id, 'production_batch_id');
      batchDisplayId = normalizeId(body.batch_id, 'batch_id');
      requestId = normalizeId(body.request_id, 'request_id');
      staffOnDuty = normalizeStaffOnDuty(body.staff_on_duty);
      actorEmail = normalizeActorEmail(body.actor_email);
      actorRole = sanitizeText(body.actor_role, 60) || 'admin';
      normalizeSource(body.source);
      sanitizeText(body.reason, 120);
    } catch (error) {
      return Response.json(safeError(error.message, 'invalid_input'), { status: 400 });
    }

    if (productionBatchId !== TARGET_PRODUCTION_BATCH_ID || batchDisplayId !== TARGET_BATCH_ID) {
      return Response.json(safeError('Batch is not approved for staff correction', 'batch_not_allowlisted'), { status: 409 });
    }

    if (!isActorAllowed(actorEmail, actorRole)) {
      return Response.json(safeError('Actor is not allowed for staff correction', 'actor_not_allowed'), { status: 403 });
    }

    const batch = await findProductionBatch(base44, productionBatchId);
    if (!batch) {
      return Response.json(safeError('ProductionBatch not found', 'batch_not_found'), { status: 404 });
    }

    if (normalizeSingleLine(batch.batch_id) !== TARGET_BATCH_ID) {
      return Response.json(safeError('batch_id does not match target batch', 'batch_id_mismatch'), { status: 409 });
    }

    const existingLog = await findExistingCommandLog(base44, requestId, productionBatchId);
    if (existingLog && IDEMPOTENT_SUCCESS_STATUSES.has(normalizeLower(existingLog.status))) {
      const metadata = parseNotesMetadata(existingLog.notes);
      return Response.json(safeResponse({
        success: true,
        productionBatchId,
        batchDisplayId: TARGET_BATCH_ID,
        previousStaffCount: metadata.previous_staff_on_duty_count,
        staffCount: metadata.new_staff_on_duty_count || (Array.isArray(batch.staff_on_duty) ? batch.staff_on_duty.length : 0),
        status: sanitizeText(batch.status, 80),
        requestId,
        skipped: true,
        updatedAt: sanitizeText(existingLog.completed_at || existingLog.updated_date, 80) || null,
      }));
    }
    if (existingLog) {
      return Response.json(safeError('Conflicting idempotency record exists', 'idempotency_conflict'), { status: 409 });
    }

    if (normalizeSingleLine(batch.status) !== REQUIRED_STATUS) {
      return Response.json(safeError('Batch is not in the approved correction status', 'invalid_status_transition'), { status: 409 });
    }

    if (batch.is_locked === true) {
      return Response.json(safeError('Batch is locked', 'batch_locked'), { status: 409 });
    }

    if (hasMeaningfulStaff(batch.staff_on_duty)) {
      if (sameStaffList(batch.staff_on_duty, staffOnDuty)) {
        return Response.json(safeError('staff_on_duty is already present without matching command audit', 'staff_on_duty_already_present'), { status: 409 });
      }
      return Response.json(safeError('staff_on_duty already contains a different value', 'staff_on_duty_conflict'), { status: 409 });
    }

    const now = new Date().toISOString();
    const previousStaffCount = 0;
    const newStaffCount = staffOnDuty.length;
    const durationMs = Date.now() - startedMs;

    let commandLog;
    try {
      commandLog = await base44.asServiceRole.entities.HubCommandLog.create(buildLogPayload({
        requestId,
        productionBatchId,
        batchDisplayId: TARGET_BATCH_ID,
        actorEmail,
        actorRole,
        previousStaffCount,
        newStaffCount,
        previousStatus: batch.status,
        status: 'processing',
        timestamp: submittedAt,
        durationMs,
      }));
    } catch {
      return Response.json(safeError('Command audit could not be created', 'command_log_failed'), { status: 500 });
    }

    const existingAuditTrail = Array.isArray(batch.audit_trail) ? batch.audit_trail : [];
    const auditEntry = {
      timestamp: now,
      action: 'StaffOnDutyCorrected',
      performed_by: actorEmail,
      source: SOURCE,
      request_id: requestId,
      correction_type: 'staff_on_duty_only',
      before: {
        status: batch.status,
        staff_on_duty_count: previousStaffCount,
      },
      after: {
        status: batch.status,
        staff_on_duty_count: newStaffCount,
      },
      verification_excluded: true,
      compliance_log_excluded: true,
      side_effects_excluded: true,
    };

    await base44.asServiceRole.entities.ProductionBatch.update(batch.id, {
      staff_on_duty: staffOnDuty,
      audit_trail: [...existingAuditTrail, auditEntry],
    });

    try {
      await base44.asServiceRole.entities.HubCommandLog.update(commandLog.id, buildLogPayload({
        requestId,
        productionBatchId,
        batchDisplayId: TARGET_BATCH_ID,
        actorEmail,
        actorRole,
        previousStaffCount,
        newStaffCount,
        previousStatus: batch.status,
        status: 'success',
        timestamp: submittedAt,
        durationMs: Date.now() - startedMs,
      }));
    } catch {
      return Response.json(safeError('Staff correction applied but command audit was not finalized', 'command_log_update_failed'), { status: 500 });
    }

    return Response.json(safeResponse({
      success: true,
      productionBatchId,
      batchDisplayId: TARGET_BATCH_ID,
      previousStaffCount,
      staffCount: newStaffCount,
      status: sanitizeText(batch.status, 80),
      requestId,
      skipped: false,
      updatedAt: now,
    }));
  } catch {
    return Response.json(safeError('Internal error', 'internal_error'), { status: 500 });
  }
});
