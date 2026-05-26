import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const CHICAGO_TZ = 'America/Chicago';
const MAX_RANGE_DAYS = 31;
const DEFAULT_PRESET = 'last_7_days';
const ORDER_QUERY_LIMIT = 1000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function normalizeText(value) {
  return (value || '').toString().trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

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

function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

function daysInclusive(from, to) {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
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
    return {
      dateFrom: dateFrom || dateTo,
      dateTo: dateTo || dateFrom,
    };
  }

  const effectivePreset = preset || DEFAULT_PRESET;
  if (effectivePreset === 'today') return { dateFrom: today, dateTo: today };
  if (effectivePreset === 'last_30_days') return { dateFrom: addDays(today, -29), dateTo: today };
  return { dateFrom: addDays(today, -6), dateTo: today };
}

function normalizeLimit(value) {
  const text = normalizeText(value);
  if (!text) return DEFAULT_LIMIT;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('limit must be a positive integer');
  }
  return Math.min(parsed, MAX_LIMIT);
}

function datePart(value) {
  return normalizeText(value).slice(0, 10);
}

function orderDate(order) {
  return datePart(order.customer_order_date || order.created_date || order.updated_date);
}

function inDateRange(value, dateFrom, dateTo) {
  const date = datePart(value);
  return Boolean(date) && date >= dateFrom && date <= dateTo;
}

function isPOSOrder(order) {
  const sourceType = normalizeLower(order.source_type);
  const sourceChannel = normalizeLower(order.source_channel);
  const orderType = normalizeLower(order.order_type);
  const fulfillmentMethod = normalizeLower(order.fulfillment_method);
  const tags = Array.isArray(order.tags) ? order.tags.map(normalizeLower) : [];

  return sourceType.includes('pos') ||
    sourceChannel === 'pos' ||
    orderType === 'pos' ||
    fulfillmentMethod === 'pos' ||
    tags.includes('pos_sale') ||
    tags.includes('event_sale');
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function truncateText(value, maxLength = 160) {
  const text = normalizeText(value);
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function resolveLocationLabel(order) {
  const explicit = truncateText(order.pos_location_name || order.event_name || order.location_name, 80);
  if (explicit) return explicit;

  const notes = normalizeText(order.internal_notes);
  const match = notes.match(/POS Sale\s*[—-]\s*([^|]+)/i);
  if (match?.[1]) return truncateText(match[1], 80);
  return null;
}

function sanitizeLineItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 20).map(item => ({
    title: truncateText(item?.title || item?.name || item?.product_name, 80),
    variant_title: truncateText(item?.variant_title, 80),
    sku: truncateText(item?.sku, 40),
    quantity: numberOrZero(item?.quantity),
    price: numberOrNull(item?.price),
  })).filter(item => item.title || item.quantity);
}

function sanitizeOrder(order) {
  return {
    id: order.id || null,
    order_number: order.shopify_order_number || order.order_number || null,
    customer_name: truncateText(order.customer_name || 'Walk-in Customer', 80),
    customer_email: truncateText(order.customer_email, 120),
    total_price: numberOrNull(order.total_price),
    subtotal: numberOrNull(order.subtotal),
    payment_status: truncateText(order.payment_status || order.financial_status, 40),
    fulfillment_status: truncateText(order.fulfillment_status, 40),
    production_status: truncateText(order.production_status, 40),
    order_lock_status: truncateText(order.order_lock_status, 40),
    source_channel: truncateText(order.source_channel, 40),
    source_type: truncateText(order.source_type, 40),
    order_type: truncateText(order.order_type, 40),
    fulfillment_method: truncateText(order.fulfillment_method, 40),
    customer_order_date: order.customer_order_date || null,
    created_date: order.created_date || null,
    location_label: resolveLocationLabel(order),
    tags: Array.isArray(order.tags) ? order.tags.map(tag => truncateText(tag, 40)).filter(Boolean).slice(0, 12) : [],
    line_items: sanitizeLineItems(order.line_items),
    item_count: Array.isArray(order.line_items)
      ? order.line_items.reduce((sum, item) => sum + numberOrZero(item?.quantity), 0)
      : 0,
    internal_note_summary: truncateText(order.internal_notes, 160),
    requires_delivery: order.requires_delivery === true,
    requires_production: order.requires_production === true,
    requires_fulfillment_task: order.requires_fulfillment_task === true,
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
    let limit;

    try {
      const range = resolveDateRange(url);
      dateFrom = range.dateFrom;
      dateTo = range.dateTo;
      limit = normalizeLimit(url.searchParams.get('limit'));
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    if (dateTo < dateFrom) {
      return Response.json({ error: 'date_to must be on or after date_from' }, { status: 400 });
    }
    if (daysInclusive(dateFrom, dateTo) > MAX_RANGE_DAYS) {
      return Response.json({
        error: `Date range must be ${MAX_RANGE_DAYS} days or fewer`,
        max_range_days: MAX_RANGE_DAYS,
      }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', ORDER_QUERY_LIMIT);
    const truncated_source = (allOrders || []).length >= ORDER_QUERY_LIMIT;
    const posOrders = (allOrders || [])
      .filter(isPOSOrder)
      .filter(order => inDateRange(orderDate(order), dateFrom, dateTo));

    const total = posOrders.length;
    const orders = posOrders.slice(0, limit).map(sanitizeOrder);

    const summary = {
      total,
      shown: orders.length,
      paid: posOrders.filter(order => normalizeLower(order.payment_status || order.financial_status) === 'paid').length,
      fulfilled: posOrders.filter(order => normalizeLower(order.fulfillment_status) === 'fulfilled').length,
      production_not_required: posOrders.filter(order => normalizeLower(order.production_status) === 'not_required').length,
      requires_delivery: posOrders.filter(order => order.requires_delivery === true).length,
      requires_production: posOrders.filter(order => order.requires_production === true).length,
      requires_fulfillment_task: posOrders.filter(order => order.requires_fulfillment_task === true).length,
    };

    console.log(`[POS-ORDERS-SUMMARY] date_from=${dateFrom} date_to=${dateTo} total=${total} shown=${orders.length}`);

    return Response.json({
      success: true,
      source: 'hub_pos_orders_summary',
      generated_at: new Date().toISOString(),
      date_from: dateFrom,
      date_to: dateTo,
      summary,
      count: orders.length,
      truncated: truncated_source || total > orders.length,
      orders,
    });
  } catch (error) {
    console.error('[POS-ORDERS-SUMMARY] Error:', error.message);
    return Response.json({ error: 'Unable to load POS orders summary' }, { status: 500 });
  }
});
