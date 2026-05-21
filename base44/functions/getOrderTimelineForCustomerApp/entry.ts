import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

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

function formatOrderNumber(value) {
  const normalized = normalizeOrderNumber(value);
  return normalized ? `#${normalized}` : null;
}

function eventKey(event) {
  return [
    event.type,
    event.source,
    event.task_id || '',
    event.timestamp || '',
    event.date || '',
    event.fulfillment_number ?? '',
  ].join('|');
}

function addEvent(eventsByKey, event) {
  if (!event?.type || !event?.source) return;
  if (!event.timestamp && !event.date) return;

  const safeEvent = {
    type: event.type,
    label: event.label,
    timestamp: event.timestamp || null,
    date: event.date || null,
    source: event.source,
    status: event.status || null,
    task_id: event.task_id || null,
    fulfillment_number: event.fulfillment_number ?? null,
    production_date: event.production_date || null,
    delivery_date: event.delivery_date || null,
    delivery_window_label: event.delivery_window_label || null,
    schedule_source: event.schedule_source || null,
    source_type: event.source_type || null,
    details: event.details || {},
  };

  eventsByKey.set(eventKey(safeEvent), safeEvent);
}

function addOrderEvents(eventsByKey, order) {
  const orderStatus = order.production_status || order.fulfillment_status || order.order_status || null;
  const deliveryDate = order.assigned_delivery_date || order.selected_delivery_date || order.requested_delivery_date || null;
  const proofAvailable = Boolean(order.delivery_photo_url || order.delivery_drop_location);
  const scheduleSource = order.schedule_source || null;
  const sourceType = order.source_type || order.order_type || order.source_channel || null;

  addEvent(eventsByKey, {
    type: 'hub_order_created',
    label: 'Hub Order Created',
    timestamp: order.created_date || null,
    source: 'shopify_order',
    status: orderStatus,
    production_date: order.production_date || null,
    delivery_date: deliveryDate,
    delivery_window_label: order.delivery_window_label || null,
    schedule_source: scheduleSource,
    source_type: sourceType,
  });

  addEvent(eventsByKey, {
    type: 'status_updated',
    label: 'Status Updated',
    timestamp: order.updated_date || null,
    source: 'shopify_order',
    status: orderStatus,
    production_date: order.production_date || null,
    delivery_date: deliveryDate,
    delivery_window_label: order.delivery_window_label || null,
    schedule_source: scheduleSource,
    source_type: sourceType,
  });

  addEvent(eventsByKey, {
    type: 'production_scheduled',
    label: 'Production Scheduled',
    timestamp: null,
    date: order.production_date || null,
    source: 'shopify_order',
    status: order.production_status || null,
    production_date: order.production_date || null,
    delivery_date: deliveryDate,
    delivery_window_label: order.delivery_window_label || null,
    schedule_source: scheduleSource,
    source_type: sourceType,
  });

  const isOutForDelivery = order.order_lock_status === 'out_for_delivery' ||
    order.production_status === 'assigned_for_delivery' ||
    order.fulfillment_status === 'out_for_delivery';
  if (isOutForDelivery) {
    addEvent(eventsByKey, {
      type: 'out_for_delivery',
      label: 'Out For Delivery',
      timestamp: order.updated_date || null,
      source: 'shopify_order',
      status: order.fulfillment_status || order.production_status || null,
      production_date: order.production_date || null,
      delivery_date: deliveryDate,
      delivery_window_label: order.delivery_window_label || null,
      schedule_source: scheduleSource,
      source_type: sourceType,
    });
  }

  addEvent(eventsByKey, {
    type: 'delivered',
    label: 'Delivered',
    timestamp: order.delivered_at || null,
    source: 'shopify_order',
    status: order.fulfillment_status || order.production_status || null,
    production_date: order.production_date || null,
    delivery_date: deliveryDate,
    delivery_window_label: order.delivery_window_label || null,
    schedule_source: scheduleSource,
    source_type: sourceType,
    details: {
      proof_available: proofAvailable,
      delivery_photo_url: order.delivery_photo_url || null,
      delivery_drop_location: order.delivery_drop_location || null,
    },
  });

  if (proofAvailable) {
    addEvent(eventsByKey, {
      type: 'delivery_proof_added',
      label: 'Delivery Proof Added',
      timestamp: order.delivered_at || order.updated_date || null,
      source: 'shopify_order',
      status: order.fulfillment_status || order.production_status || null,
      production_date: order.production_date || null,
      delivery_date: deliveryDate,
      delivery_window_label: order.delivery_window_label || null,
      schedule_source: scheduleSource,
      source_type: sourceType,
      details: {
        proof_available: true,
        delivery_photo_url: order.delivery_photo_url || null,
        delivery_drop_location: order.delivery_drop_location || null,
      },
    });
  }
}

