import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const CHICAGO_TZ = 'America/Chicago';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;

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

function sanitizeAssignedDriver(value) {
  const text = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]');

  if (!text) return null;
  return text.length > 120 ? `${text.slice(0, 119).trim()}...` : text;
}

function sanitizeCustomerName(value) {
  const text = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]');

  if (!text) return null;
  return text.length > 120 ? `${text.slice(0, 119).trim()}...` : text;
}

function sanitizeAddress(value) {
  const text = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]');

  if (!text) return null;
  return text.length > 240 ? `${text.slice(0, 239).trim()}...` : text;
}

function fullAddress(task) {
  const direct = normalizeText(task.delivery_address) || normalizeText(task.address);
  if (direct) return direct;

  return [
    task.address_line1,
    task.address_line2,
    task.address_city,
    task.address_state,
    task.address_postal_code,
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join(', ');
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

function parseLimit(value) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function hasAddress(task) {
  return Boolean(
    normalizeText(task.address) ||
    normalizeText(task.delivery_address) ||
    normalizeText(task.address_line1) ||
    normalizeText(task.address_city) ||
    normalizeText(task.address_state) ||
    normalizeText(task.address_postal_code)
  );
}

function isCancelledTask(task) {
  const status = normalizeText(task.status).toLowerCase();
  const deliveryStatus = normalizeText(task.delivery_status).toLowerCase();
  return status === 'cancelled' || status === 'canceled' ||
    deliveryStatus === 'cancelled' || deliveryStatus === 'canceled';
}

function isCompletedTask(task) {
  const status = normalizeText(task.status).toLowerCase();
  const deliveryStatus = normalizeText(task.delivery_status).toLowerCase();
  return deliveryStatus === 'delivered' ||
    status === 'completed' ||
    status === 'complete' ||
    status === 'fulfilled';
}

function sanitizeStop(task, deliveryDate) {
  const deliveryWindowLabel = task.delivery_window_label || task.time_window || null;
  const proofAvailable = Boolean(task.delivery_photo_url || task.delivery_drop_location);
  const resolvedAddress = fullAddress(task);

  return {
    task_id: task.id || null,
    order_number: task.order_number || null,
    customer_name: sanitizeCustomerName(task.customer_name),
    fulfillment_number: task.fulfillment_number ?? null,
    source_type: task.source_type || null,
    assigned_driver: sanitizeAssignedDriver(task.assigned_driver),
    task_status: task.status || null,
    delivery_status: task.delivery_status || null,
    fulfillment_status: null,
    delivery_date: task.scheduled_date || task.delivery_date || deliveryDate,
    delivery_window_label: deliveryWindowLabel,
    delivery_address: sanitizeAddress(resolvedAddress),
    items_summary: task.items_summary || null,
    delivered_at: task.delivered_at || null,
    proof_available: proofAvailable,
    delivery_photo_url: task.delivery_photo_url || null,
    delivery_drop_location: task.delivery_drop_location || null,
    missing_address: !resolvedAddress,
    bag_return_required: null,
    bag_return_count: null,
  };
}

function stopSortKey(stop) {
  return [
    stop.delivery_window_label || '',
    stop.order_number || '',
    stop.task_id || '',
  ].join('|');
}

function sortStops(a, b) {
  return stopSortKey(a).localeCompare(stopSortKey(b));
}

function buildSections(tasks, deliveryDate, limit) {
  const deliveryStops = [];
  const completed = [];

  for (const task of tasks) {
    if (isCancelledTask(task)) continue;

    const stop = sanitizeStop(task, deliveryDate);
    if (isCompletedTask(task)) {
      completed.push(stop);
    } else {
      deliveryStops.push(stop);
    }
  }

  deliveryStops.sort(sortStops);
  completed.sort(sortStops);

  const limitedStops = [];
  const limitedCompleted = [];
  for (const stop of [...deliveryStops, ...completed].slice(0, limit)) {
    if (completed.includes(stop)) {
      limitedCompleted.push(stop);
    } else {
      limitedStops.push(stop);
    }
  }

  return {
    delivery_stops: limitedStops,
    completed: limitedCompleted,
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
    let deliveryDate;
    try {
      deliveryDate = parseIsoDate(
        url.searchParams.get('delivery_date') || url.searchParams.get('date'),
        'delivery_date',
      ) || todayChicagoDate();
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const limit = parseLimit(url.searchParams.get('limit'));
    const base44 = createClientFromRequest(req);
    const tasksById = new Map();

    const addTasks = (tasks) => {
      for (const task of tasks || []) {
        if (task?.id) tasksById.set(task.id, task);
      }
    };

    const scheduledTasks = await base44.asServiceRole.entities.FulfillmentTask.filter(
      { scheduled_date: deliveryDate },
      'time_window',
      MAX_LIMIT,
    );
    addTasks(scheduledTasks);

    const legacyDeliveryDateTasks = await base44.asServiceRole.entities.FulfillmentTask.filter(
      { delivery_date: deliveryDate },
      'time_window',
      MAX_LIMIT,
    );
    addTasks(legacyDeliveryDateTasks);

    const sections = buildSections([...tasksById.values()], deliveryDate, limit);
    const active = sections.delivery_stops.length;
    const completed = sections.completed.length;

    console.log(`[DELIVERY-ROUTE-SUMMARY] delivery_date=${deliveryDate} active=${active} completed=${completed}`);

    return Response.json({
      success: true,
      delivery_date: deliveryDate,
      summary: {
        total_stops: active + completed,
        active,
        completed,
        bag_returns: null,
      },
      sections,
    });
  } catch (error) {
    console.error('[DELIVERY-ROUTE-SUMMARY] Error:', error.message);
    return Response.json({ error: 'Unable to load delivery route summary' }, { status: 500 });
  }
});
