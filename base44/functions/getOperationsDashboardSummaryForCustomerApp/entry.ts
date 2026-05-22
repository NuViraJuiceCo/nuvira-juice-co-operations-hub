import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const CHICAGO_TZ = 'America/Chicago';
const MAX_RANGE_DAYS = 31;
const DEFAULT_PRESET = 'last_7_days';
const ORDER_QUERY_LIMIT = 1000;
const INVENTORY_QUERY_LIMIT = 201;
const ALERT_QUERY_LIMIT = 201;
const TASK_QUERY_LIMIT_PER_DATE = 201;
const BATCH_QUERY_LIMIT_PER_DATE = 201;
const ACTIVE_ALERT_STATUSES = ['unread', 'read', 'acknowledged'];

function todayChicagoDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function normalizeText(value) {
  return (value || '').toString().trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function parseIsoDate(value, fieldName) {
  const text = normalizeText(value);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${fieldName} must use YYYY-MM-DD format`);
  }

  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const normalized = date.toISOString().slice(0, 10);
  if (normalized !== text) {
    throw new Error(`${fieldName} must be a valid calendar date`);
  }

  return text;
}

function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysInclusive(from, to) {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  const diff = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000);
  return diff + 1;
}

function enumerateDates(from, to) {
  const dates = [];
  let cursor = from;
  while (cursor <= to) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function resolveDateRange(url) {
  const preset = normalizeLower(url.searchParams.get('preset'));
  const dateFrom = parseIsoDate(url.searchParams.get('date_from'), 'date_from');
  const dateTo = parseIsoDate(url.searchParams.get('date_to'), 'date_to');

  if (preset && !['today', 'last_7_days', 'last_30_days'].includes(preset)) {
    throw new Error('preset must be one of today, last_7_days, last_30_days');
  }

  if ((dateFrom || dateTo) && preset) {
    throw new Error('Use either preset or date_from/date_to, not both');
  }

  const today = todayChicagoDate();
  if (dateFrom || dateTo) {
    const resolvedFrom = dateFrom || dateTo;
    const resolvedTo = dateTo || dateFrom;
    return { dateFrom: resolvedFrom, dateTo: resolvedTo };
  }

  const effectivePreset = preset || DEFAULT_PRESET;
  if (effectivePreset === 'today') {
    return { dateFrom: today, dateTo: today };
  }
  if (effectivePreset === 'last_30_days') {
    return { dateFrom: addDays(today, -29), dateTo: today };
  }
  return { dateFrom: addDays(today, -6), dateTo: today };
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function datePart(value) {
  return normalizeText(value).slice(0, 10);
}

function inDateRange(value, dateFrom, dateTo) {
  const date = datePart(value);
  return Boolean(date) && date >= dateFrom && date <= dateTo;
}

function isPaidOrder(order) {
  const paymentStatus = normalizeLower(order.payment_status);
  const financialStatus = normalizeLower(order.financial_status);
  return paymentStatus === 'paid' || financialStatus === 'paid';
}

function isFulfilledOrder(order) {
  const fulfillmentStatus = normalizeLower(order.fulfillment_status);
  const productionStatus = normalizeLower(order.production_status);
  return ['fulfilled', 'complete', 'completed'].includes(fulfillmentStatus) ||
    ['fulfilled', 'complete', 'completed'].includes(productionStatus);
}

function isDeliveredOrder(order) {
  const deliveryStatus = normalizeLower(order.delivery_status);
  return deliveryStatus === 'delivered' || Boolean(order.delivered_at);
}

function sourceMixKey(order) {
  const sourceType = normalizeLower(order.source_type);
  const sourceChannel = normalizeLower(order.source_channel);
  const orderType = normalizeLower(order.order_type);
  const fulfillmentMode = normalizeLower(order.fulfillment_mode);
  const fulfillmentMethod = normalizeLower(order.fulfillment_method);

  if (sourceChannel === 'subscription' || orderType === 'subscription' || sourceType.includes('subscription') || fulfillmentMode === 'multi_delivery') {
    return 'subscription';
  }
  if (sourceChannel === 'pos' || sourceType.includes('pos') || fulfillmentMethod === 'pos') {
    return 'pos';
  }
  if (sourceType || sourceChannel || orderType) {
    return 'one_time';
  }
  return 'other';
}

function orderMatchesSourceFilters(order, sourceTypeFilter, sourceChannelFilter) {
  if (sourceTypeFilter && normalizeLower(order.source_type) !== sourceTypeFilter) return false;
  if (sourceChannelFilter && normalizeLower(order.source_channel) !== sourceChannelFilter) return false;
  return true;
}

function computeInventoryStatus(item) {
  const stock = numberOrZero(item.stock);
  const reorderPoint = Number(item.reorder_point);

  if (stock <= 0) return 'out_of_stock';
  if (Number.isFinite(reorderPoint) && reorderPoint > 0 && stock <= reorderPoint * 0.5) return 'critical';
  if (Number.isFinite(reorderPoint) && reorderPoint > 0 && stock <= reorderPoint) return 'low';
  return 'ok';
}

function isCompletedTask(task) {
  const status = normalizeLower(task.status);
  const deliveryStatus = normalizeLower(task.delivery_status);
  return deliveryStatus === 'delivered' ||
    status === 'completed' ||
    status === 'complete' ||
    status === 'fulfilled';
}

async function readProductionSummary(base44, dates) {
  const batchesById = new Map();
  let truncated = false;

  for (const productionDate of dates) {
    const batches = await base44.asServiceRole.entities.ProductionBatch.filter(
      { production_date: productionDate },
      'product_name',
      BATCH_QUERY_LIMIT_PER_DATE,
    );
    if ((batches || []).length >= BATCH_QUERY_LIMIT_PER_DATE) truncated = true;
    for (const batch of batches || []) {
      if (batch?.id) batchesById.set(batch.id, batch);
    }
  }

  const batches = [...batchesById.values()];
  return {
    summary: {
      batch_count: batches.length,
      planned_units: batches.reduce((sum, batch) => sum + numberOrZero(batch.planned_units), 0),
      produced_units: batches.reduce((sum, batch) => sum + numberOrZero(batch.actual_units), 0),
    },
    truncated,
  };
}

async function readDeliverySummary(base44, dateFrom, dateTo, today) {
  const dates = new Set([...enumerateDates(dateFrom, dateTo), today, addDays(today, 1)]);
  const tasksById = new Map();
  let truncated = false;

  const addTasks = (tasks) => {
    if ((tasks || []).length >= TASK_QUERY_LIMIT_PER_DATE) truncated = true;
    for (const task of tasks || []) {
      if (task?.id) tasksById.set(task.id, task);
    }
  };

  for (const deliveryDate of dates) {
    addTasks(await base44.asServiceRole.entities.FulfillmentTask.filter(
      { scheduled_date: deliveryDate },
      'time_window',
      TASK_QUERY_LIMIT_PER_DATE,
    ));
    addTasks(await base44.asServiceRole.entities.FulfillmentTask.filter(
      { delivery_date: deliveryDate },
      'time_window',
      TASK_QUERY_LIMIT_PER_DATE,
    ));
  }

  const tasks = [...tasksById.values()];
  const tomorrow = addDays(today, 1);
  return {
    summary: {
      today_stops: tasks.filter(task => datePart(task.scheduled_date || task.delivery_date) === today).length,
      tomorrow_stops: tasks.filter(task => datePart(task.scheduled_date || task.delivery_date) === tomorrow).length,
      completed_in_range: tasks.filter(task => inDateRange(task.scheduled_date || task.delivery_date || task.delivered_at, dateFrom, dateTo) && isCompletedTask(task)).length,
    },
    truncated,
  };
}

async function readInventorySummary(base44) {
  const items = await base44.asServiceRole.entities.InventoryItem.list('-updated_date', INVENTORY_QUERY_LIMIT);
  const truncated = (items || []).length >= INVENTORY_QUERY_LIMIT;
  const statuses = (items || []).map(computeInventoryStatus);

  return {
    summary: {
      low: statuses.filter(status => status === 'low').length,
      critical: statuses.filter(status => status === 'critical').length,
      out_of_stock: statuses.filter(status => status === 'out_of_stock').length,
    },
    truncated,
  };
}

async function readAlertsSummary(base44) {
  const alertsById = new Map();
  let truncated = false;

  for (const status of ACTIVE_ALERT_STATUSES) {
    const alerts = await base44.asServiceRole.entities.HubAlert.filter(
      { status },
      '-created_date',
      ALERT_QUERY_LIMIT,
    );
    if ((alerts || []).length >= ALERT_QUERY_LIMIT) truncated = true;
    for (const alert of alerts || []) {
      if (alert?.id) alertsById.set(alert.id, alert);
    }
  }

  const alerts = [...alertsById.values()];
  return {
    summary: {
      active: alerts.length,
      critical: alerts.filter(alert => normalizeLower(alert.severity) === 'critical').length,
      warning: alerts.filter(alert => normalizeLower(alert.severity) === 'warning').length,
      info: alerts.filter(alert => normalizeLower(alert.severity) === 'info').length,
    },
    truncated,
  };
}

async function readOrderSummary(base44, dateFrom, dateTo, sourceTypeFilter, sourceChannelFilter) {
  const orders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', ORDER_QUERY_LIMIT);
  const truncated = (orders || []).length >= ORDER_QUERY_LIMIT;
  const rangeOrders = (orders || [])
    .filter(order => inDateRange(order.created_date, dateFrom, dateTo))
    .filter(order => orderMatchesSourceFilters(order, sourceTypeFilter, sourceChannelFilter));

  const sourceMix = { one_time: 0, subscription: 0, pos: 0, other: 0 };
  for (const order of rangeOrders) {
    sourceMix[sourceMixKey(order)] += 1;
  }

  return {
    summary: {
      orders: {
        total: rangeOrders.length,
        paid: rangeOrders.filter(isPaidOrder).length,
        fulfilled: rangeOrders.filter(isFulfilledOrder).length,
        delivered: rangeOrders.filter(isDeliveredOrder).length,
      },
      source_mix: sourceMix,
    },
    truncated,
  };
}

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return Response.json({ error: 'Missing or invalid Authorization header' }, { status: 401 });
    }

    const token = authHeader.slice(7);
    if (!SYNC_SECRET || token !== SYNC_SECRET) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (req.method !== 'GET') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const url = new URL(req.url);
    let dateFrom;
    let dateTo;
    try {
      const range = resolveDateRange(url);
      dateFrom = range.dateFrom;
      dateTo = range.dateTo;
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    if (dateTo < dateFrom) {
      return Response.json({ error: 'date_to must be on or after date_from' }, { status: 400 });
    }

    const requestedDays = daysInclusive(dateFrom, dateTo);
    if (requestedDays > MAX_RANGE_DAYS) {
      return Response.json({
        error: `Date range must be ${MAX_RANGE_DAYS} days or fewer`,
        max_range_days: MAX_RANGE_DAYS,
      }, { status: 400 });
    }

    const sourceTypeFilter = normalizeLower(url.searchParams.get('source_type'));
    const sourceChannelFilter = normalizeLower(url.searchParams.get('source_channel'));
    const today = todayChicagoDate();
    const dates = enumerateDates(dateFrom, dateTo);
    const base44 = createClientFromRequest(req);

    const [
      orderResult,
      productionResult,
      deliveryResult,
      inventoryResult,
      alertsResult,
    ] = await Promise.all([
      readOrderSummary(base44, dateFrom, dateTo, sourceTypeFilter, sourceChannelFilter),
      readProductionSummary(base44, dates),
      readDeliverySummary(base44, dateFrom, dateTo, today),
      readInventorySummary(base44),
      readAlertsSummary(base44),
    ]);

    const truncated = Boolean(
      orderResult.truncated ||
      productionResult.truncated ||
      deliveryResult.truncated ||
      inventoryResult.truncated ||
      alertsResult.truncated
    );

    console.log(`[OPERATIONS-DASHBOARD-SUMMARY] date_from=${dateFrom} date_to=${dateTo} truncated=${truncated}`);

    return Response.json({
      success: true,
      source: 'hub_operations_dashboard_summary',
      generated_at: new Date().toISOString(),
      date_from: dateFrom,
      date_to: dateTo,
      summary: {
        orders: orderResult.summary.orders,
        production: productionResult.summary,
        delivery: deliveryResult.summary,
        inventory: inventoryResult.summary,
        alerts: alertsResult.summary,
        source_mix: orderResult.summary.source_mix,
      },
      truncated,
    });
  } catch (error) {
    console.error('[OPERATIONS-DASHBOARD-SUMMARY] Error:', error.message);
    return Response.json({ error: 'Unable to load operations dashboard summary' }, { status: 500 });
  }
});
