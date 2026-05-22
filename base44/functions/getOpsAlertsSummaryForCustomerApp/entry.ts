import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const QUERY_LIMIT = 201;
const GENERIC_SUMMARY = 'Additional details available in Operations Hub.';

const VALID_SEVERITIES = new Set(['info', 'warning', 'critical']);
const VALID_STATUSES = new Set(['unread', 'read', 'acknowledged', 'resolved', 'dismissed']);
const ACTIVE_STATUSES = new Set(['unread', 'read', 'acknowledged']);

const SEVERITY_PRIORITY = {
  critical: 0,
  warning: 1,
  info: 2,
};

const VALID_CATEGORIES = new Set([
  'Orders',
  'Payments',
  'Subscriptions',
  'Production',
  'Compliance',
  'Delivery',
  'Loyalty',
  'Events',
  'Inventory',
  'Sync',
  'System',
  'Security',
]);

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

function truncate(value, maxLength) {
  const text = normalizeText(value).replace(/\s+/g, ' ');
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

function hasRawPayloadShape(value) {
  const text = normalizeText(value);
  if (!text) return false;

  return /(\{[\s\S]*\}|\[[\s\S]*\])/.test(text) ||
    /===\s*(ALL HEADERS|BODY INFO|PARSED JSON|SHOPIFY HEADERS)/i.test(text) ||
    /\b(headers_received|body_preview|raw body|body length|payload|webhook payload|parsed_order_info)\b/i.test(text) ||
    /\b(x-shopify-|authorization|content-type|hmac|sha-256|webhook-id)\b/i.test(text) ||
    /\b(TypeError|ReferenceError|SyntaxError|Error:|stack trace)\b/i.test(text) ||
    /\n\s*at\s+\S+/i.test(text);
}

function safeInline(value, maxLength = 120, fallback = null) {
  const redacted = redactSensitiveText(value).replace(/\s+/g, ' ');
  if (!redacted) return fallback;
  return truncate(redacted, maxLength);
}

function safeSummaryFromMessage(message) {
  const text = normalizeText(message);
  if (!text) return GENERIC_SUMMARY;
  if (hasRawPayloadShape(text)) return GENERIC_SUMMARY;

  const redacted = redactSensitiveText(text).replace(/\s+/g, ' ');
  if (!redacted || hasRawPayloadShape(redacted)) return GENERIC_SUMMARY;

  return truncate(redacted, 180) || GENERIC_SUMMARY;
}

function normalizeSeverity(value) {
  const severity = normalizeLower(value);
  return VALID_SEVERITIES.has(severity) ? severity : 'info';
}

function normalizeStatus(value) {
  const status = normalizeLower(value);
  return VALID_STATUSES.has(status) ? status : 'read';
}

function normalizeCategory(value) {
  const text = normalizeText(value);
  return VALID_CATEGORIES.has(text) ? text : null;
}

function sanitizeAlert(alert) {
  const title = safeInline(alert.title, 140, 'Operations alert');
  const summary = safeSummaryFromMessage(alert.message);
  const severity = normalizeSeverity(alert.severity);
  const status = normalizeStatus(alert.status);

  return {
    id: alert.id || null,
    title,
    summary,
    severity,
    status,
    category: normalizeCategory(alert.category),
    source: safeInline(alert.source, 80),
    related_record_type: safeInline(alert.related_record_type, 60),
    related_display_id: safeInline(alert.related_display_id, 80),
    created_date: alert.created_date || null,
    updated_date: alert.updated_date || null,
  };
}

function isActiveAlert(alert) {
  return ACTIVE_STATUSES.has(alert.status);
}

function matchesSearch(alert, search) {
  if (!search) return true;
  return [
    alert.title,
    alert.summary,
    alert.category,
    alert.source,
    alert.related_display_id,
  ].some(value => normalizeLower(value).includes(search));
}

function sortAlerts(a, b) {
  const bySeverity = (SEVERITY_PRIORITY[a.severity] ?? 9) - (SEVERITY_PRIORITY[b.severity] ?? 9);
  if (bySeverity !== 0) return bySeverity;

  const aDate = a.updated_date || a.created_date || '';
  const bDate = b.updated_date || b.created_date || '';
  if (aDate !== bDate) return String(bDate).localeCompare(String(aDate));

  return (a.id || '').localeCompare(b.id || '');
}

function buildSummary(activeAlerts) {
  return {
    total_active: activeAlerts.length,
    critical: activeAlerts.filter(alert => alert.severity === 'critical').length,
    warning: activeAlerts.filter(alert => alert.severity === 'warning').length,
    info: activeAlerts.filter(alert => alert.severity === 'info').length,
    unresolved: activeAlerts.length,
  };
}

async function readAlertsByStatus(base44, status) {
  return await base44.asServiceRole.entities.HubAlert.filter(
    { status },
    '-created_date',
    QUERY_LIMIT,
  );
}

function addAlertsById(alertMap, alerts) {
  for (const alert of alerts || []) {
    if (alert?.id) alertMap.set(alert.id, alert);
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

    const url = new URL(req.url);
    const severity = normalizeLower(url.searchParams.get('severity'));
    const status = normalizeLower(url.searchParams.get('status'));
    const category = normalizeText(url.searchParams.get('category'));
    const search = normalizeLower(url.searchParams.get('search'));
    const limit = parseLimit(url.searchParams.get('limit'));

    if (severity && severity !== 'all' && !VALID_SEVERITIES.has(severity)) {
      return Response.json({ error: 'severity must be one of info, warning, critical' }, { status: 400 });
    }

    if (status && status !== 'all' && !VALID_STATUSES.has(status)) {
      return Response.json({
        error: 'status must be one of unread, read, acknowledged, resolved, dismissed',
      }, { status: 400 });
    }

    if (category && category !== 'All' && !VALID_CATEGORIES.has(category)) {
      return Response.json({ error: 'category is not supported' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const activeRawAlertsById = new Map();
    let activeQueryCapped = false;

    for (const activeStatus of ACTIVE_STATUSES) {
      const activeStatusAlerts = await readAlertsByStatus(base44, activeStatus);
      if ((activeStatusAlerts || []).length >= QUERY_LIMIT) activeQueryCapped = true;
      addAlertsById(activeRawAlertsById, activeStatusAlerts);
    }

    const activeSanitizedAlerts = [...activeRawAlertsById.values()]
      .map(sanitizeAlert)
      .filter(alert => alert.id);

    const summary = buildSummary(activeSanitizedAlerts);

    let rawAlertsForResults = [...activeRawAlertsById.values()];
    let resultQueryCapped = activeQueryCapped;
    if (status && status !== 'all' && !ACTIVE_STATUSES.has(status)) {
      rawAlertsForResults = await readAlertsByStatus(base44, status);
      resultQueryCapped = (rawAlertsForResults || []).length >= QUERY_LIMIT;
    }

    const sanitizedAlerts = (rawAlertsForResults || [])
      .map(sanitizeAlert)
      .filter(alert => alert.id);

    const filteredAlerts = sanitizedAlerts.filter(alert => {
      if (!status || status === 'all') {
        if (!isActiveAlert(alert)) return false;
      } else if (alert.status !== status) {
        return false;
      }

      if (severity && severity !== 'all' && alert.severity !== severity) return false;
      if (category && category !== 'All' && alert.category !== category) return false;
      if (!matchesSearch(alert, search)) return false;
      return true;
    }).sort(sortAlerts);

    const truncated = filteredAlerts.length > limit || resultQueryCapped;
    const alerts = filteredAlerts.slice(0, limit);

    console.log(`[OPS-ALERTS-SUMMARY] count=${alerts.length} truncated=${truncated}`);

    return Response.json({
      success: true,
      summary,
      count: alerts.length,
      truncated,
      alerts,
    });
  } catch (error) {
    console.error('[OPS-ALERTS-SUMMARY] Error:', error.message);
    return Response.json({ error: 'Unable to load ops alerts summary' }, { status: 500 });
  }
});
