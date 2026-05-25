import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_TEXT_LENGTH = 120;
const SAFE_SUMMARY_LIMIT = 20;

const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'batch_id',
  'expected_status',
  'request_id',
]);

const PACKABLE_TASK_STATUSES = new Set(['Unassigned', 'Scheduled']);
const TERMINAL_TASK_STATUSES = new Set(['Completed', 'Unable To Deliver', 'Cancelled']);
const ORDER_TERMINAL_STATUSES = new Set(['fulfilled', 'canceled', 'cancelled', 'refunded']);

const PROJECTED_PACK_WRITES = [
  'FulfillmentTask.status',
  'FulfillmentTask.production_date',
  'HubCommandLog',
];

const PROJECTED_ORDER_WRITES = [
  'ShopifyOrder.production_status',
  'HubCommandLog',
];

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

function findUnsupportedBodyKey(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const key of Object.keys(body)) {
    const normalized = normalizeLower(key);
    if (!ALLOWED_BODY_KEYS.has(normalized)) return key;
  }
  return null;
}

function hasMeaningfulFieldValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return Boolean(normalizeSingleLine(value));
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

function increment(counts, key) {
  const safeKey = sanitizeText(key || 'unknown', 80) || 'unknown';
  counts[safeKey] = (counts[safeKey] || 0) + 1;
}

function safeError(error, errorCode, message = error) {
  return {
    error: sanitizeText(error, 160),
    error_code: sanitizeText(errorCode, 80),
    message: sanitizeText(message, 180),
  };
}

function collectOrderIds(batch) {
  const sourceIds = (Array.isArray(batch?.order_sources) ? batch.order_sources : [])
    .map((source) => normalizeSingleLine(source?.order_id))
    .filter(Boolean);
  const relatedIds = (Array.isArray(batch?.related_orders) ? batch.related_orders : [])
    .map((orderId) => normalizeSingleLine(orderId))
    .filter(Boolean);
  return [...new Set([...sourceIds, ...relatedIds])];
}

function deliveryDateFromProductionDate(productionDate) {
  if (!productionDate) return '';
  const date = new Date(productionDate);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + 1);
  return date.toISOString().split('T')[0];
}

async function findProductionBatch(base44, productionBatchId) {
  const batches = await base44.asServiceRole.entities.ProductionBatch.filter(
    { id: productionBatchId },
    '-updated_date',
    1,
  );
  return batches?.[0] || null;
}

async function readLinkedTasks(base44, batch, orderIds) {
  const productionDate = normalizeSingleLine(batch?.production_date);
  if (!productionDate) return { tasks: [], broadDateTaskMatch: false, previewError: false };

  try {
    const scheduledDate = deliveryDateFromProductionDate(productionDate);
    const [tasksByProdDate, tasksBySchedDate] = await Promise.all([
      base44.asServiceRole.entities.FulfillmentTask.filter({ production_date: productionDate }).catch(() => []),
      scheduledDate
        ? base44.asServiceRole.entities.FulfillmentTask.filter({ scheduled_date: scheduledDate }).catch(() => [])
        : Promise.resolve([]),
    ]);

    const tasksById = {};
    for (const task of [...tasksByProdDate, ...tasksBySchedDate]) {
      if (task?.id) tasksById[task.id] = task;
    }

    const allDateMatchedTasks = Object.values(tasksById);
    const linkedTasks = allDateMatchedTasks.filter((task) => (
      orderIds.length > 0 && orderIds.includes(normalizeSingleLine(task?.order_id))
    ));

    return {
      tasks: linkedTasks,
      broadDateTaskMatch: orderIds.length === 0 && allDateMatchedTasks.length > 0,
      previewError: false,
    };
  } catch {
    return { tasks: [], broadDateTaskMatch: false, previewError: true };
  }
}

async function readLinkedOrders(base44, orderIds) {
  const orders = [];
  const missingOrderIds = [];

  for (const orderId of orderIds.slice(0, SAFE_SUMMARY_LIMIT * 2)) {
    try {
      const order = await base44.asServiceRole.entities.ShopifyOrder.get(orderId).catch(() => null);
      if (order) {
        orders.push(order);
      } else {
        missingOrderIds.push(orderId);
      }
    } catch {
      missingOrderIds.push(orderId);
    }
  }

  return { orders, missingOrderIds };
}

