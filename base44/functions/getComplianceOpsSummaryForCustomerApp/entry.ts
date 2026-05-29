import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_RANGE_DAYS = 31;
const DEFAULT_RANGE_DAYS_BACK = 6;
const MAX_ITEMS = 60;
const QUERY_LIMIT = 500;
const CHICAGO_TZ = 'America/Chicago';

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function sanitizeText(value, maxLength = 160) {
  const text = normalizeText(value)
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl)\b/gi, '[redacted address]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]');

  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
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
  if (date.toISOString().slice(0, 10) !== text) {
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

function inRange(record, dateField, dateFrom, dateTo) {
  const date = normalizeText(record?.[dateField]);
  return date && date >= dateFrom && date <= dateTo;
}

function statusOf(value) {
  return normalizeText(value).toLowerCase();
}

function isOpenCorrectiveAction(log) {
  const status = statusOf(log.status);
  return !['completed', 'verified', 'resolved', 'closed'].includes(status);
}

function isFailedBatch(log) {
  const status = statusOf(log.passed_failed);
  return status === 'failed' || status === 'fail';
}

function isChecklistIncomplete(checklist) {
  const status = statusOf(checklist.overall_status);
  return status === 'incomplete' || status === 'pending';
}

function isSanitationIssue(log) {
  return log.cleaned === false || log.sanitized === false || statusOf(log.sanitizer_level) === 'low';
}

function isProductionBatchNeedingCompliance(batch) {
  const status = statusOf(batch.status);
  return ['completed_pending_verification', 'verified_logged'].includes(status) && !batch.compliance_log_id;
}

function summarizeCounts(logs) {
  return {
    temperature: logs.temperature.length,
    ph: logs.ph.length,
    ccp: logs.ccp.length,
    sanitation: logs.sanitation.length,
    daily_checklists: logs.dailyChecklists.length,
    corrective_actions: logs.correctiveActions.length,
    batch_compliance_logs: logs.batchComplianceLogs.length,
    unified_logs: logs.complianceLogs.length,
    production_batches: logs.productionBatches.length,
  };
}

function summarizeIssues(logs) {
  const tempOutOfRange = logs.temperature.filter(log => log.within_range === false).length;
  const phOutOfRange = logs.ph.filter(log => log.within_range === false).length;
  const ccpFailed = logs.ccp.filter(log => statusOf(log.result) === 'fail').length;
  const sanitationIssues = logs.sanitation.filter(isSanitationIssue).length;
  const checklistIncomplete = logs.dailyChecklists.filter(isChecklistIncomplete).length;
  const correctiveOpen = logs.correctiveActions.filter(isOpenCorrectiveAction).length;
  const batchFailures = logs.batchComplianceLogs.filter(isFailedBatch).length;
  const batchMissingCompliance = logs.productionBatches.filter(isProductionBatchNeedingCompliance).length;

  return {
    temp_out_of_range: tempOutOfRange,
    ph_out_of_range: phOutOfRange,
    ccp_failed: ccpFailed,
    sanitation_issues: sanitationIssues,
    incomplete_checklists: checklistIncomplete,
    open_corrective_actions: correctiveOpen,
    failed_batch_logs: batchFailures,
    batches_missing_compliance_log: batchMissingCompliance,
    total_attention_items: tempOutOfRange + phOutOfRange + ccpFailed + sanitationIssues + checklistIncomplete + correctiveOpen + batchFailures + batchMissingCompliance,
  };
}

function latestByDateTime(items, dateField, timeField) {
  return [...items].sort((a, b) => {
    const aKey = `${a?.[dateField] || ''} ${a?.[timeField] || ''} ${a?.updated_date || ''}`;
    const bKey = `${b?.[dateField] || ''} ${b?.[timeField] || ''} ${b?.updated_date || ''}`;
    return bKey.localeCompare(aKey);
  });
}

function safeLogSummary(log, type) {
  const date = log.log_date || log.checklist_date || log.date || null;
  const status = log.status || log.overall_status || log.passed_failed || log.result || (log.within_range === false ? 'out_of_range' : 'ok');

  return {
    id: log.id || null,
    type,
    date,
    time: log.log_time || null,
    status: sanitizeText(status, 80) || null,
    staff_member: sanitizeText(log.staff_member, 100) || null,
    batch_id: sanitizeText(log.batch_id, 120) || null,
    product_name: sanitizeText(log.product_name || log.juice_flavor, 120) || null,
    location: sanitizeText(log.location || log.area || log.ccp_point, 120) || null,
    value: log.temperature ?? log.ph_value ?? log.pH_result ?? log.measurement ?? null,
    within_range: typeof log.within_range === 'boolean' ? log.within_range : null,
    updated_date: log.updated_date || null,
  };
}

function safeProductionBatchSummary(batch) {
  return {
    id: batch.id || null,
    batch_id: sanitizeText(batch.batch_id, 120) || null,
    product_name: sanitizeText(batch.product_name, 120) || null,
    production_date: batch.production_date || null,
    status: sanitizeText(batch.status, 80) || null,
    compliance_log_id_present: Boolean(batch.compliance_log_id),
    corrective_action_required: batch.corrective_action_required === true,
    corrective_action_log_id_present: Boolean(batch.corrective_action_log_id),
    is_locked: batch.is_locked === true,
  };
}

async function safeEntityList(base44, entityName, sort, limit) {
  try {
    const entity = base44?.asServiceRole?.entities?.[entityName];
    if (!entity || typeof entity.list !== 'function') {
      console.warn(`[COMPLIANCE-OPS-SUMMARY] Optional entity unavailable: ${entityName}`);
      return [];
    }

    const rows = await entity.list(sort, limit);
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    console.warn(`[COMPLIANCE-OPS-SUMMARY] Optional entity read failed: ${entityName}: ${error?.message || 'unknown_error'}`);
    return [];
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
      dateTo = today;
      dateFrom = addDays(today, -DEFAULT_RANGE_DAYS_BACK);
    } else if (dateFrom && !dateTo) {
      dateTo = addDays(dateFrom, DEFAULT_RANGE_DAYS_BACK);
    } else if (!dateFrom && dateTo) {
      dateFrom = addDays(dateTo, -DEFAULT_RANGE_DAYS_BACK);
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
    const [
      temperatureAll,
      phAll,
      ccpAll,
      sanitationAll,
      dailyChecklistAll,
      correctiveAll,
      batchComplianceAll,
      complianceAll,
      productionBatchAll,
    ] = await Promise.all([
      safeEntityList(base44, 'TemperatureLog', '-log_date', QUERY_LIMIT),
      safeEntityList(base44, 'pHLog', '-log_date', QUERY_LIMIT),
      safeEntityList(base44, 'CCPLog', '-log_date', QUERY_LIMIT),
      safeEntityList(base44, 'SanitationLog', '-log_date', QUERY_LIMIT),
      safeEntityList(base44, 'DailyChecklist', '-checklist_date', QUERY_LIMIT),
      safeEntityList(base44, 'CorrectiveActionLog', '-log_date', QUERY_LIMIT),
      safeEntityList(base44, 'BatchComplianceLog', '-date', QUERY_LIMIT),
      safeEntityList(base44, 'ComplianceLog', '-log_date', QUERY_LIMIT),
      safeEntityList(base44, 'ProductionBatch', '-production_date', QUERY_LIMIT),
    ]);

    const logs = {
      temperature: (temperatureAll || []).filter(log => inRange(log, 'log_date', dateFrom, dateTo)),
      ph: (phAll || []).filter(log => inRange(log, 'log_date', dateFrom, dateTo)),
      ccp: (ccpAll || []).filter(log => inRange(log, 'log_date', dateFrom, dateTo)),
      sanitation: (sanitationAll || []).filter(log => inRange(log, 'log_date', dateFrom, dateTo)),
      dailyChecklists: (dailyChecklistAll || []).filter(log => inRange(log, 'checklist_date', dateFrom, dateTo)),
      correctiveActions: (correctiveAll || []).filter(log => inRange(log, 'log_date', dateFrom, dateTo)),
      batchComplianceLogs: (batchComplianceAll || []).filter(log => inRange(log, 'date', dateFrom, dateTo)),
      complianceLogs: (complianceAll || []).filter(log => inRange(log, 'log_date', dateFrom, dateTo)),
      productionBatches: (productionBatchAll || []).filter(log => inRange(log, 'production_date', dateFrom, dateTo)),
    };

    const recentLogs = [
      ...latestByDateTime(logs.temperature, 'log_date', 'log_time').slice(0, 8).map(log => safeLogSummary(log, 'temperature')),
      ...latestByDateTime(logs.ph, 'log_date', 'log_time').slice(0, 8).map(log => safeLogSummary(log, 'pH')),
      ...latestByDateTime(logs.ccp, 'log_date', 'log_time').slice(0, 8).map(log => safeLogSummary(log, 'CCP')),
      ...latestByDateTime(logs.sanitation, 'log_date', 'log_time').slice(0, 8).map(log => safeLogSummary(log, 'sanitation')),
      ...latestByDateTime(logs.correctiveActions, 'log_date', 'log_time').slice(0, 8).map(log => safeLogSummary(log, 'corrective_action')),
    ]
      .sort((a, b) => `${b.date || ''} ${b.time || ''}`.localeCompare(`${a.date || ''} ${a.time || ''}`))
      .slice(0, MAX_ITEMS);

    const attentionBatches = logs.productionBatches
      .filter(batch => isProductionBatchNeedingCompliance(batch) || batch.corrective_action_required === true)
      .map(safeProductionBatchSummary)
      .slice(0, MAX_ITEMS);

    const batchCompliance = latestByDateTime(logs.batchComplianceLogs, 'date', 'updated_date')
      .slice(0, MAX_ITEMS)
      .map(log => safeLogSummary(log, 'batch_compliance'));

    const summary = summarizeCounts(logs);
    const issues = summarizeIssues(logs);

    console.log(`[COMPLIANCE-OPS-SUMMARY] date_from=${dateFrom} date_to=${dateTo} attention=${issues.total_attention_items}`);

    return Response.json({
      success: true,
      dry_run: true,
      read_only: true,
      date_from: dateFrom,
      date_to: dateTo,
      generated_at: new Date().toISOString(),
      summary,
      issues,
      recent_logs: recentLogs,
      batch_compliance,
      attention_batches: attentionBatches,
      warnings: [],
    });
  } catch (error) {
    console.error('[COMPLIANCE-OPS-SUMMARY] Error:', error.message);
    return Response.json({ error: 'Unable to load compliance ops summary' }, { status: 500 });
  }
});
