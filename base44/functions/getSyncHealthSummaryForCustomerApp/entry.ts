import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const CHICAGO_TZ = 'America/Chicago';
const MAX_RANGE_DAYS = 31;
const DEFAULT_PRESET = 'last_7_days';
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;
const STALE_AFTER_MINUTES = 30;

const VALID_PRESETS = new Set(['today', 'last_7_days', 'last_30_days']);
const VALID_DERIVED_STATUSES = new Set([
  'success',
  'failed',
  'pending',
  'stale',
  'created',
  'updated',
  'skipped',
  'rejected',
  'quarantined',
]);

const CUSTOMER_APP_TO_HUB_SOURCES = new Set([
  'customer_app_pull',
  'stripe_webhook',
  'manual_recovery',
  'scheduled_rebuild',
  'repair_worker',
]);

const HUB_TO_CUSTOMER_APP_SOURCES = new Set([
  'hub_to_customer_app',
  'status_readback',
  'delivery_status_readback',
  'customer_app_status_sync',
]);

const DISABLED_OR_DEPRECATED_TOOLS = [
  {
    name: 'pullOrderStatusUpdates',
    status: 'disabled',
    note: 'Legacy Hub status pull path is disabled; Customer App scheduled readback owns status visibility.',
  },
  {
    name: 'pushOrderStatusToCustomerApp',
    status: 'disabled',
    note: 'Direct Hub-to-Customer-App status push is disabled; status readback is pull-based.',
  },
].sort((a, b) => a.name.localeCompare(b.name));

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
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
}

function resolveDateRange(url) {
  const preset = normalizeLower(url.searchParams.get('preset'));
  const dateFrom = parseIsoDate(url.searchParams.get('date_from'), 'date_from');
  const dateTo = parseIsoDate(url.searchParams.get('date_to'), 'date_to');

  if (preset && !VALID_PRESETS.has(preset)) {
    throw new Error('preset must be one of today, last_7_days, last_30_days');
  }

  if ((dateFrom || dateTo) && preset) {
    throw new Error('Use either preset or date_from/date_to, not both');
  }

  if (dateFrom || dateTo) {
    return {
      dateFrom: dateFrom || dateTo,
      dateTo: dateTo || dateFrom,
    };
  }

  const today = todayChicagoDate();
  const effectivePreset = preset || DEFAULT_PRESET;
  if (effectivePreset === 'today') {
    return { dateFrom: today, dateTo: today };
  }
  if (effectivePreset === 'last_30_days') {
    return { dateFrom: addDays(today, -29), dateTo: today };
  }
  return { dateFrom: addDays(today, -6), dateTo: today };
}

function parseLimit(value) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function datePart(value) {
  return normalizeText(value).slice(0, 10);
}

function logTimestamp(log) {
  return normalizeText(log.sync_timestamp || log.created_date || log.updated_date);
}

function inDateRange(log, dateFrom, dateTo) {
  const date = datePart(logTimestamp(log));
  return Boolean(date) && date >= dateFrom && date <= dateTo;
}

function minutesSince(timestamp) {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / 60000));
}

function deriveStatus(log) {
  const action = normalizeLower(log.action);
  const hasError = Boolean(normalizeText(log.error));

  if (log.success === false || hasError || action === 'rejected' || action === 'quarantined') {
    return 'failed';
  }
  if (log.success === true || action === 'created' || action === 'updated' || action === 'skipped') {
    return 'success';
  }
  return 'pending';
}

function isStale(log) {
  return deriveStatus(log) === 'pending' && minutesSince(logTimestamp(log)) >= STALE_AFTER_MINUTES;
}

function directionForLog(log) {
  const source = normalizeLower(log.sync_source);
  const eventType = normalizeLower(log.event_type);

  if (HUB_TO_CUSTOMER_APP_SOURCES.has(source) ||
    eventType.includes('hub_to_customer_app') ||
    eventType.includes('status_readback')) {
    return 'hub_to_customer_app';
  }

  if (CUSTOMER_APP_TO_HUB_SOURCES.has(source) ||
    eventType.includes('customer_app') ||
    eventType.includes('checkout') ||
    eventType.includes('invoice') ||
    eventType.includes('refund')) {
    return 'customer_app_to_hub';
  }

  return 'customer_app_to_hub';
}

function matchesOptionalFilters(log, filters) {
  const derivedStatus = deriveStatus(log);
  const action = normalizeLower(log.action);
  const source = normalizeLower(log.sync_source);

  if (filters.status) {
    if (filters.status === 'stale') {
      if (!isStale(log)) return false;
    } else if (filters.status !== derivedStatus && filters.status !== action) {
      return false;
    }
  }

  if (filters.source && filters.source !== source) return false;
  if (filters.action && filters.action !== action) return false;

  return true;
}