function evaluateTask(task, productionDate) {
  const currentStatus = normalizeSingleLine(task?.status);
  const blockers = [];

  if (!PACKABLE_TASK_STATUSES.has(currentStatus)) {
    blockers.push(TERMINAL_TASK_STATUSES.has(currentStatus)
      ? 'terminal_task_status'
      : 'task_status_not_packable');
  }

  return {
    task_id: sanitizeText(task?.id, 180) || null,
    order_id: sanitizeText(task?.order_id, 180) || null,
    order_number: sanitizeText(task?.order_number, 80) || null,
    current_status: sanitizeText(currentStatus, 80) || null,
    projected_status: blockers.length === 0 ? 'Packed' : null,
    current_production_date: sanitizeText(task?.production_date, 40) || null,
    projected_production_date: blockers.length === 0 ? sanitizeText(productionDate, 40) : null,
    scheduled_date: sanitizeText(task?.scheduled_date, 40) || null,
    source_type: sanitizeText(task?.source_type, 80) || null,
    fulfillment_type: sanitizeText(task?.fulfillment_type, 80) || null,
    will_update: blockers.length === 0,
    blockers,
  };
}

function evaluateOrder(order) {
  const productionStatus = normalizeLower(order?.production_status || order?.status);
  const orderType = normalizeLower(order?.order_type);
  const fulfillmentMode = normalizeLower(order?.fulfillment_mode);
  const blockers = [];

  if (orderType === 'subscription' || fulfillmentMode === 'multi_delivery') {
    blockers.push('subscription_order_out_of_scope');
  }
  if (ORDER_TERMINAL_STATUSES.has(productionStatus)) {
    blockers.push('terminal_order_status');
  }
  if (productionStatus === 'bottled') {
    blockers.push('already_bottled');
  }

  return {
    order_id: sanitizeText(order?.id, 180) || null,
    order_number: sanitizeText(order?.shopify_order_number || order?.order_number, 80) || null,
    order_type: sanitizeText(orderType, 80) || null,
    fulfillment_mode: sanitizeText(fulfillmentMode, 80) || null,
    current_production_status: sanitizeText(productionStatus, 80) || null,
    projected_production_status: blockers.length === 0 ? 'bottled' : null,
    will_update: blockers.length === 0,
    blockers,
  };
}

