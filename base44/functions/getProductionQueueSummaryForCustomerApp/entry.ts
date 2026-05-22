import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_RANGE_DAYS = 31;
const DEFAULT_RANGE_DAYS_AHEAD = 14;
const MAX_BATCHES = 100;
const QUERY_BATCHES_PER_DATE = MAX_BATCHES + 1;
const CHICAGO_TZ = 'America/Chicago';

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

function parseIsoDate(value, fieldName) {
  const text = (value || '').toString().trim();
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

function sourceTypeCounts(orderSources) {
  const counts = {};
  for (const source of Array.isArray(orderSources) ? orderSources : []) {
    const key = (source?.source_type || 'unknown').toString();
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function orderNumbers(orderSources) {
  const numbers = [];
  for (const source of Array.isArray(orderSources) ? orderSources : []) {
    const orderNumber = (source?.order_number || '').toString().trim();
    if (orderNumber) numbers.push(orderNumber);
  }
  return [...new Set(numbers)].slice(0, 50);
}

function sanitizeBatch(batch) {
  const sources = Array.isArray(batch.order_sources) ? batch.order_sources : [];
  return {
    id: batch.id || null,
    batch_id: batch.batch_id || null,
    production_date: batch.production_date || null,
    product_name: batch.product_name || null,
    product_category: batch.product_category || null,
    status: batch.status || null,
    planned_units: batch.planned_units ?? null,
    actual_units: batch.actual_units ?? null,
    is_locked: batch.is_locked === true,
    order_count: sources.length,
    order_numbers: orderNumbers(sources),
    source_type_counts: sourceTypeCounts(sources),
    updated_date: batch.updated_date || null,
  };
}

function sortBatches(a, b) {
  const byDate = (a.production_date || '').localeCompare(b.production_date || '');
  if (byDate !== 0) return byDate;
  const byProduct = (a.product_name || '').localeCompare(b.product_name || '');
  if (byProduct !== 0) return byProduct;
  return (a.batch_id || '').localeCompare(b.batch_id || '');
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
      dateFrom = parseIsoDate(url.searchParams.get('date_from'), 'date_from');
      dateTo = parseIsoDate(url.searchParams.get('date_to'), 'date_to');
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const today = todayChicagoDate();
    if (!dateFrom && !dateTo) {
      dateFrom = today;
      dateTo = addDays(today, DEFAULT_RANGE_DAYS_AHEAD);
    } else if (dateFrom && !dateTo) {
      dateTo = addDays(dateFrom, DEFAULT_RANGE_DAYS_AHEAD);
    } else if (!dateFrom && dateTo) {
      dateFrom = today;
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

    const base44 = createClientFromRequest(req);
    const batchesById = new Map();

    for (const productionDate of enumerateDates(dateFrom, dateTo)) {
      const dayBatches = await base44.asServiceRole.entities.ProductionBatch.filter(
        { production_date: productionDate },
        'product_name',
        QUERY_BATCHES_PER_DATE,
      );
      for (const batch of dayBatches || []) {
        if (batch?.id) batchesById.set(batch.id, batch);
      }
    }

    const allSummaries = [...batchesById.values()]
      .map(sanitizeBatch)
      .sort(sortBatches);
    const truncated = allSummaries.length > MAX_BATCHES;
    const batches = allSummaries.slice(0, MAX_BATCHES);

    console.log(`[PRODUCTION-QUEUE-SUMMARY] date_from=${dateFrom} date_to=${dateTo} count=${batches.length} truncated=${truncated}`);

    return Response.json({
      success: true,
      date_from: dateFrom,
      date_to: dateTo,
      count: batches.length,
      truncated,
      batches,
    });
  } catch (error) {
    console.error('[PRODUCTION-QUEUE-SUMMARY] Error:', error.message);
    return Response.json({ error: 'Unable to load production queue summary' }, { status: 500 });
  }
});
