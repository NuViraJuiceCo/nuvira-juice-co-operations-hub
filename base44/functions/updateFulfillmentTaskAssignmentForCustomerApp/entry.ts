import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const COMMAND = 'fulfillment_task_assignment_update';
const TARGET_TYPE = 'FulfillmentTask';
const SOURCE = 'customer_app_admin';
const COMMAND_SOURCE = 'customer_app';
const FUNCTION_NAME = 'updateFulfillmentTaskAssignmentForCustomerApp';

const MAX_TEXT_LENGTH = 120;
const MAX_NOTE_LENGTH = 300;
const VALID_ACTIONS = new Set(['assign', 'unassign']);
const ALLOWED_STATUSES = new Set(['Unassigned', 'Scheduled']);
const IDEMPOTENT_SUCCESS_STATUSES = new Set(['success', 'skipped']);
const FORBIDDEN_BODY_KEYS = new Set([
  'raw_task',
  'task',
  'raw_order',
  'order',
  'payload',
  'raw_payload',
  'raw_body',
  'customer_name',
  'customer_email',
  'customer_phone',
  'address',
  'delivery_address',
  'address_line1',
  'address_line2',
  'address_city',
  'address_state',
  'address_postal_code',
  'driver_notes',
  'internal_notes',
  'notes',
  'delivery_status',
  'delivered_at',
  'delivery_photo_url',
  'delivery_drop_location',
  'proof',
  'proof_url',
  'route',
  'route_order',
  'optimized_route',
  'bag_return',
  'bag_return_id',
  'credit',
  'credit_issued',
  'order_update',
  'batch_update',
  'inventory_update',
  'review_queue_update',
  'provider_id',
  'provider_ids',
  'stripe_event_id',
  'shopify_order_id',
  'bulk_ids',
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

function normalizeId(value, fieldName) {
  const text = normalizeSingleLine(value);
  if (!text) throw new Error(`${fieldName} is required`);
  if (text.length > 160 || !/^[A-Za-z0-9._:@/-]+$/.test(text)) {
    throw new Error(`${fieldName} contains unsupported characters`);
  }
  return text;
}

function normalizeAction(value) {
  const action = normalizeLower(value);
  if (!action) throw new Error('action is required');
  if (!VALID_ACTIONS.has(action)) {
    throw new Error('action must be one of assign, unassign');
  }
  return action;
}

function normalizeAssignedDriver(value, action) {
  const hasValue = value !== undefined && value !== null && normalizeSingleLine(value) !== '';
  if (action === 'unassign') {
    if (hasValue) throw new Error('assigned_driver is not accepted for unassign');
    return null;
  }

  if (!hasValue) throw new Error('assigned_driver is required for assign');

  const driver = normalizeSingleLine(value);
  if (driver.length > 120) throw new Error('assigned_driver is too long');
  if (!/^[A-Za-z0-9 ._'@+-]+$/.test(driver)) {
    throw new Error('assigned_driver contains unsupported characters');
  }
  if (/^\d+$/.test(driver) || driver.length < 2) {
    throw new Error('assigned_driver must be a safe internal driver label or email');
  }

  return driver;
}

function normalizeReason(value) {
  return sanitizeText(value, MAX_NOTE_LENGTH);
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
  if (source !== SOURCE) {
    throw new Error('source must be customer_app_admin');
  }
  return source;
}

function findForbiddenBodyKey(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  for (const key of Object.keys(body)) {
    const normalized = normalizeLower(key);
    if (FORBIDDEN_BODY_KEYS.has(normalized)) return key;
    if (/(^|_)(order|batch|inventory|review_queue|delivery|route|proof|bag)_(id|ids|status|update|mutation|payload)$/i.test(normalized)) {
      return key;
    }
  }

  return null;
}

function evaluateAssignment(task, action, assignedDriver) {
  const previousStatus = normalizeSingleLine(task.status);
  const previousDriver = normalizeSingleLine(task.assigned_driver);

  if (!ALLOWED_STATUSES.has(previousStatus)) {
    return {
      allowed: false,
      skipped: false,
      previousStatus,
      newStatus: previousStatus || null,
      previousDriver: previousDriver || null,
      newDriver: previousDriver || null,
      errorCode: 'invalid_task_status',
      message: 'Only Unassigned or Scheduled tasks can be assigned in this command',
    };
  }

  if (action === 'assign') {
    if (previousStatus === 'Scheduled' && previousDriver === assignedDriver) {
      return {
        allowed: true,
        skipped: true,
        previousStatus,
        newStatus: 'Scheduled',
        previousDriver: previousDriver || null,
        newDriver: assignedDriver,
        errorCode: null,
        message: 'Assignment already applied',
      };
    }

    return {
      allowed: true,
      skipped: false,
      previousStatus,
      newStatus: 'Scheduled',
      previousDriver: previousDriver || null,
      newDriver: assignedDriver,
      errorCode: null,
      message: null,
    };
  }

  if (previousStatus === 'Unassigned' && !previousDriver) {
    return {
      allowed: true,
      skipped: true,
      previousStatus,
      newStatus: 'Unassigned',
      previousDriver: null,
      newDriver: null,
      errorCode: null,
      message: 'Task is already unassigned',
    };
  }

  return {
    allowed: true,
    skipped: false,
    previousStatus,
    newStatus: 'Unassigned',
    previousDriver: previousDriver || null,
    newDriver: null,
    errorCode: null,
    message: null,
  };
}

function commandId(requestId, taskId, action) {
  return `${COMMAND}:${TARGET_TYPE}:${taskId}:${action}:${requestId}`;
}

async function findExistingCommandLog(base44, requestId, taskId) {
  const candidates = await base44.asServiceRole.entities.HubCommandLog.filter(
    { idempotency_key: requestId },
    '-created_date',
    20,
  ).catch(() => []);

  return (candidates || []).find(log => (
    log.command_type === COMMAND &&
    log.target_entity === TARGET_TYPE &&
    log.target_id === taskId &&
    log.idempotency_key === requestId
  )) || null;
}

function buildNotes({
  requestId,
  action,
  previousDriver,
  newDriver,
  previousStatus,
  newStatus,
  reason,
  detailsSummary,
}) {
  return JSON.stringify({
    action: sanitizeMetadataValue(action, 40),
    previous_driver: sanitizeMetadataValue(previousDriver, 120) || null,
    new_driver: sanitizeMetadataValue(newDriver, 120) || null,
    previous_status: sanitizeMetadataValue(previousStatus, 40) || null,
    new_status: sanitizeMetadataValue(newStatus, 40) || null,
    source: SOURCE,
    request_id: sanitizeMetadataValue(requestId, 160),
    reason: sanitizeText(reason, 160) || null,
    details_summary: sanitizeText(detailsSummary, 200) || null,
  });
}

function parseNotesMetadata(notes) {
  try {
    const parsed = JSON.parse(normalizeText(notes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return {
      action: sanitizeMetadataValue(parsed.action, 40),
      previous_driver: sanitizeMetadataValue(parsed.previous_driver, 120) || null,
      new_driver: sanitizeMetadataValue(parsed.new_driver, 120) || null,
      previous_status: sanitizeMetadataValue(parsed.previous_status, 40) || null,
      new_status: sanitizeMetadataValue(parsed.new_status, 40) || null,
      request_id: sanitizeMetadataValue(parsed.request_id, 160),
    };
  } catch {
    return {};
  }
}

function buildLogPayload({
  requestId,
  taskId,
  action,
  actorEmail,
  actorRole,
  previousDriver,
  newDriver,
  previousStatus,
  newStatus,
  status,
  errorCode,
  detailsSummary,
  reason,
  timestamp,
  durationMs,
}) {
  const liveStatus = status === 'error' ? 'failed' : status;

  return {
    command_id: commandId(requestId, taskId, action),
    command_type: COMMAND,
    command_source: COMMAND_SOURCE,
    status: liveStatus,
    target_entity: TARGET_TYPE,
    target_id: taskId,
    target_display_id: taskId,
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
      action,
      previousDriver,
      newDriver,
      previousStatus,
      newStatus,
      reason,
      detailsSummary,
    }),
    error_code: errorCode || null,
    error_message: errorCode ? sanitizeText(detailsSummary, 200) : null,
  };
}

async function createCommandLog(base44, payload) {
  await base44.asServiceRole.entities.HubCommandLog.create(payload);
}

async function findFulfillmentTask(base44, taskId) {
  const tasks = await base44.asServiceRole.entities.FulfillmentTask.filter({ id: taskId }, '-updated_date', 1);
  return tasks?.[0] || null;
}

function buildTaskUpdate(action, assignedDriver) {
  if (action === 'assign') {
    return {
      assigned_driver: assignedDriver,
      status: 'Scheduled',
    };
  }

  return {
    assigned_driver: null,
    status: 'Unassigned',
  };
}

function safeCommandResponse({
  taskId,
  action,
  previousDriver,
  assignedDriver,
  previousStatus,
  status,
  requestId,
  skipped,
  updatedAt,
}) {
  return {
    success: true,
    fulfillment_task_id: taskId,
    action,
    previous_driver: previousDriver || null,
    assigned_driver: assignedDriver || null,
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

    let taskId;
    let action;
    let requestId;
    let assignedDriver;
    let actorEmail;
    let actorRole;
    let reason;

    try {
      taskId = normalizeId(body.fulfillment_task_id, 'fulfillment_task_id');
      action = normalizeAction(body.action);
      requestId = normalizeId(body.request_id, 'request_id');
      assignedDriver = normalizeAssignedDriver(body.assigned_driver, action);
      actorEmail = normalizeActorEmail(body.actor_email);
      actorRole = normalizeActorRole(body.actor_role);
      normalizeSource(body.source);
      reason = normalizeReason(body.reason);
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const existingLog = await findExistingCommandLog(base44, requestId, taskId);
    if (existingLog) {
      const existingStatus = normalizeLower(existingLog.status);
      const metadata = parseNotesMetadata(existingLog.notes);

      if (IDEMPOTENT_SUCCESS_STATUSES.has(existingStatus)) {
        return Response.json(safeCommandResponse({
          taskId,
          action: metadata.action || action,
          previousDriver: metadata.previous_driver,
          assignedDriver: metadata.new_driver,
          previousStatus: metadata.previous_status,
          status: metadata.new_status,
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

    const task = await findFulfillmentTask(base44, taskId);
    if (!task) {
      return Response.json({
        success: false,
        error: 'Fulfillment task not found',
        request_id: requestId,
      }, { status: 404 });
    }

    const transition = evaluateAssignment(task, action, assignedDriver);
    const timestamp = new Date().toISOString();

    if (!transition.allowed) {
      await createCommandLog(base44, buildLogPayload({
        requestId,
        taskId,
        action,
        actorEmail,
        actorRole,
        previousDriver: transition.previousDriver,
        newDriver: transition.previousDriver,
        previousStatus: transition.previousStatus,
        newStatus: transition.previousStatus,
        status: 'rejected',
        errorCode: transition.errorCode,
        detailsSummary: transition.message,
        reason,
        timestamp,
        durationMs: Date.now() - startTime,
      }));

      return Response.json({
        success: false,
        error: transition.message,
        error_code: transition.errorCode,
        fulfillment_task_id: taskId,
        action,
        previous_driver: transition.previousDriver,
        assigned_driver: transition.previousDriver,
        previous_status: transition.previousStatus,
        status: transition.previousStatus,
        request_id: requestId,
      }, { status: 409 });
    }

    if (transition.skipped) {
      await createCommandLog(base44, buildLogPayload({
        requestId,
        taskId,
        action,
        actorEmail,
        actorRole,
        previousDriver: transition.previousDriver,
        newDriver: transition.newDriver,
        previousStatus: transition.previousStatus,
        newStatus: transition.newStatus,
        status: 'skipped',
        errorCode: null,
        detailsSummary: transition.message,
        reason,
        timestamp,
        durationMs: Date.now() - startTime,
      }));

      return Response.json(safeCommandResponse({
        taskId,
        action,
        previousDriver: transition.previousDriver,
        assignedDriver: transition.newDriver,
        previousStatus: transition.previousStatus,
        status: transition.newStatus,
        requestId,
        skipped: true,
        updatedAt: timestamp,
      }));
    }

    try {
      await base44.asServiceRole.entities.FulfillmentTask.update(
        task.id,
        buildTaskUpdate(action, assignedDriver),
      );

      await createCommandLog(base44, buildLogPayload({
        requestId,
        taskId,
        action,
        actorEmail,
        actorRole,
        previousDriver: transition.previousDriver,
        newDriver: transition.newDriver,
        previousStatus: transition.previousStatus,
        newStatus: transition.newStatus,
        status: 'success',
        errorCode: null,
        detailsSummary: `Fulfillment task ${action} applied from Customer App admin`,
        reason,
        timestamp,
        durationMs: Date.now() - startTime,
      }));
    } catch (error) {
      await createCommandLog(base44, buildLogPayload({
        requestId,
        taskId,
        action,
        actorEmail,
        actorRole,
        previousDriver: transition.previousDriver,
        newDriver: transition.previousDriver,
        previousStatus: transition.previousStatus,
        newStatus: transition.previousStatus,
        status: 'error',
        errorCode: 'update_failed',
        detailsSummary: 'Fulfillment task assignment command failed during update',
        reason: null,
        timestamp,
        durationMs: Date.now() - startTime,
      })).catch(() => null);

      console.error('[UPDATE-FULFILLMENT-TASK-ASSIGNMENT] command failed:', error.message);
      return Response.json({ error: 'Unable to update fulfillment task assignment' }, { status: 500 });
    }

    return Response.json(safeCommandResponse({
      taskId,
      action,
      previousDriver: transition.previousDriver,
      assignedDriver: transition.newDriver,
      previousStatus: transition.previousStatus,
      status: transition.newStatus,
      requestId,
      skipped: false,
      updatedAt: timestamp,
    }));
  } catch (error) {
    console.error('[UPDATE-FULFILLMENT-TASK-ASSIGNMENT] Error:', error.message);
    return Response.json({ error: 'Unable to update fulfillment task assignment' }, { status: 500 });
  }
});