Deno.serve(async (req) => {
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

    try {
      productionBatchId = normalizeId(body.production_batch_id, 'production_batch_id');
      requestBatchId = normalizeId(body.batch_id, 'batch_id', false);
      expectedStatus = normalizeOptionalStatus(body.expected_status);
      requestId = normalizeId(body.request_id, 'request_id', false);
    } catch (error) {
      return Response.json(safeError(error.message, 'invalid_input'), { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const batch = await findProductionBatch(base44, productionBatchId);

    if (!batch) {
      return Response.json({
        success: true,
        dry_run: true,
        production_batch_id: productionBatchId,
        batch_id: requestBatchId || null,
        current_status: null,
        cascade_preview_allowed: false,
        blockers: ['batch_not_found'],
        warnings: [],
      });
    }

    const blockers = [];
    const warnings = [];
    const currentStatus = normalizeSingleLine(batch.status);
    const batchDisplayId = normalizeSingleLine(batch.batch_id);
    const productionDate = normalizeSingleLine(batch.production_date);

    if (requestBatchId && requestBatchId !== batchDisplayId) blockers.push('batch_id_mismatch');
    if (expectedStatus && expectedStatus !== currentStatus) blockers.push('expected_status_mismatch');
    if (currentStatus !== 'verified_logged') blockers.push('batch_not_verified_logged');
    if (!hasMeaningfulFieldValue(batch.compliance_log_id)) blockers.push('missing_compliance_log_id');
    if (!hasMeaningfulFieldValue(batch.verified_at) || !hasMeaningfulFieldValue(batch.verified_by)) {
      blockers.push('missing_verification_metadata');
    }
    if (batch.is_locked !== true) blockers.push('batch_not_locked');
    if (!productionDate) blockers.push('missing_production_date');

    const orderIds = collectOrderIds(batch);
    if (orderIds.length === 0) warnings.push('no_linked_order_ids');

    const taskPreview = await readLinkedTasks(base44, batch, orderIds);
    if (taskPreview.previewError) warnings.push('task_preview_unavailable');
    if (taskPreview.broadDateTaskMatch) blockers.push('broad_date_task_cascade_risk');

    const { orders, missingOrderIds } = await readLinkedOrders(base44, orderIds);
    if (missingOrderIds.length > 0) warnings.push('linked_order_read_missing');

    const allTaskEvaluations = taskPreview.tasks.map((task) => evaluateTask(task, productionDate));
    const allOrderEvaluations = orders.map((order) => evaluateOrder(order));
    const taskSummaries = allTaskEvaluations.slice(0, SAFE_SUMMARY_LIMIT);
    const orderSummaries = allOrderEvaluations.slice(0, SAFE_SUMMARY_LIMIT);

    const taskStatusCounts = {};
    for (const task of taskPreview.tasks) increment(taskStatusCounts, task?.status || 'unknown');

    const orderTypeCounts = {};
    const fulfillmentModeCounts = {};
    const orderProductionStatusCounts = {};
    for (const order of orders) {
      increment(orderTypeCounts, order?.order_type || 'unknown');
      increment(fulfillmentModeCounts, order?.fulfillment_mode || 'unknown');
      increment(orderProductionStatusCounts, order?.production_status || order?.status || 'unknown');
    }

    const packableTaskCount = allTaskEvaluations.filter((task) => task.will_update).length;
    const blockedTaskCount = taskPreview.tasks.length - packableTaskCount;
    const eligibleBottledOrderCount = allOrderEvaluations.filter((order) => order.will_update).length;
    const blockedBottledOrderCount = orders.length - eligibleBottledOrderCount;
    const subscriptionOrderCount = allOrderEvaluations.filter((order) =>
      order.blockers.includes('subscription_order_out_of_scope')
    ).length;

    if (packableTaskCount > 0) warnings.push('fulfillment_task_pack_available');
    if (eligibleBottledOrderCount > 0) warnings.push('shopify_order_bottled_available');
    if (subscriptionOrderCount > 0) warnings.push('subscription_order_cascade_deferred');
    if (blockedTaskCount > 0) warnings.push('some_tasks_not_packable');
    if (blockedBottledOrderCount > 0) warnings.push('some_orders_not_bottle_eligible');

    const uniqueBlockers = [...new Set(blockers)];
    const uniqueWarnings = [...new Set(warnings)];
    const cascadePreviewAllowed = uniqueBlockers.length === 0;

    return Response.json({
      success: true,
      dry_run: true,
      production_batch_id: productionBatchId,
      batch_id: sanitizeText(batchDisplayId, 180) || null,
      current_status: sanitizeText(currentStatus, 80) || null,
      production_date: sanitizeText(productionDate, 40) || null,
      verified_at_present: hasMeaningfulFieldValue(batch.verified_at),
      verified_by_present: hasMeaningfulFieldValue(batch.verified_by),
      compliance_log_id_present: hasMeaningfulFieldValue(batch.compliance_log_id),
      is_locked: batch.is_locked === true,
      cascade_preview_allowed: cascadePreviewAllowed,
      pack_cascade_allowed: cascadePreviewAllowed && packableTaskCount > 0,
      bottled_order_cascade_allowed: cascadePreviewAllowed && eligibleBottledOrderCount > 0,
      linked_order_id_count: orderIds.length,
      linked_task_count: taskPreview.tasks.length,
      packable_task_count: packableTaskCount,
      blocked_task_count: blockedTaskCount,
      linked_order_count: orders.length,
      eligible_bottled_order_count: eligibleBottledOrderCount,
      blocked_bottled_order_count: blockedBottledOrderCount,
      subscription_order_count: subscriptionOrderCount,
      missing_linked_order_count: missingOrderIds.length,
      task_status_counts: taskStatusCounts,
      order_type_counts: orderTypeCounts,
      fulfillment_mode_counts: fulfillmentModeCounts,
      order_production_status_counts: orderProductionStatusCounts,
      projected_pack_writes: PROJECTED_PACK_WRITES,
      projected_order_writes: PROJECTED_ORDER_WRITES,
      cascades_split_required: true,
      task_update_summaries: taskSummaries,
      order_update_summaries: orderSummaries,
      blockers: uniqueBlockers,
      warnings: uniqueWarnings,
      ...(requestId ? { request_id: requestId } : {}),
    });
  } catch {
    console.error('[previewProductionVerifyCascadesForCustomerApp] Error');
    return Response.json(safeError('Unable to preview production verify cascades', 'internal_error'), { status: 500 });
  }
});
