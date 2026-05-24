import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const COMMAND = 'fulfillment_task_delivered';
const TARGET_TYPE = 'FulfillmentTask';
const SOURCE = 'customer_app_admin';
const COMMAND_SOURCE = 'customer_app';
const FUNCTION_NAME = 'recordFulfillmentTaskDeliveredForCustomerApp';

const MAX_TEXT_LENGTH = 120;
const MAX_REASON_LENGTH = 300;
const COMPLETED_STATUS = 'Completed';
const DELIVERED_STATUS = 'delivered';
const ALLOWED_PREVIOUS_STATUS = 'Out For Delivery';
const CONFLICTING_DELIVERY_STATUSES = new Set(['unable_to_deliver']);
const IDEMPOTENT_SUCCESS_STATUSES = new Set(['success', 'skipped']);
const FORBIDDEN_BODY_KEYS = new Set([
  'action',
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
  'assigned_driver',
  'driver_label',
  'driver_email',
  'driver_name',
  'driver_notes',
  'internal_notes',
  'note',
  'notes',
  'customer_notes',
  'delivery_note',
  'delivery_notes',
  'status',
  'task_status',
  'delivery_status',
  'fulfillment_status',
  'production_status',
  'order_lock_status',
  'status_history',
  'delivered_at',
  'delivered_by',
  'completed_at',
  'delivery_photo_url',
  'delivery_proof_url',
  'delivery_drop_location',
  'drop_location',
  'photo_url',
  'photo_file',
  'proof',
  'proof_file',
  'proof_file_id',
  'proof_photo_url',
  'proof_url',
  'file_url',
  'route',
  'route_order',
  'optimized_route',
  'bag_return',
  'bag_return_id',
  'credit',
  'credit_issued',
  'notification',
  'notify_customer',
  'send_notification',
  'order_update',
  'customer_app_order_update',
  'hub_order_update',
  'batch_update',
  'inventory_update',
  'production_update',
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

function normalizeReason(value) {
  return sanitizeText(value, MAX_REASON_LENGTH);
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
    if (/(^|_)(order|batch|inventory|review_queue|delivery|route|proof|bag|production|notification)_(id|ids|status|update|mutation|payload|url|field|fields)$/i.test(normalized)) {
      return key;
    }
  }

  return null;
}

function evaluateTransition(task) {
  const previousStatus = normalizeSingleLine(task.status);
  const previousDeliveryStatus = normalizeLower(task.delivery_status);
  const assignedDriverPresent = normalizeSingleLine(task.assigned_driver) !== '';

  if (CONFLICTING_DELIVERY_STATUSES.has(previousDeliveryStatus)) {
    return {
      allowed: false,
      skipped: false,
      previousStatus,
      newStatus: previousStatus || null,
      previousDeliveryStatus: previousDeliveryStatus || null,
      newDeliveryStatus: previousDeliveryStatus || null,
      assignedDriverPresent,
      errorCode: 'conflicting_delivery_status',
      message: 'Task has a conflicting delivery status',
    };
  }

  if (previousStatus === COMPLETED_STATUS) {
    return {
      allowed: true,
      skipped: true,
      previousStatus,
      newStatus: COMPLETED_STATUS,
      previousDeliveryStatus: previousDeliveryStatus || null,
      newDeliveryStatus: previousDeliveryStatus || DELIVERED_STATUS,
      assignedDriverPresent,
      errorCode: null,
      message: 'Task is already completed',
    };
  }

  if (!assignedDriverPresent) {
    return {
      allowed: false,
      skipped: false,
      previousStatus,
      newStatus: previousStatus || null,
      previousDeliveryStatus: previousDeliveryStatus || null,
      newDeliveryStatus: previousDeliveryStatus || null,
      assignedDriverPresent,
      errorCode: 'driver_assignment_required',
      message: 'Assigned driver is required before recording delivery',
    };
  }

  if (previousStatus === ALLOWED_PREVIOUS_STATUS) {
    return {
      allowed: true,
      skipped: false,
      previousStatus,
      newStatus: COMPLETED_STATUS,
      previousDeliveryStatus: previousDeliveryStatus || null,
      newDeliveryStatus: DELIVERED_STATUS,
      assignedDriverPresent,
      errorCode: null,
      message: null,
    };
  }

  return {
    allowed: false,
    skipped: false,
    previousStatus,
    newStatus: previousStatus || null,
    previousDeliveryStatus: previousDeliveryStatus || null,
    newDeliveryStatus: previousDeliveryStatus || null,
    assignedDriverPresent,
    errorCode: previousStatus ? 'invalid_task_status' : 'invalid_task_status',
    message: 'Only Out For Delivery tasks can be marked delivered',
  };
}

function commandId(requestId, taskId) {
  return `${COMMAND}:${TARGET_TYPE}:${taskId}:${requestId}`;
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
  previousStatus,
  newStatus,
  previousDeliveryStatus,
  newDeliveryStatus,
  deliveredAt,
  assignedDriverPresent,
  reason,
  detailsSummary,
}) {
  return JSON.stringify({
    previous_status: sanitizeMetadataValue(previousStatus, 40) || null,
    new_status: sanitizeMetadataValue(newStatus, 40) || null,
    previous_delivery_status: sanitizeMetadataValue(previousDeliveryStatus, 40) || null,
    new_delivery_status: sanitizeMetadataValue(newDeliveryStatus, 40) || null,
    delivered_at: sanitizeMetadataValue(deliveredAt, 40) || null,
    assigned_driver_present: assignedDriverPresent === true,
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
      previous_status: sanitizeMetadataValue(parsed.previous_status, 40) || null,
      new_status: sanitizeMetadataValue(parsed.new_status, 40) || null,
      previous_delivery_status: sanitizeMetadataValue(parsed.previous_delivery_status, 40) || null,
      new_delivery_status: sanitizeMetadataValue(parsed.new_delivery_status, 40) || null,
      delivered_at: sanitizeMetadataValue(parsed.delivered_at, 40) || null,
      request_id: sanitizeMetadataValue(parsed.request_id, 160),
    };
  } catch {
    return {};
  }
}

