import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

function normalizeText(value) {
  return (value || '').toString().trim();
}

function normalizeOrderNumber(value) {
  return normalizeText(value).replace(/^#/, '');
}

function orderNumberCandidates(value) {
  const normalized = normalizeOrderNumber(value);
  if (!normalized) return [];
  return [...new Set([normalized, `#${normalized}`])];
}

function parseLimit(value) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function taskSortKey(task) {
  return [
    task.production_date || '',
    task.scheduled_date || task.delivery_date || '',
    String(task.fulfillment_number ?? '').padStart(6, '0'),
    task.created_date || '',
  ].join('|');
}

function sanitizeTask(task, fallbackOrderNumber) {
  return {
    id: task.id || null,
    order_id: task.order_id || null,
    order_number: task.order_number || fallbackOrderNumber || null,
    fulfillment_number: task.fulfillment_number ?? null,
    status: task.status || null,
    delivery_status: task.delivery_status || null,
    scheduled_date: task.scheduled_date || null,
    production_date: task.production_date || null,
    delivery_date: task.scheduled_date || task.delivery_date || null,
    delivery_window_label: task.delivery_window_label || task.time_window || null,
    items_summary: task.items_summary || null,
    source_type: task.source_type || null,
    schedule_source: task.schedule_source || null,
    payment_status: task.payment_status || null,
    delivered_at: task.delivered_at || null,
    delivery_photo_url: task.delivery_photo_url || null,
    delivery_drop_location: task.delivery_drop_location || null,
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

    const base44 = createClientFromRequest(req);
    const url = new URL(req.url);
    const hubOrderId = normalizeText(url.searchParams.get('hub_order_id'));
    const orderNumber = normalizeOrderNumber(url.searchParams.get('order_number'));
    const stripeSubscriptionId = normalizeText(url.searchParams.get('stripe_subscription_id'));
    const customerAppOrderId = normalizeText(url.searchParams.get('customer_app_order_id'));
    const limit = parseLimit(url.searchParams.get('limit'));

    if (!hubOrderId && !orderNumber && !stripeSubscriptionId && !customerAppOrderId) {
      return Response.json({
        error: 'At least one scoped identifier is required',
        required_any_of: ['hub_order_id', 'order_number', 'stripe_subscription_id', 'customer_app_order_id'],
      }, { status: 400 });
    }

    const matchedOrders = new Map();
    const addOrders = (orders) => {
      for (const order of orders || []) {
        if (order?.id) matchedOrders.set(order.id, order);
      }
    };

    let matchedBy = null;

    if (hubOrderId) {
      const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({ id: hubOrderId }, '-updated_date', 5);
      addOrders(orders);
      if (orders?.length && !matchedBy) matchedBy = 'hub_order_id';
    }

    if (orderNumber) {
      for (const candidate of orderNumberCandidates(orderNumber)) {
        const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_number: candidate }, '-updated_date', 5);
        addOrders(orders);
        if (orders?.length && !matchedBy) matchedBy = 'order_number';
      }
    }

    if (stripeSubscriptionId) {
      const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({ stripe_subscription_id: stripeSubscriptionId }, '-updated_date', 10);
      addOrders(orders);
      if (orders?.length && !matchedBy) matchedBy = 'stripe_subscription_id';
    }

    if (customerAppOrderId) {
      const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({ base44_order_id: customerAppOrderId }, '-updated_date', 5);
      addOrders(orders);
      if (orders?.length && !matchedBy) matchedBy = 'customer_app_order_id';
    }

    const tasksById = new Map();
    const addTasks = (tasks) => {
      for (const task of tasks || []) {
        if (task?.id) tasksById.set(task.id, task);
      }
    };

    for (const order of matchedOrders.values()) {
      const tasks = await base44.asServiceRole.entities.FulfillmentTask.filter({ order_id: order.id }, '-created_date', limit);
      addTasks(tasks);
    }

    if (stripeSubscriptionId) {
      const tasks = await base44.asServiceRole.entities.FulfillmentTask.filter({ stripe_subscription_id: stripeSubscriptionId }, '-created_date', limit);
      addTasks(tasks);
      if (tasks?.length && !matchedBy) matchedBy = 'stripe_subscription_id';
    }

    if (orderNumber) {
      for (const candidate of orderNumberCandidates(orderNumber)) {
        const tasks = await base44.asServiceRole.entities.FulfillmentTask.filter({ order_number: candidate }, '-created_date', limit);
        addTasks(tasks);
        if (tasks?.length && !matchedBy) matchedBy = 'order_number';
      }
    }

    const fallbackOrderNumber = [...matchedOrders.values()][0]?.shopify_order_number || (orderNumber ? `#${orderNumber}` : null);
    const sortedTasks = [...tasksById.values()]
      .sort((a, b) => taskSortKey(a).localeCompare(taskSortKey(b)))
      .slice(0, limit)
      .map(task => sanitizeTask(task, fallbackOrderNumber));

    console.log(`[FULFILLMENT-TASK-DETAILS] matched_by=${matchedBy || 'none'} tasks=${sortedTasks.length}`);

    return Response.json({
      success: true,
      matched_by: matchedBy,
      count: sortedTasks.length,
      tasks: sortedTasks,
    });
  } catch (error) {
    console.error('[FULFILLMENT-TASK-DETAILS] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