function addTaskEvents(eventsByKey, task) {
  const deliveryDate = task.scheduled_date || task.delivery_date || null;
  const proofAvailable = Boolean(task.delivery_photo_url || task.delivery_drop_location);
  const isSubscriptionTask = task.source_type === 'subscription_fulfillment' || Boolean(task.stripe_subscription_id);

  addEvent(eventsByKey, {
    type: 'fulfillment_task_created',
    label: 'Fulfillment Task Created',
    timestamp: task.created_date || null,
    source: 'fulfillment_task',
    status: task.status || null,
    task_id: task.id || null,
    fulfillment_number: task.fulfillment_number ?? null,
    production_date: task.production_date || null,
    delivery_date: deliveryDate,
    delivery_window_label: task.delivery_window_label || task.time_window || null,
    schedule_source: task.schedule_source || null,
    source_type: task.source_type || null,
  });

  addEvent(eventsByKey, {
    type: 'production_scheduled',
    label: 'Production Scheduled',
    timestamp: null,
    date: task.production_date || null,
    source: 'fulfillment_task',
    status: task.status || null,
    task_id: task.id || null,
    fulfillment_number: task.fulfillment_number ?? null,
    production_date: task.production_date || null,
    delivery_date: deliveryDate,
    delivery_window_label: task.delivery_window_label || task.time_window || null,
    schedule_source: task.schedule_source || null,
    source_type: task.source_type || null,
  });

  if (isSubscriptionTask) {
    addEvent(eventsByKey, {
      type: 'subscription_fulfillment_scheduled',
      label: 'Subscription Fulfillment Scheduled',
      timestamp: null,
      date: deliveryDate,
      source: 'fulfillment_task',
      status: task.status || null,
      task_id: task.id || null,
      fulfillment_number: task.fulfillment_number ?? null,
      production_date: task.production_date || null,
      delivery_date: deliveryDate,
      delivery_window_label: task.delivery_window_label || task.time_window || null,
      schedule_source: task.schedule_source || null,
      source_type: task.source_type || null,
    });
  }

  if (task.status === 'Out For Delivery' || task.delivery_status === 'out_for_delivery') {
    addEvent(eventsByKey, {
      type: 'out_for_delivery',
      label: 'Out For Delivery',
      timestamp: task.updated_date || null,
      source: 'fulfillment_task',
      status: task.delivery_status || task.status || null,
      task_id: task.id || null,
      fulfillment_number: task.fulfillment_number ?? null,
      production_date: task.production_date || null,
      delivery_date: deliveryDate,
      delivery_window_label: task.delivery_window_label || task.time_window || null,
      schedule_source: task.schedule_source || null,
      source_type: task.source_type || null,
    });
  }

  addEvent(eventsByKey, {
    type: 'delivered',
    label: 'Delivered',
    timestamp: task.delivered_at || null,
    source: 'fulfillment_task',
    status: task.delivery_status || task.status || null,
    task_id: task.id || null,
    fulfillment_number: task.fulfillment_number ?? null,
    production_date: task.production_date || null,
    delivery_date: deliveryDate,
    delivery_window_label: task.delivery_window_label || task.time_window || null,
    schedule_source: task.schedule_source || null,
    source_type: task.source_type || null,
    details: {
      proof_available: proofAvailable,
      delivery_photo_url: task.delivery_photo_url || null,
      delivery_drop_location: task.delivery_drop_location || null,
    },
  });

  if (proofAvailable) {
    addEvent(eventsByKey, {
      type: 'delivery_proof_added',
      label: 'Delivery Proof Added',
      timestamp: task.delivered_at || task.updated_date || null,
      source: 'fulfillment_task',
      status: task.delivery_status || task.status || null,
      task_id: task.id || null,
      fulfillment_number: task.fulfillment_number ?? null,
      production_date: task.production_date || null,
      delivery_date: deliveryDate,
      delivery_window_label: task.delivery_window_label || task.time_window || null,
      schedule_source: task.schedule_source || null,
      source_type: task.source_type || null,
      details: {
        proof_available: true,
        delivery_photo_url: task.delivery_photo_url || null,
        delivery_drop_location: task.delivery_drop_location || null,
      },
    });
  }
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

    const eventsByKey = new Map();
    for (const order of matchedOrders.values()) {
      addOrderEvents(eventsByKey, order);
    }
    for (const task of tasksById.values()) {
      addTaskEvents(eventsByKey, task);
    }

    const events = [...eventsByKey.values()]
      .sort((a, b) => {
        const aHasTimestamp = Boolean(a.timestamp);
        const bHasTimestamp = Boolean(b.timestamp);
        if (aHasTimestamp !== bHasTimestamp) return aHasTimestamp ? -1 : 1;

        const aValue = aHasTimestamp ? a.timestamp : a.date;
        const bValue = bHasTimestamp ? b.timestamp : b.date;
        if (aValue && bValue && aValue !== bValue) return String(aValue).localeCompare(String(bValue));
        if (aValue && !bValue) return -1;
        if (!aValue && bValue) return 1;

        const byType = (a.type || '').localeCompare(b.type || '');
        if (byType !== 0) return byType;
        const bySource = (a.source || '').localeCompare(b.source || '');
        if (bySource !== 0) return bySource;
        return (a.task_id || '').localeCompare(b.task_id || '');
      })
      .slice(0, limit);

    const matchedOrder = [...matchedOrders.values()][0] || null;
    const responseOrderNumber = matchedOrder?.shopify_order_number || formatOrderNumber(orderNumber);

    console.log(`[ORDER-TIMELINE] matched_by=${matchedBy || 'none'} events=${events.length}`);

    return Response.json({
      success: true,
      matched_by: matchedBy,
      order_number: responseOrderNumber,
      count: events.length,
      events,
    });
  } catch (error) {
    console.error('[ORDER-TIMELINE] Error:', error.message);
    return Response.json({ error: 'Unable to load order timeline' }, { status: 500 });
  }
});
