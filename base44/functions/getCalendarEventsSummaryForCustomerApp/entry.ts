import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const CHICAGO_TZ = 'America/Chicago';
const MAX_RANGE_DAYS = 31;
const DEFAULT_PRESET = 'current_month';
const DEFAULT_LIMIT = 150;
const MAX_LIMIT = 250;
const EVENT_QUERY_LIMIT = 500;
const BATCH_QUERY_LIMIT = 1000;
const TASK_QUERY_LIMIT = 1000;
const SAFE_TEXT_LIMIT = 140;

const VALID_PRESETS = new Set(['current_month', 'next_30_days', 'today']);
const VALID_TYPES = new Set(['event', 'production', 'delivery', 'compliance']);
const ITEM_TYPE_ORDER = {
  event: 0,
  production: 1,
  delivery: 2,
  compliance: 3,
};

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

function parseLimit(value) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function truncate(value, maxLength = SAFE_TEXT_LIMIT) {
  const text = normalizeText(value).replace(/\s+/g, ' ');
  if (!text) return null;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}...`;
}

function redactSensitiveText(value) {
  return normalizeText(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl)\b/gi, '[redacted address]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]')
    .replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, '[redacted token]');
}

function safeInline(value, maxLength = SAFE_TEXT_LIMIT) {
  const redacted = redactSensitiveText(value).replace(/\s+/g, ' ');
  return truncate(redacted, maxLength);
}

function safeLocation(value) {
  const text = safeInline(value, 100);
  if (!text) return null;
  if (text.includes('[redacted address]')) return null;
  return text;
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

function startOfMonth(dateStr) {
  return `${dateStr.slice(0, 7)}-01`;
}

function endOfMonth(dateStr) {
  const [year, month] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month, 0));
  return date.toISOString().slice(0, 10);
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

  if (preset && !VALID_PRESETS.has(preset)) {
    throw new Error('preset must be one of current_month, next_30_days, today');
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
  if (effectivePreset === 'today') {
    return { dateFrom: today, dateTo: today };
  }
  if (effectivePreset === 'next_30_days') {
    return { dateFrom: today, dateTo: addDays(today, 29) };
  }
  return { dateFrom: startOfMonth(today), dateTo: endOfMonth(today) };
}

function datePart(value) {
  return normalizeText(value).slice(0, 10);
}

function inDateRange(value, dateFrom, dateTo) {
  const date = datePart(value);
  return Boolean(date) && date >= dateFrom && date <= dateTo;
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeStatus(value, fallback = 'scheduled') {
  return safeInline(value, 60) || fallback;
}

function sanitizeEvent(event) {
  const startDate = datePart(event.date);
  if (!startDate) return null;

  return {
    id: event.id || null,
    type: 'event',
    title: safeInline(event.name, 140) || 'Event',
    event_type: safeInline(event.type, 60),
    status: normalizeStatus(event.status, 'scheduled'),
    start_datetime: startDate,
    end_datetime: datePart(event.end_date) || startDate,
    location: safeLocation(event.location),
    summary: safeInline(event.description || event.type, 160),
  };
}

function activeProductionBatch(batch) {
  const status = normalizeLower(batch.status);
  return !['archived', 'cancelled', 'canceled', 'void', 'deleted'].includes(status);
}

function productKey(batch) {
  return normalizeLower(batch.product_name) || 'unknown product';
}

function summarizeProduction(date, batches) {
  const productNames = new Set();
  const statusCounts = {};
  let plannedUnits = 0;

  for (const batch of batches) {
    const product = productKey(batch);
    if (product) productNames.add(product);
    plannedUnits += numberOrZero(batch.planned_units);

    const status = normalizeStatus(batch.status, 'planned');
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }

  return {
    type: 'production',
    production_date: date,
    batch_count: batches.length,
    product_count: productNames.size,
    planned_units: plannedUnits,
    status_counts: statusCounts,
  };
}

function deliveryDate(task) {
  return datePart(task.scheduled_date || task.delivery_date);
}

function isCompletedDelivery(task) {
  const status = normalizeLower(task.status);
  const deliveryStatus = normalizeLower(task.delivery_status);
  return status === 'completed' ||
    status === 'complete' ||
    status === 'fulfilled' ||
    deliveryStatus === 'delivered' ||
    Boolean(task.delivered_at);
}

function summarizeDelivery(date, tasks) {
  const sourceTypeCounts = {};
  let completedCount = 0;

  for (const task of tasks) {
    if (isCompletedDelivery(task)) completedCount += 1;
    const sourceType = safeInline(task.source_type || task.fulfillment_type || 'other', 60) || 'other';
    sourceTypeCounts[sourceType] = (sourceTypeCounts[sourceType] || 0) + 1;
  }

  return {
    type: 'delivery',
    delivery_date: date,
    stop_count: tasks.length,
    completed_count: completedCount,
    pending_count: Math.max(0, tasks.length - completedCount),
    source_type_counts: sourceTypeCounts,
  };
}

function itemDate(item) {
  return item.start_datetime || item.production_date || item.delivery_date || item.date || '';
}

function itemSearchText(item) {
  if (item.type === 'event') {
    return [
      item.title,
      item.event_type,
      item.status,
      item.location,
      item.summary,
    ].filter(Boolean).join(' ');
  }

  if (item.type === 'production') {
    return [
      'production',
      item.production_date,
      Object.keys(item.status_counts || {}).join(' '),
    ].filter(Boolean).join(' ');
  }

  if (item.type === 'delivery') {
    return [
      'delivery',
      item.delivery_date,
      Object.keys(item.source_type_counts || {}).join(' '),
    ].filter(Boolean).join(' ');
  }

  return '';
}

function itemMatchesFilters(item, filters) {
  if (filters.type && item.type !== filters.type) return false;

  if (filters.status) {
    if (item.type === 'event' && normalizeLower(item.status) !== filters.status) return false;
    if (item.type === 'production' && !Object.keys(item.status_counts || {}).some(status => normalizeLower(status) === filters.status)) return false;
    if (item.type === 'delivery') {
      const deliveryStatus = item.pending_count > 0 ? 'pending' : 'completed';
      if (deliveryStatus !== filters.status) return false;
    }
  }

  if (filters.search && !normalizeLower(itemSearchText(item)).includes(filters.search)) return false;
  return true;
}

function sortCalendarItems(a, b) {
  const byType = (ITEM_TYPE_ORDER[a.type] ?? 9) - (ITEM_TYPE_ORDER[b.type] ?? 9);
  if (byType !== 0) return byType;

  const aTime = itemDate(a);
  const bTime = itemDate(b);
  if (aTime !== bTime) return aTime.localeCompare(bTime);

  return (a.title || a.type || '').localeCompare(b.title || b.type || '');
}

function buildDateGroups(items) {
  const byDate = new Map();

  for (const item of items) {
    const date = itemDate(item);
    if (!date) continue;

    const group = byDate.get(date) || {
      date,
      counts: {
        events: 0,
        production: 0,
        delivery: 0,
        compliance: 0,
      },
      items: [],
    };

    if (item.type === 'event') group.counts.events += 1;
    if (item.type === 'production') group.counts.production += 1;
    if (item.type === 'delivery') group.counts.delivery += 1;
    if (item.type === 'compliance') group.counts.compliance += 1;

    group.items.push(item);
    byDate.set(date, group);
  }

  return [...byDate.values()]
    .map(group => ({
      ...group,
      items: group.items.sort(sortCalendarItems),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildSummary(items) {
  const productionDates = new Set();
  const deliveryDates = new Set();

  for (const item of items) {
    if (item.type === 'production') productionDates.add(item.production_date);
    if (item.type === 'delivery') deliveryDates.add(item.delivery_date);
  }

  return {
    total_items: items.length,
    events: items.filter(item => item.type === 'event').length,
    production_days: productionDates.size,
    delivery_days: deliveryDates.size,
    compliance_items: items.filter(item => item.type === 'compliance').length,
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
    const { dateFrom, dateTo } = resolveDateRange(url);
    const rangeDays = daysInclusive(dateFrom, dateTo);
    if (dateTo < dateFrom) {
      return Response.json({ error: 'date_to must be on or after date_from' }, { status: 400 });
    }
    if (rangeDays > MAX_RANGE_DAYS) {
      return Response.json({ error: `Date range must be ${MAX_RANGE_DAYS} days or fewer` }, { status: 400 });
    }

    const type = normalizeLower(url.searchParams.get('type'));
    if (type && !VALID_TYPES.has(type)) {
      return Response.json({ error: 'type must be one of event, production, delivery, compliance' }, { status: 400 });
    }

    const filters = {
      type,
      status: normalizeLower(url.searchParams.get('status')),
      search: normalizeLower(url.searchParams.get('search')),
    };
    const limit = parseLimit(url.searchParams.get('limit'));

    const base44 = createClientFromRequest(req);
    const [eventsRaw, batchesRaw, tasksRaw] = await Promise.all([
      base44.asServiceRole.entities.Event.list('date', EVENT_QUERY_LIMIT),
      base44.asServiceRole.entities.ProductionBatch.list('production_date', BATCH_QUERY_LIMIT),
      base44.asServiceRole.entities.FulfillmentTask.list('scheduled_date', TASK_QUERY_LIMIT),
    ]);

    const truncatedByRead = (eventsRaw || []).length >= EVENT_QUERY_LIMIT ||
      (batchesRaw || []).length >= BATCH_QUERY_LIMIT ||
      (tasksRaw || []).length >= TASK_QUERY_LIMIT;

    const items = [];
    for (const event of eventsRaw || []) {
      if (!inDateRange(event.date, dateFrom, dateTo)) continue;
      const sanitized = sanitizeEvent(event);
      if (sanitized) items.push(sanitized);
    }

    const batchesByDate = new Map();
    for (const batch of batchesRaw || []) {
      const date = datePart(batch.production_date);
      if (!date || date < dateFrom || date > dateTo || !activeProductionBatch(batch)) continue;
      const batches = batchesByDate.get(date) || [];
      batches.push(batch);
      batchesByDate.set(date, batches);
    }

    for (const [date, batches] of batchesByDate.entries()) {
      items.push(summarizeProduction(date, batches));
    }

    const tasksByDate = new Map();
    for (const task of tasksRaw || []) {
      const date = deliveryDate(task);
      if (!date || date < dateFrom || date > dateTo) continue;
      const status = normalizeLower(task.status);
      if (['cancelled', 'canceled', 'void', 'deleted'].includes(status)) continue;
      const tasks = tasksByDate.get(date) || [];
      tasks.push(task);
      tasksByDate.set(date, tasks);
    }

    for (const [date, tasks] of tasksByDate.entries()) {
      items.push(summarizeDelivery(date, tasks));
    }

    const filteredItems = items
      .filter(item => itemMatchesFilters(item, filters))
      .sort((a, b) => {
        const dateCompare = itemDate(a).localeCompare(itemDate(b));
        return dateCompare || sortCalendarItems(a, b);
      });
    const limitedItems = filteredItems.slice(0, limit);

    return Response.json({
      success: true,
      date_from: dateFrom,
      date_to: dateTo,
      generated_at: new Date().toISOString(),
      summary: buildSummary(filteredItems),
      dates: buildDateGroups(limitedItems),
      truncated: truncatedByRead || filteredItems.length > limitedItems.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    const status = /date_|preset|Use either/.test(message) ? 400 : 500;
    return Response.json({ error: status === 400 ? message : 'Unable to load calendar summary' }, { status });
  }
});