function redactedErrorText(log) {
  return normalizeText(log.error || log.reason || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl)\b/gi, '[redacted address]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]')
    .replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, '[redacted token]');
}

function categorizeError(log) {
  const text = redactedErrorText(log).toLowerCase();
  const action = normalizeLower(log.action);

  if (action === 'rejected') return 'validation_rejected';
  if (action === 'quarantined') return 'queued_for_review';
  if (/\b(401|403|unauthorized|forbidden|authorization|bearer|auth)\b/.test(text)) return 'auth_error';
  if (/\b(timeout|timed out|network|fetch failed|econn|connection|503|502|500)\b/.test(text)) return 'hub_unreachable';
  if (/\b(validation|required|missing|invalid|malformed|bad request|400)\b/.test(text)) return 'validation_rejected';
  if (/\b(duplicate|dedupe|already exists)\b/.test(text)) return 'duplicate_or_dedupe';
  if (/\b(manual review|review required|quarantine|queued)\b/.test(text)) return 'queued_for_review';
  if (/\b(stripe|shopify|provider)\b/.test(text)) return 'provider_sync_error';
  return 'sync_error';
}

function emptyDirectionSummary() {
  return {
    total: 0,
    success: 0,
    failed: 0,
    pending: 0,
  };
}

function incrementDirection(summary, direction, status) {
  const target = summary[direction] || summary.customer_app_to_hub;
  target.total += 1;
  if (status === 'failed') target.failed += 1;
  else if (status === 'pending') target.pending += 1;
  else target.success += 1;
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
      return Response.json({ error: 'Date range cannot exceed 31 days' }, { status: 400 });
    }

    const status = normalizeLower(url.searchParams.get('status'));
    const source = normalizeLower(url.searchParams.get('source'));
    const action = normalizeLower(url.searchParams.get('action'));
    const limit = parseLimit(url.searchParams.get('limit'));

    if (status && !VALID_DERIVED_STATUSES.has(status)) {
      return Response.json({
        error: 'status must be one of success, failed, pending, stale, created, updated, skipped, rejected, quarantined',
      }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const rawLogs = await base44.asServiceRole.entities.OrderSyncLog.list('-sync_timestamp', limit + 1);
    const readWasCapped = rawLogs.length > limit;
    const candidateLogs = rawLogs.slice(0, limit);

    const filters = { status, source, action };
    const logs = candidateLogs
      .filter(log => inDateRange(log, dateFrom, dateTo))
      .filter(log => matchesOptionalFilters(log, filters));

    const summary = {
      total_events: logs.length,
      success_count: 0,
      failed_count: 0,
      pending_count: 0,
      stale_count: 0,
      latest_success_at: null,
      latest_failure_at: null,
    };

    const directions = {
      customer_app_to_hub: emptyDirectionSummary(),
      hub_to_customer_app: emptyDirectionSummary(),
    };

    const errorCategoryMap = new Map();

    for (const log of logs) {
      const derivedStatus = deriveStatus(log);
      const timestamp = logTimestamp(log) || null;
      const direction = directionForLog(log);

      if (derivedStatus === 'failed') {
        summary.failed_count += 1;
        if (timestamp && (!summary.latest_failure_at || timestamp > summary.latest_failure_at)) {
          summary.latest_failure_at = timestamp;
        }

        const category = categorizeError(log);
        const existing = errorCategoryMap.get(category) || {
          category,
          count: 0,
          latest_seen_at: null,
        };
        existing.count += 1;
        if (timestamp && (!existing.latest_seen_at || timestamp > existing.latest_seen_at)) {
          existing.latest_seen_at = timestamp;
        }
        errorCategoryMap.set(category, existing);
      } else if (derivedStatus === 'pending') {
        summary.pending_count += 1;
      } else {
        summary.success_count += 1;
        if (timestamp && (!summary.latest_success_at || timestamp > summary.latest_success_at)) {
          summary.latest_success_at = timestamp;
        }
      }

      if (isStale(log)) summary.stale_count += 1;
      incrementDirection(directions, direction, derivedStatus);
    }

    const errorCategories = [...errorCategoryMap.values()]
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return String(b.latest_seen_at || '').localeCompare(String(a.latest_seen_at || ''));
      })
      .slice(0, 10);

    return Response.json({
      success: true,
      date_from: dateFrom,
      date_to: dateTo,
      generated_at: new Date().toISOString(),
      summary,
      directions,
      error_categories: errorCategories,
      disabled_or_deprecated_tools: DISABLED_OR_DEPRECATED_TOOLS,
      truncated: readWasCapped,
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Unable to build sync health summary' }, { status: 400 });
  }
});
