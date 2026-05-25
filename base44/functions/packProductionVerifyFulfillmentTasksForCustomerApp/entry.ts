import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const ENABLE_REAL_PACK = Deno.env.get('ENABLE_VERIFY_TASK_PACK_CASCADE') === 'true';
const ALLOWED_EMAILS = Deno.env.get('VERIFY_TASK_PACK_ALLOWED_EMAILS') || '';
const BATCH_ALLOWLIST = Deno.env.get('VERIFY_TASK_PACK_BATCH_ALLOWLIST') || '';
const TASK_ALLOWLIST = Deno.env.get('VERIFY_TASK_PACK_TASK_ALLOWLIST') || '';

const FUNCTION_NAME = 'packProductionVerifyFulfillmentTasksForCustomerApp';
const COMMAND = 'production_verify_fulfillment_task_pack';
const TARGET_TYPE = 'ProductionBatch';
const SOURCE = 'customer_app_admin';
const COMMAND_SOURCE = 'customer_app';
const MAX_TASK_IDS = 10;
const PACKABLE_TASK_STATUSES = new Set(['Unassigned', 'Scheduled']);
const TERMINAL_TASK_STATUSES = new Set(['Completed', 'Unable To Deliver', 'Cancelled']);

const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'batch_id',
  'expected_status',
  'request_id',
  'fulfillment_task_ids',
  'reason',
  'actor_email',
  'actor_role',
  'source',
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

