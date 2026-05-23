import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const COMMAND = 'ops_alert_status_update';
const TARGET_TYPE = 'HubAlert';
const SOURCE = 'customer_app_admin';
const COMMAND_SOURCE = 'customer_app';
const MAX_NOTE_LENGTH = 500;
const MAX_TEXT_LENGTH = 120;

const VALID_ACTIONS = new Set(['acknowledge', 'resolve', 'dismiss']);
const ACTIVE_STATUSES = new Set(['unread', 'read', 'acknowledged']);
const TERMINAL_STATUSES = new Set(['resolved', 'dismissed']);
const VALID_STATUSES = new Set(['unread', 'read', 'acknowledged', 'resolved', 'dismissed']);
const IDEMPOTENT_SUCCESS_STATUSES = new Set(['success', 'skipped']);
const FORBIDDEN_BODY_KEYS = new Set([
  'raw_alert_payload',
  'raw_payload',
  'payload',
  'raw_body',
  'raw_message',
  'message',
  'route',
  'deep_link',
  'action_url',
  'url',
  'recommended_action',
  'related_record_id',
  'related_record_ids',
  'provider_id',
  'provider_ids',
  'stripe_event_id',
  'shopify_order_id',
  'bulk_ids',
  'order_update',
  'task_update',
  'batch_update',
  'inventory_update',
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
  if (text.length > 160 || !/^[A-Za-z0-9._:@/-]+$/.test(text)) {
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

function normalizeActorRole(value) {
  const role = sanitizeText(value, 60);
  if (!role) throw new Error('actor_role is required');
  return role;
}

function normalizeAction(value) {
  const action = normalizeLower(value);
  if (!action) throw new Error('action is required');
  if (!VALID_ACTIONS.has(action)) {
    throw new Error('action must be one of acknowledge, resolve, dismiss');
  }
  return action;
}

function normalizeSource(value) {
  const source = normalizeLower(value);
  if (source !== SOURCE) {
    throw new Error('source must be customer_app_admin');
  }
  return source;
}

function normalizeResolutionNote(value, action) {
  const note = sanitizeText(value, MAX_NOTE_LENGTH);
  if (note && action !== 'resolve') {
    throw new Error('resolution_note is only accepted for resolve');
  }
  return note;
}

function findForbiddenBodyKey(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  for (const key of Object.keys(body)) {
    const normalized = normalizeLower(key);
    if (FORBIDDEN_BODY_KEYS.has(normalized)) return key;
    if (/(^|_)(order|task|batch|inventory|review_queue)_(id|ids|status|update|mutation|payload)$/i.test(normalized)) {
      return key;
    }
  }

  return null;
}

function desiredStatusForAction(action) {
  if (action === 'acknowledge') return 'acknowledged';
  if (action === 'resolve') return 'resolved';
  if (action === 'dismiss') return 'dismissed';
  return null;
}

function evaluateTransition(previousStatus, action) {
  const status = normalizeLower(previousStatus);
  const desiredStatus = desiredStatusForAction(action);

  if (!VALID_STATUSES.has(status)) {
    return {
      allowed: false,
      skipped: false,
      newStatus: status || null,
      errorCode: 'unknown_status',
      message: 'Alert status is not supported for this command',
    };
  }

  if (status === desiredStatus) {
    return {
      allowed: true,
      skipped: true,
      newStatus: status,
      errorCode: null,
      message: 'Command already applied',
    };
  }

  if (TERMINAL_STATUSES.has(status)) {
    return {
      allowed: false,
      skipped: false,
      newStatus: status,
      errorCode: 'terminal_state',
      message: 'Resolved and dismissed alerts are terminal',
    };
  }

  if (action === 'acknowledge' && ['unread', 'read'].includes(status)) {
    return { allowed: true, skipped: false, newStatus: 'acknowledged', errorCode: null, message: null };
  }

  if ((action === 'resolve' || action === 'dismiss') && ACTIVE_STATUSES.has(status)) {
    return { allowed: true, skipped: false, newStatus: desiredStatus, errorCode: null, message: null };
  }

  return {
    allowed: false,
    skipped: false,
    newStatus: status,
    errorCode: 'invalid_transition',
    message: 'Alert status transition is not allowed',
  };
}

function idempotencyKey(requestId, alertId) {
  return requestId;
}

function commandId(requestId, alertId, action) {
  return `${COMMAND}:${TARGET_TYPE}:${alertId}:${action}:${requestId}`;
}

async function findExistingCommandLog(base44, requestId, alertId) {
  const candidates = await base44.asServiceRole.entities.HubCommandLog.filter(
    { idempotency_key: idempotencyKey(requestId, alertId) },
    '-created_date',
    20,
  ).catch(() => []);

  return (candidates || []).find(log => (
    log.command_type === COMMAND &&
    log.target_entity === TARGET_TYPE &&
    log.target_id === alertId &&
    log.idempotency_key === requestId
  )) || null;
}

function buildNotes({
  requestId,
  action,
  previousStatus,
  newStatus,
  detailsSummary,
  resolutionNote,
}) {
  return JSON.stringify({
    action: sanitizeText(action, 40),
    previous_status: sanitizeText(previousStatus, 40),
    new_status: sanitizeText(newStatus, 40),
    source: SOURCE,
    request_id: sanitizeText(requestId, 160),
    resolution_note_summary: sanitizeText(resolutionNote, 160) || null,
    details_summary: sanitizeText(detailsSummary, 200) || null,
  });
}

function parseNotesMetadata(notes) {
  try {
    const parsed = JSON.parse(normalizeText(notes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return {
      action: sanitizeText(parsed.action, 40),
      previous_status: sanitizeText(parsed.previous_status, 40),
      new_status: sanitizeText(parsed.new_status, 40),
      request_id: sanitizeText(parsed.request_id, 160),
    };
  } catch {
    return {};
  }
}

function buildLogPayload({
  requestId,
  alertId,
  action,
  actorEmail,
  actorRole,
  previousStatus,
  newStatus,
  status,
  errorCode,
  detailsSummary,
  resolutionNote,
  timestamp,
  durationMs,
}) {
  const safeNotes = buildNotes({
    requestId,
    action,
    previousStatus,
    newStatus,
    detailsSummary,
    resolutionNote,
  });
  const liveStatus = status === 'error' ? 'failed' : status;
  return {
    command_id: commandId(requestId, alertId, action),
    command_type: COMMAND,
    command_source: COMMAND_SOURCE,
    status: liveStatus,
    target_entity: TARGET_TYPE,
    target_id: alertId,
    target_display_id: alertId,
    actor_email: actorEmail,
    actor_role: actorRole,
    actor_type: 'admin',
    idempotency_key: idempotencyKey(requestId, alertId),
    idempotent_skipped: status === 'skipped',
    submitted_at: timestamp,
    started_at: timestamp,
    completed_at: timestamp,
    duration_ms: durationMs,
    function_name: 'updateOpsAlertStatusForCustomerApp',
    notes: safeNotes,
    error_code: errorCode || null,
    error_message: errorCode ? sanitizeText(detailsSummary, 200) : null,
  };
}

async function createCommandLog(base44, payload) {
  await base44.asServiceRole.entities.HubCommandLog.create(payload);
}

function buildAlertUpdate(action, actorEmail, timestamp, resolutionNote) {
  if (action === 'acknowledge') {
    return {
      status: 'acknowledged',
      acknowledged_by: actorEmail,
      acknowledged_at: timestamp,
    };
  }

  if (action === 'resolve') {
    const update = {
      status: 'resolved',
      resolved_by: actorEmail,
      resolved_at: timestamp,
    };
    if (resolutionNote) update.resolution_notes = resolutionNote;
    return update;
  }

  return {
    status: 'dismissed',
    dismissed_by: actorEmail,
    dismissed_at: timestamp,
  };
}

async function findAlert(base44, alertId) {
  const alerts = await base44.asServiceRole.entities.HubAlert.filter({ id: alertId }, '-updated_date', 1);
  return alerts?.[0] || null;
}

function safeCommandResponse({ alertId, action, previousStatus, status, requestId, skipped, updatedAt }) {
  return {
    success: true,
    alert_id: alertId,
    action,
    previous_status: previousStatus || null,
    status: status || null,
    request_id: requestId,
    skipped: skipped === true,
    updated_at: updatedAt || null,
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
    const forbiddenKey = findForbiddenBodyKey(body);
    if (forbiddenKey) {
      return Response.json({ error: `Unsupported field: ${forbiddenKey}` }, { status: 400 });
    }

    let alertId;
    let action;
    let requestId;
    let actorEmail;
    let actorRole;
    let source;
    let resolutionNote;

    try {
      alertId = normalizeId(body.alert_id, 'alert_id');
      action = normalizeAction(body.action);
      requestId = normalizeId(body.request_id, 'request_id');
      actorEmail = normalizeActorEmail(body.actor_email);
      actorRole = normalizeActorRole(body.actor_role);
      source = normalizeSource(body.source);
      resolutionNote = normalizeResolutionNote(body.resolution_note, action);
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const existingLog = await findExistingCommandLog(base44, requestId, alertId);
    if (existingLog) {
      const existingStatus = normalizeLower(existingLog.status);
      const existingMetadata = parseNotesMetadata(existingLog.notes);
      const previousStatus = normalizeLower(existingMetadata.previous_status);
      const newStatus = normalizeLower(existingMetadata.new_status) || previousStatus || null;

      if (IDEMPOTENT_SUCCESS_STATUSES.has(existingStatus)) {
        return Response.json(safeCommandResponse({
          alertId,
          action: existingMetadata.action || action,
          previousStatus,
          status: newStatus,
          requestId,
          skipped: true,
          updatedAt: existingLog.completed_at || existingLog.created_date || null,
        }));
      }

      if (existingStatus === 'rejected') {
        return Response.json({
          success: false,
          error: 'Command request was already rejected',
          request_id: requestId,
          skipped: true,
        }, { status: 409 });
      }

      return Response.json({
        success: false,
        error: 'Command request already exists and did not complete successfully',
        request_id: requestId,
        skipped: true,
      }, { status: 500 });
    }

    const alert = await findAlert(base44, alertId);
    if (!alert) {
      return Response.json({
        success: false,
        error: 'Alert not found',
        request_id: requestId,
      }, { status: 404 });
    }

    const previousStatus = normalizeLower(alert.status);
    const transition = evaluateTransition(previousStatus, action);
    const timestamp = new Date().toISOString();

    if (!transition.allowed) {
      await createCommandLog(base44, buildLogPayload({
        requestId,
        alertId,
        action,
        actorEmail,
        actorRole,
        previousStatus,
        newStatus: previousStatus,
        status: 'rejected',
        errorCode: transition.errorCode,
        detailsSummary: transition.message,
        resolutionNote: null,
        timestamp,
        durationMs: Date.now() - startTime,
      }));

      return Response.json({
        success: false,
        error: transition.message,
        error_code: transition.errorCode,
        alert_id: alertId,
        action,
        previous_status: previousStatus,
        status: previousStatus,
        request_id: requestId,
      }, { status: 409 });
    }

    if (transition.skipped) {
      await createCommandLog(base44, buildLogPayload({
        requestId,
        alertId,
        action,
        actorEmail,
        actorRole,
        previousStatus,
        newStatus: transition.newStatus,
        status: 'skipped',
        errorCode: null,
        detailsSummary: 'Command already applied; no alert update performed',
        resolutionNote,
        timestamp,
        durationMs: Date.now() - startTime,
      }));

      return Response.json(safeCommandResponse({
        alertId,
        action,
        previousStatus,
        status: transition.newStatus,
        requestId,
        skipped: true,
        updatedAt: timestamp,
      }));
    }

    try {
      await base44.asServiceRole.entities.HubAlert.update(
        alert.id,
        buildAlertUpdate(action, actorEmail, timestamp, resolutionNote),
      );

      await createCommandLog(base44, buildLogPayload({
        requestId,
        alertId,
        action,
        actorEmail,
        actorRole,
        previousStatus,
        newStatus: transition.newStatus,
        status: 'success',
        errorCode: null,
        detailsSummary: `Ops alert ${action} applied from Customer App admin`,
        resolutionNote,
        timestamp,
        durationMs: Date.now() - startTime,
      }));
    } catch (error) {
      await createCommandLog(base44, buildLogPayload({
        requestId,
        alertId,
        action,
        actorEmail,
        actorRole,
        previousStatus,
        newStatus: previousStatus,
        status: 'error',
        errorCode: 'update_failed',
        detailsSummary: 'Ops alert command failed during update',
        resolutionNote: null,
        timestamp,
        durationMs: Date.now() - startTime,
      })).catch(() => null);

      console.error('[UPDATE-OPS-ALERT-STATUS] command failed:', error.message);
      return Response.json({ error: 'Unable to update alert status' }, { status: 500 });
    }

    return Response.json(safeCommandResponse({
      alertId,
      action,
      previousStatus,
      status: transition.newStatus,
      requestId,
      skipped: false,
      updatedAt: timestamp,
    }));
  } catch (error) {
    console.error('[UPDATE-OPS-ALERT-STATUS] Error:', error.message);
    return Response.json({ error: 'Unable to update alert status' }, { status: 500 });
  }
});