function buildLogPayload({
  requestId,
  taskId,
  actorEmail,
  actorRole,
  previousStatus,
  newStatus,
  previousDeliveryStatus,
  newDeliveryStatus,
  deliveredAt,
  assignedDriverPresent,
  status,
  errorCode,
  detailsSummary,
  reason,
  timestamp,
  durationMs,
}) {
  return {
    command_id: commandId(requestId, taskId),
    command_type: COMMAND,
    command_source: COMMAND_SOURCE,
    status,
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
      previousStatus,
      newStatus,
      previousDeliveryStatus,
      newDeliveryStatus,
      deliveredAt,
      assignedDriverPresent,
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

function safeCommandResponse({
  taskId,
  previousStatus,
  status,
  previousDeliveryStatus,
  deliveryStatus,
  deliveredAt,
  requestId,
  skipped,
  updatedAt,
}) {
  return {
    success: true,
    fulfillment_task_id: taskId,
    previous_status: previousStatus || null,
    status: status || null,
    previous_delivery_status: previousDeliveryStatus || null,
    delivery_status: deliveryStatus || null,
    delivered_at: deliveredAt || null,
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
    let requestId;
    let actorEmail;
    let actorRole;
    let reason;

    try {
      taskId = normalizeId(body.fulfillment_task_id, 'fulfillment_task_id');
      requestId = normalizeId(body.request_id, 'request_id');
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
          previousStatus: metadata.previous_status,
          status: metadata.new_status || COMPLETED_STATUS,
          previousDeliveryStatus: metadata.previous_delivery_status,
          deliveryStatus: metadata.new_delivery_status || DELIVERED_STATUS,
          deliveredAt: metadata.delivered_at || null,
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
    const timestamp = new Date().toISOString();

    if (!task) {
      await createCommandLog(base44, buildLogPayload({
        requestId,
        taskId,
        actorEmail,
        actorRole,
        previousStatus: null,
        newStatus: null,
        previousDeliveryStatus: null,
        newDeliveryStatus: null,
        deliveredAt: null,
        assignedDriverPresent: false,
        status: 'rejected',
        errorCode: 'task_not_found',
        detailsSummary: 'Fulfillment task not found',
        reason,
        timestamp,
        durationMs: Date.now() - startTime,
      })).catch(() => null);

      return Response.json({
        success: false,
        error: 'Fulfillment task not found',
        error_code: 'task_not_found',
        request_id: requestId,
      }, { status: 404 });
    }

    const transition = evaluateTransition(task);

    if (!transition.allowed) {
      await createCommandLog(base44, buildLogPayload({
        requestId,
        taskId,
        actorEmail,
        actorRole,
        previousStatus: transition.previousStatus,
        newStatus: transition.newStatus,
        previousDeliveryStatus: transition.previousDeliveryStatus,
        newDeliveryStatus: transition.newDeliveryStatus,
        deliveredAt: null,
        assignedDriverPresent: transition.assignedDriverPresent,
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
        previous_status: transition.previousStatus,
        status: transition.previousStatus,
        previous_delivery_status: transition.previousDeliveryStatus,
        delivery_status: transition.previousDeliveryStatus,
        request_id: requestId,
      }, { status: 409 });
    }

    if (transition.skipped) {
      await createCommandLog(base44, buildLogPayload({
        requestId,
        taskId,
        actorEmail,
        actorRole,
        previousStatus: transition.previousStatus,
        newStatus: transition.newStatus,
        previousDeliveryStatus: transition.previousDeliveryStatus,
        newDeliveryStatus: transition.newDeliveryStatus,
        deliveredAt: normalizeSingleLine(task.delivered_at) || null,
        assignedDriverPresent: transition.assignedDriverPresent,
        status: 'skipped',
        errorCode: null,
        detailsSummary: transition.message,
        reason,
        timestamp,
        durationMs: Date.now() - startTime,
      }));

      return Response.json(safeCommandResponse({
        taskId,
        previousStatus: transition.previousStatus,
        status: transition.newStatus,
        previousDeliveryStatus: transition.previousDeliveryStatus,
        deliveryStatus: transition.newDeliveryStatus,
        deliveredAt: normalizeSingleLine(task.delivered_at) || null,
        requestId,
        skipped: true,
        updatedAt: timestamp,
      }));
    }

    const deliveredAt = new Date().toISOString();

    try {
      await base44.asServiceRole.entities.FulfillmentTask.update(task.id, {
        status: COMPLETED_STATUS,
        delivery_status: DELIVERED_STATUS,
        delivered_at: deliveredAt,
      });

      await createCommandLog(base44, buildLogPayload({
        requestId,
        taskId,
        actorEmail,
        actorRole,
        previousStatus: transition.previousStatus,
        newStatus: transition.newStatus,
        previousDeliveryStatus: transition.previousDeliveryStatus,
        newDeliveryStatus: transition.newDeliveryStatus,
        deliveredAt,
        assignedDriverPresent: transition.assignedDriverPresent,
        status: 'success',
        errorCode: null,
        detailsSummary: 'Fulfillment task marked delivered from Customer App admin',
        reason,
        timestamp,
        durationMs: Date.now() - startTime,
      }));
    } catch (error) {
      await createCommandLog(base44, buildLogPayload({
        requestId,
        taskId,
        actorEmail,
        actorRole,
        previousStatus: transition.previousStatus,
        newStatus: transition.previousStatus,
        previousDeliveryStatus: transition.previousDeliveryStatus,
        newDeliveryStatus: transition.previousDeliveryStatus,
        deliveredAt: null,
        assignedDriverPresent: transition.assignedDriverPresent,
        status: 'failed',
        errorCode: 'update_failed',
        detailsSummary: 'Delivered command failed during update',
        reason: null,
        timestamp,
        durationMs: Date.now() - startTime,
      })).catch(() => null);

      console.error('[RECORD-FULFILLMENT-TASK-DELIVERED] command failed');
      return Response.json({ error: 'Unable to record fulfillment task delivered' }, { status: 500 });
    }

    return Response.json(safeCommandResponse({
      taskId,
      previousStatus: transition.previousStatus,
      status: transition.newStatus,
      previousDeliveryStatus: transition.previousDeliveryStatus,
      deliveryStatus: transition.newDeliveryStatus,
      deliveredAt,
      requestId,
      skipped: false,
      updatedAt: deliveredAt,
    }));
  } catch (error) {
    console.error('[RECORD-FULFILLMENT-TASK-DELIVERED] Error');
    return Response.json({ error: 'Unable to record fulfillment task delivered' }, { status: 500 });
  }
});