function sanitizeText(value, maxLength = 160) {
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

function safeError(error, errorCode, message = error) {
  return {
    error: sanitizeText(error, 180),
    error_code: sanitizeText(errorCode, 80),
    message: sanitizeText(message, 220),
  };
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

function normalizeStatus(value, fieldName = 'expected_status') {
  const text = normalizeSingleLine(value);
  if (!text) throw new Error(`${fieldName} is required`);
  if (text.length > 80 || !/^[A-Za-z0-9._ -]+$/.test(text)) {
    throw new Error(`${fieldName} contains unsupported characters`);
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

function normalizeTaskIds(value) {
  if (!Array.isArray(value)) throw new Error('fulfillment_task_ids must be an array');
  const taskIds = value.map((item) => normalizeId(item, 'fulfillment_task_id')).filter(Boolean);
  if (taskIds.length === 0) throw new Error('fulfillment_task_ids is required');
  if (taskIds.length > MAX_TASK_IDS) throw new Error('too many fulfillment_task_ids');
  if (new Set(taskIds).size !== taskIds.length) throw new Error('duplicate fulfillment_task_ids are not allowed');
  return taskIds;
}

function parseEmailAllowlist(value) {
  return new Set(value.split(',').map(normalizeLower).filter(Boolean));
}

function parseIdAllowlist(value) {
  return new Set(value.split(',').map(normalizeSingleLine).filter(Boolean));
}

function parseBatchAllowlist(value) {
  return new Set(
    value.split(',')
      .map(normalizeSingleLine)
      .filter(Boolean)
      .filter((entry) => entry.includes(':')),
  );
}

function isBatchAllowlisted(productionBatchId, batchId) {
  return parseBatchAllowlist(BATCH_ALLOWLIST).has(`${productionBatchId}:${batchId}`);
}

function areTasksAllowlisted(taskIds) {
  const allowlist = parseIdAllowlist(TASK_ALLOWLIST);
  return allowlist.size > 0 && taskIds.every((taskId) => allowlist.has(taskId));
}

function deliveryDateFromProductionDate(productionDate) {
  if (!productionDate) return '';
  const date = new Date(productionDate);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + 1);
  return date.toISOString().split('T')[0];
}

function collectOrderIds(batch) {
  const sourceIds = (Array.isArray(batch?.order_sources) ? batch.order_sources : [])
    .map((source) => normalizeSingleLine(source?.order_id))
    .filter(Boolean);
  const relatedIds = (Array.isArray(batch?.related_orders) ? batch.related_orders : [])
    .map((orderId) => normalizeSingleLine(orderId))
    .filter(Boolean);
  return new Set([...sourceIds, ...relatedIds]);
}

function commandId(requestId, productionBatchId) {
  return `${COMMAND}:${TARGET_TYPE}:${productionBatchId}:${requestId}`;
}

function buildNotes({
  requestId,
  batchId,
  previousStatus,
  newStatus,
  productionDate,
  taskIds,
  packedTaskCount,
  skippedTaskCount,
  source,
  reason,
}) {
  return JSON.stringify({
    batch_id: sanitizeText(batchId, 180) || null,
    previous_status: sanitizeText(previousStatus, 80) || null,
    new_status: sanitizeText(newStatus, 80) || null,
    production_date: sanitizeText(productionDate, 40) || null,
    task_count: taskIds.length,
    packed_task_count: packedTaskCount,
    skipped_task_count: skippedTaskCount,
    source: sanitizeText(source, 80) || SOURCE,
    request_id: sanitizeText(requestId, 180),
    reason: sanitizeText(reason, 180) || null,
    cascade_type: 'fulfillment_task_pack_only',
  });
}

function buildLogPayload({
  requestId,
  productionBatchId,
  batchId,
  actorEmail,
  actorRole,
  previousStatus,
  newStatus,
  productionDate,
  taskIds,
  packedTaskCount,
  skippedTaskCount,
  status,
  errorCode,
  errorMessage,
  reason,
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
    target_display_id: batchId,
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
      batchId,
      previousStatus,
      newStatus,
      productionDate,
      taskIds,
      packedTaskCount,
      skippedTaskCount,
      source: SOURCE,
      reason,
    }),
    error_code: errorCode || null,
    error_message: errorMessage ? sanitizeText(errorMessage, 220) : null,
  };
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

async function findProductionBatch(base44, productionBatchId) {
  const batches = await base44.asServiceRole.entities.ProductionBatch.filter(
    { id: productionBatchId },
    '-updated_date',
    1,
  );
  return batches?.[0] || null;
}

async function findFulfillmentTask(base44, taskId) {
  const tasks = await base44.asServiceRole.entities.FulfillmentTask.filter(
    { id: taskId },
    '-updated_date',
    1,
  );
  return tasks?.[0] || null;
}

function safeSuccessResponse({
  productionBatchId,
  batchId,
  previousStatus,
  status,
  productionDate,
  requestId,
  taskIds,
  packedTaskCount,
  skippedTaskCount,
  skipped,
  updatedAt,
}) {
  return {
    success: true,
    production_batch_id: productionBatchId,
    batch_id: batchId,
    previous_status: previousStatus || null,
    status: status || null,
    production_date: productionDate || null,
    fulfillment_task_ids: taskIds,
    packed_task_count: packedTaskCount,
    skipped_task_count: skippedTaskCount,
    request_id: requestId,
    skipped: skipped === true,
    updated_at: updatedAt || null,
    cascades_deferred: false,
    order_cascade_deferred: true,
  };
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  let base44 = null;
  let commandLog = null;
  let failureContext = null;

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!SYNC_SECRET || !authHeader.startsWith('Bearer ') || authHeader !== `Bearer ${SYNC_SECRET}`) {
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
    let batchId;
    let expectedStatus;
    let requestId;
    let taskIds;

    try {
      productionBatchId = normalizeId(body.production_batch_id, 'production_batch_id');
      batchId = normalizeId(body.batch_id, 'batch_id');
      expectedStatus = normalizeStatus(body.expected_status);
      requestId = normalizeId(body.request_id, 'request_id');
      taskIds = normalizeTaskIds(body.fulfillment_task_ids);
    } catch (error) {
      return Response.json(safeError(error.message, 'invalid_input'), { status: 400 });
    }

    const actorEmail = normalizeLower(body.actor_email);
    const actorRole = normalizeLower(body.actor_role);
    const source = normalizeSingleLine(body.source);
    const reason = sanitizeText(body.reason, 180);

    if (actorRole !== 'admin' || source !== SOURCE) {
      return Response.json(safeError('Actor is not allowed', 'actor_not_allowed'), { status: 403 });
    }

    const allowedEmails = parseEmailAllowlist(ALLOWED_EMAILS);
    if (!actorEmail || !allowedEmails.has(actorEmail)) {
      return Response.json(safeError('Actor is not allowed', 'actor_not_allowed'), { status: 403 });
    }

    if (!ENABLE_REAL_PACK) {
      return Response.json(safeError('Verify task pack cascade is not enabled', 'task_pack_not_enabled'), { status: 409 });
    }

    if (!isBatchAllowlisted(productionBatchId, batchId)) {
      return Response.json(safeError('Batch is not allowlisted', 'batch_not_allowlisted'), { status: 409 });
    }

    if (!areTasksAllowlisted(taskIds)) {
      return Response.json(safeError('Fulfillment tasks are not allowlisted', 'task_not_allowlisted'), { status: 409 });
    }

    base44 = createClientFromRequest(req);
    const existingLog = await findExistingCommandLog(base44, requestId, productionBatchId);
    if (existingLog) {
      if (existingLog.status === 'success' || existingLog.status === 'skipped') {
        return Response.json(safeSuccessResponse({
          productionBatchId,
          batchId,
          previousStatus: expectedStatus,
          status: expectedStatus,
          productionDate: null,
          requestId,
          taskIds,
          packedTaskCount: 0,
          skippedTaskCount: taskIds.length,
          skipped: true,
          updatedAt: existingLog.completed_at || null,
        }));
      }

      return Response.json(safeError('Matching request is not safely replayable', 'idempotency_conflict'), { status: 409 });
    }

    const batch = await findProductionBatch(base44, productionBatchId);
    if (!batch) return Response.json(safeError('Batch not found', 'batch_not_found'), { status: 404 });

    const currentStatus = normalizeSingleLine(batch.status);
    const currentBatchId = normalizeSingleLine(batch.batch_id);
    const productionDate = normalizeSingleLine(batch.production_date);
    const deliveryDate = deliveryDateFromProductionDate(productionDate);

    if (currentBatchId !== batchId) {
      return Response.json(safeError('Batch id mismatch', 'batch_id_mismatch'), { status: 409 });
    }
    if (currentStatus !== expectedStatus) {
      return Response.json(safeError('Expected status mismatch', 'expected_status_mismatch'), { status: 409 });
    }
    if (currentStatus !== 'verified_logged') {
      return Response.json(safeError('Batch is not verified/logged', 'batch_not_verified_logged'), { status: 409 });
    }
    if (batch.is_locked !== true) {
      return Response.json(safeError('Batch is not locked after verification', 'batch_not_locked'), { status: 409 });
    }
    if (!batch.compliance_log_id || !batch.verified_at || !batch.verified_by) {
      return Response.json(safeError('Batch verification metadata is missing', 'missing_verification_metadata'), { status: 409 });
    }
    if (!productionDate || !deliveryDate) {
      return Response.json(safeError('Production date is missing', 'missing_production_date'), { status: 409 });
    }

    const orderIds = collectOrderIds(batch);
    if (orderIds.size === 0) {
      return Response.json(safeError('No linked order ids are available', 'no_linked_order_ids'), { status: 409 });
    }

    const tasks = [];
    for (const taskId of taskIds) {
      const task = await findFulfillmentTask(base44, taskId);
      if (!task) return Response.json(safeError('Fulfillment task not found', 'task_not_found'), { status: 404 });
      tasks.push(task);
    }

    for (const task of tasks) {
      const taskStatus = normalizeSingleLine(task.status);
      const taskOrderId = normalizeSingleLine(task.order_id);
      const taskProductionDate = normalizeSingleLine(task.production_date);
      const taskScheduledDate = normalizeSingleLine(task.scheduled_date);

      if (!orderIds.has(taskOrderId)) {
        return Response.json(safeError('Fulfillment task is not linked to the batch', 'task_not_linked_to_batch'), { status: 409 });
      }
      if (!PACKABLE_TASK_STATUSES.has(taskStatus)) {
        const errorCode = TERMINAL_TASK_STATUSES.has(taskStatus)
          ? 'terminal_task_status'
          : taskStatus === 'Packed'
            ? 'task_already_packed_conflict'
            : 'task_status_not_packable';
        return Response.json(safeError('Fulfillment task is not packable', errorCode), { status: 409 });
      }
      if (taskProductionDate && taskProductionDate !== productionDate) {
        return Response.json(safeError('Fulfillment task production date conflicts with batch', 'task_production_date_conflict'), { status: 409 });
      }
      if (taskScheduledDate && taskScheduledDate !== deliveryDate) {
        return Response.json(safeError('Fulfillment task scheduled date conflicts with batch', 'task_scheduled_date_conflict'), { status: 409 });
      }
    }

    const now = new Date().toISOString();
    const processingLogPayload = buildLogPayload({
      requestId,
      productionBatchId,
      batchId,
      actorEmail,
      actorRole,
      previousStatus: currentStatus,
      newStatus: currentStatus,
      productionDate,
      taskIds,
      packedTaskCount: 0,
      skippedTaskCount: 0,
      status: 'processing',
      reason,
      timestamp: now,
      durationMs: 0,
    });

    failureContext = {
      requestId,
      productionBatchId,
      batchId,
      actorEmail,
      actorRole,
      previousStatus: currentStatus,
      newStatus: currentStatus,
      productionDate,
      taskIds,
      reason,
    };

    commandLog = await base44.asServiceRole.entities.HubCommandLog.create(processingLogPayload);

    let packedTaskCount = 0;
    for (const task of tasks) {
      await base44.asServiceRole.entities.FulfillmentTask.update(task.id, {
        status: 'Packed',
        production_date: productionDate,
      });
      packedTaskCount++;
    }

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startTime;
    await base44.asServiceRole.entities.HubCommandLog.update(commandLog.id, buildLogPayload({
      requestId,
      productionBatchId,
      batchId,
      actorEmail,
      actorRole,
      previousStatus: currentStatus,
      newStatus: currentStatus,
      productionDate,
      taskIds,
      packedTaskCount,
      skippedTaskCount: 0,
      status: 'success',
      reason,
      timestamp: completedAt,
      durationMs,
    }));

    return Response.json(safeSuccessResponse({
      productionBatchId,
      batchId,
      previousStatus: currentStatus,
      status: currentStatus,
      productionDate,
      requestId,
      taskIds,
      packedTaskCount,
      skippedTaskCount: 0,
      skipped: false,
      updatedAt: completedAt,
    }));
  } catch (error) {
    console.error('[packProductionVerifyFulfillmentTasksForCustomerApp] Error');
    if (base44 && commandLog?.id && failureContext) {
      try {
        const failedAt = new Date().toISOString();
        await base44.asServiceRole.entities.HubCommandLog.update(commandLog.id, buildLogPayload({
          ...failureContext,
          packedTaskCount: 0,
          skippedTaskCount: 0,
          status: 'failed',
          errorCode: 'internal_error',
          errorMessage: 'Unable to pack verified production fulfillment tasks',
          timestamp: failedAt,
          durationMs: Date.now() - startTime,
        }));
      } catch {
        console.error('[packProductionVerifyFulfillmentTasksForCustomerApp] Could not update failed command log');
      }
    }
    return Response.json(safeError('Unable to pack verified production fulfillment tasks', 'internal_error'), { status: 500 });
  }
});
