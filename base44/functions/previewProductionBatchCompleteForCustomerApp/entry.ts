import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_TEXT_LENGTH = 120;
const SAFE_SUMMARY_LIMIT = 10;

const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'batch_id',
  'expected_status',
  'request_id',
  'actual_units',
  'actual_quantity_produced',
  'bottles_produced',
  'bottles_rejected_or_wasted',
  'final_usable_quantity',
  'storage_location',
  'use_by_date',
  'pH_result',
  'pH_passed_failed',
  'pH_meter_id',
  'ph_result',
  'ph_passed_failed',
  'ph_meter_id',
  'calibration_checked',
  'ccp_check_complete',
  'sanitation_verification_complete',
  'labels_applied',
  'passed_failed',
  'notes',
]);

const PROJECTED_WRITES = [
  'ProductionBatch.status',
  'ProductionBatch.actual_end_time',
  'ProductionBatch.completed_by',
  'ProductionBatch.actual_units',
  'ProductionBatch.completion_qc_fields',
  'ProductionBatch.audit_trail',
  'HubCommandLog',
];

const COMPLIANCE_FINALIZATION_FIELDS = [
  'compliance_log_id',
  'ccp_log_id',
  'corrective_action_log_id',
  'sanitation_log_id',
  'verified_by',
  'verified_at',
];

const MANUAL_SOURCE_TYPES = new Set(['manual_internal_batch']);

const PROVIDER_PAYMENT_KEY_TERMS = [
  'stripe',
  'shopify',
  'payment_intent',
  'checkout_session',
  'session_id',
  'subscription_id',
  'provider',
  'external_id',
  'gateway',
  'transaction',
  'charge',
  'invoice',
  'payment_method',
  'processor',
  'fulfillment_provider',
  'payment',
];

const PROOF_DROP_KEY_TERMS = [
  'proof',
  'photo',
  'image',
  'file',
  'attachment',
  'upload',
  'drop',
  'dropoff',
  'drop_location',
  'delivery_photo',
  'delivery_proof',
];

const OPERATIONAL_LINKAGE_KEY_TERMS = [
  'fulfillment_task',
  'task_id',
  'task_ids',
  'linked_task',
  'purchase_order',
  'inventory',
  'stock',
  'supplier',
  'po_id',
  'batch_order',
  'review_queue',
  'customer_app_order',
];

const RECALCULATION_KEY_TERMS = [
  'recalc',
  'recalculate',
  'recalculation',
  'stale',
  'needs_recalc',
  'demand_pending',
  'pending_recalc',
];

const SECRET_AUTH_KEY_TERMS = [
  'secret',
  'token',
  'api_key',
  'apikey',
  'auth',
  'authorization',
  'bearer',
  'credential',
  'password',
  'private_key',
  'access_key',
  'refresh_token',
  'session_token',
  'webhook_secret',
];

const UNSAFE_CUSTOMER_CONTEXT_KEY_TERMS = [
  'phone',
  'address',
  'shipping',
  'billing',
  'street',
  'city',
  'state',
  'zip',
  'postal',
  'lat',
  'lng',
  'longitude',
  'latitude',
  'geo',
  'raw_payload',
  'payload',
  'raw_order',
  'order_payload',
  'customer_payload',
  'provider_payload',
];

const SAFE_OPERATIONAL_KEYS = new Set([
  'batch_id',
  'batchid',
  'order_sources',
  'ordersources',
  'order_id',
  'orderid',
  'order_number',
  'ordernumber',
  'customer_name',
  'customername',
  'customer_email',
  'customeremail',
  'source_type',
  'sourcetype',
  'source_item',
  'sourceitem',
  'quantity',
]);

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeSingleLine(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function normalizeLower(value) {
  return normalizeSingleLine(value).toLowerCase();
}

function sanitizeText(value, maxLength = MAX_TEXT_LENGTH) {
  const text = normalizeSingleLine(value)
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl)\b/gi, '[redacted address]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]');

  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function normalizeFieldKey(key) {
  const snake = (key ?? '').toString().trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
  return {
    snake,
    compact: snake.replace(/[^a-z0-9]/g, ''),
  };
}

function fieldKeyMatchesTerms(key, terms) {
  const normalized = normalizeFieldKey(key);
  return terms.some((term) => {
    const normalizedTerm = normalizeFieldKey(term);
    return normalized.snake.includes(normalizedTerm.snake) ||
      normalized.compact.includes(normalizedTerm.compact);
  });
}

function hasMeaningfulFieldValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return Boolean(normalizeSingleLine(value));
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

function findUnsafeFieldKeys(source, terms, safeKeys = new Set(), depth = 0) {
  if (!source || typeof source !== 'object') return [];
  if (Array.isArray(source)) {
    return source.flatMap((item) => findUnsafeFieldKeys(item, terms, safeKeys, depth));
  }

  return Object.entries(source).reduce((keys, [key, value]) => {
    if (!hasMeaningfulFieldValue(value)) return keys;
    const normalized = normalizeFieldKey(key);
    if (safeKeys.has(normalized.snake) || safeKeys.has(normalized.compact)) return keys;
    if (fieldKeyMatchesTerms(key, terms)) keys.push(normalized.snake || 'unknown_field');
    if (typeof value === 'object' && depth < 2) {
      keys.push(...findUnsafeFieldKeys(value, terms, safeKeys, depth + 1));
    }
    return keys;
  }, []);
}

function findUnsupportedBodyKey(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const key of Object.keys(body)) {
    const normalized = normalizeLower(key);
    if (!ALLOWED_BODY_KEYS.has(normalized)) return key;
  }
  return null;
}

function normalizeId(value, fieldName, required = true) {
  const text = normalizeSingleLine(value);
  if (!text) {
    if (required) throw new Error(`${fieldName} is required`);
    return '';
  }
  if (text.length > 180 || !/^[A-Za-z0-9._:@/-]+$/.test(text)) {
    throw new Error(`${fieldName} contains unsupported characters`);
  }
  return text;
}

function normalizeOptionalStatus(value) {
  const status = normalizeSingleLine(value);
  if (!status) return '';
  if (status.length > 80 || !/^[A-Za-z0-9._ -]+$/.test(status)) {
    throw new Error('expected_status contains unsupported characters');
  }
  return status;
}

function readNumber(value, fieldName, { required = false, positive = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new Error(`${fieldName} is required`);
    return null;
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) throw new Error(`${fieldName} must be a number`);
  if (positive && numberValue <= 0) throw new Error(`${fieldName} must be greater than 0`);
  if (!positive && numberValue < 0) throw new Error(`${fieldName} must be greater than or equal to 0`);
  return numberValue;
}

function readIsoDate(value, fieldName) {
  const text = normalizeSingleLine(value);
  if (!text) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${fieldName} must be YYYY-MM-DD`);
  return text;
}

function readPassedFailed(value, fieldName, required = true) {
  const text = normalizeLower(value);
  if (!text) {
    if (required) throw new Error(`${fieldName} is required`);
    return '';
  }
  if (!['passed', 'failed'].includes(text)) throw new Error(`${fieldName} must be passed or failed`);
  return text;
}

function count(value) {
  return Array.isArray(value) ? value.length : 0;
}

function orderSourceTypeCounts(orderSources) {
  return (Array.isArray(orderSources) ? orderSources : []).reduce((counts, source) => {
    const type = sanitizeText(source?.source_type || 'unknown', 80) || 'unknown';
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});
}

function safeOrderSourceSummaries(orderSources) {
  if (!Array.isArray(orderSources)) return [];
  return orderSources.slice(0, SAFE_SUMMARY_LIMIT).map((source) => {
    const summary = {};
    const sourceType = sanitizeText(source?.source_type, 80);
    const orderNumber = sanitizeText(source?.order_number, 80);
    const customerName = sanitizeText(source?.customer_name, 100);
    const customerEmail = sanitizeText(source?.customer_email, 120);
    if (sourceType) summary.source_type = sourceType;
    if (orderNumber) summary.order_number = orderNumber;
    if (customerName) summary.customer_name = customerName;
    if (customerEmail) summary.customer_email = customerEmail;
    return Object.keys(summary).length ? summary : null;
  }).filter(Boolean);
}

function hasComplianceFinalization(batch) {
  return COMPLIANCE_FINALIZATION_FIELDS.some((field) => hasMeaningfulFieldValue(batch?.[field]));
}

function manualSourceCount(orderSources) {
  return (Array.isArray(orderSources) ? orderSources : [])
    .filter((source) => MANUAL_SOURCE_TYPES.has(normalizeLower(source?.source_type))).length;
}

function hasOperationalLinkageRisk(batch) {
  const shallow = { ...batch };
  delete shallow.order_sources;
  delete shallow.audit_trail;
  return findUnsafeFieldKeys(shallow, OPERATIONAL_LINKAGE_KEY_TERMS, SAFE_OPERATIONAL_KEYS).length > 0 ||
    hasMeaningfulFieldValue(batch?.related_orders);
}

function hasProofDropRisk(batch) {
  return findUnsafeFieldKeys(batch, PROOF_DROP_KEY_TERMS).length > 0;
}

function hasProviderPaymentRisk(batch) {
  const shallow = { ...batch };
  delete shallow.order_sources;
  delete shallow.audit_trail;
  return findUnsafeFieldKeys(shallow, PROVIDER_PAYMENT_KEY_TERMS).length > 0 ||
    findUnsafeFieldKeys(batch?.order_sources || [], PROVIDER_PAYMENT_KEY_TERMS, SAFE_OPERATIONAL_KEYS).length > 0;
}

function hasSecretAuthRisk(batch) {
  return findUnsafeFieldKeys(batch, SECRET_AUTH_KEY_TERMS).length > 0;
}

function hasUnsafeCustomerContext(batch) {
  const shallow = { ...batch };
  delete shallow.order_sources;
  delete shallow.audit_trail;
  return findUnsafeFieldKeys(shallow, UNSAFE_CUSTOMER_CONTEXT_KEY_TERMS).length > 0 ||
    findUnsafeFieldKeys(batch?.order_sources || [], UNSAFE_CUSTOMER_CONTEXT_KEY_TERMS).length > 0;
}

function hasRecalculationRisk(batch) {
  return findUnsafeFieldKeys(batch, RECALCULATION_KEY_TERMS).length > 0;
}

function priorLifecycleConflict(batch) {
  if (hasMeaningfulFieldValue(batch?.actual_end_time)) return true;
  if (hasMeaningfulFieldValue(batch?.completed_by)) return true;
  return (Array.isArray(batch?.audit_trail) ? batch.audit_trail : []).some((entry) => {
    const action = normalizeLower(entry?.action);
    return action.includes('completed') || action.includes('verified') || action.includes('logged');
  });
}

function validateCompletionInputs(body, blockers, warnings) {
  try {
    const actualUnits = readNumber(body.actual_units ?? body.actual_quantity_produced, 'actual_units', {
      required: true,
      positive: true,
    });
    const pHResult = readNumber(body.pH_result ?? body.ph_result, 'pH_result', {
      required: true,
      positive: true,
    });
    const pHStatus = readPassedFailed(body.pH_passed_failed ?? body.ph_passed_failed, 'pH_passed_failed');
    const batchStatus = readPassedFailed(body.passed_failed, 'passed_failed');
    readNumber(body.bottles_produced, 'bottles_produced', { positive: true });
    readNumber(body.bottles_rejected_or_wasted, 'bottles_rejected_or_wasted');
    readNumber(body.final_usable_quantity, 'final_usable_quantity', { positive: true });
    readIsoDate(body.use_by_date, 'use_by_date');

    if (pHResult >= 4.6) blockers.push('ph_result_out_of_range');
    if (pHStatus !== 'passed') blockers.push('ph_status_not_passed');
    if (batchStatus !== 'passed') blockers.push('batch_status_not_passed');
    if (actualUnits > 0) warnings.push('completion_quantities_present_for_preview');
  } catch (error) {
    blockers.push('invalid_completion_input');
    warnings.push(sanitizeText(error.message, 120));
  }
}

function safeError(error, errorCode, message = error) {
  return {
    error: sanitizeText(error, 160),
    error_code: sanitizeText(errorCode, 80),
    message: sanitizeText(message, 180),
  };
}

Deno.serve(async (req) => {
  try {
    if (!SYNC_SECRET) {
      return Response.json(safeError('Unauthorized', 'unauthorized'), { status: 401 });
    }

    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ') || authHeader !== `Bearer ${SYNC_SECRET}`) {
      return Response.json(safeError('Unauthorized', 'unauthorized'), { status: 401 });
    }

    if (req.method !== 'POST') {
      return Response.json(safeError('Method not allowed', 'method_not_allowed'), { status: 405 });
    }

    const body = await req.json().catch(() => ({}));
    const unsupportedKey = findUnsupportedBodyKey(body);
    if (unsupportedKey) {
      return Response.json({
        ...safeError(`Unsupported field: ${unsupportedKey}`, 'unsupported_field'),
      }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    let productionBatchId;
    let requestBatchId;
    let expectedStatus;
    let requestId;

    try {
      productionBatchId = normalizeId(body.production_batch_id, 'production_batch_id');
      requestBatchId = normalizeId(body.batch_id, 'batch_id', false);
      expectedStatus = normalizeOptionalStatus(body.expected_status);
      requestId = normalizeId(body.request_id, 'request_id', false);
    } catch (error) {
      return Response.json(safeError(error.message, 'invalid_input'), { status: 400 });
    }

    const matches = await base44.asServiceRole.entities.ProductionBatch.filter(
      { id: productionBatchId },
      '-updated_date',
      1,
    );
    const batch = matches?.[0] || null;
    if (!batch) {
      return Response.json({
        success: true,
        dry_run: true,
        production_batch_id: productionBatchId,
        batch_id: requestBatchId || null,
        current_status: null,
        live_allowed: false,
        blockers: ['batch_not_found'],
        warnings: [],
      });
    }

    const blockers = [];
    const warnings = [];
    const currentStatus = normalizeSingleLine(batch.status);
    const orderSources = Array.isArray(batch.order_sources) ? batch.order_sources : [];

    if (requestBatchId && requestBatchId !== normalizeSingleLine(batch.batch_id)) blockers.push('batch_id_mismatch');
    if (expectedStatus && expectedStatus !== currentStatus) blockers.push('expected_status_mismatch');
    if (currentStatus !== 'in_production') blockers.push('invalid_status_transition');
    if (!normalizeSingleLine(batch.actual_start_time)) blockers.push('incoherent_batch_state');
    if (batch.is_locked === true) blockers.push('batch_locked');
    if (['completed_pending_verification', 'verified_logged', 'archived', 'completed'].includes(currentStatus)) {
      blockers.push('terminal_status_blocked');
    }
    if (hasComplianceFinalization(batch)) blockers.push('compliance_finalization_present');
    if (manualSourceCount(orderSources) > 0) blockers.push('manual_sources_out_of_scope');
    if (hasOperationalLinkageRisk(batch)) blockers.push('operational_linkage_blocked');
    if (hasProofDropRisk(batch)) blockers.push('proof_drop_out_of_scope');
    if (hasProviderPaymentRisk(batch)) blockers.push('provider_payment_fields_present');
    if (hasSecretAuthRisk(batch)) blockers.push('secret_or_auth_field_present');
    if (hasUnsafeCustomerContext(batch)) blockers.push('unsafe_customer_context_present');
    if (hasRecalculationRisk(batch)) blockers.push('recalculation_risk');
    if (priorLifecycleConflict(batch)) blockers.push('prior_lifecycle_conflict');
    validateCompletionInputs(body, blockers, warnings);

    const uniqueBlockers = [...new Set(blockers)];
    const uniqueWarnings = [...new Set(warnings.filter(Boolean))];

    return Response.json({
      success: true,
      dry_run: true,
      production_batch_id: productionBatchId,
      batch_id: sanitizeText(batch.batch_id, 180) || null,
      current_status: sanitizeText(currentStatus, 80) || null,
      eligible_status: currentStatus === 'in_production',
      is_locked: batch.is_locked === true,
      actual_start_time_present: Boolean(normalizeSingleLine(batch.actual_start_time)),
      order_sources_count: orderSources.length,
      order_source_type_counts: orderSourceTypeCounts(orderSources),
      customer_context_present: orderSources.some((source) =>
        hasMeaningfulFieldValue(source?.customer_name) || hasMeaningfulFieldValue(source?.customer_email)
      ),
      customer_context_allowed_for_preview: true,
      order_sources_preview_allowed: true,
      safe_order_source_summaries: safeOrderSourceSummaries(orderSources),
      manual_source_count: manualSourceCount(orderSources),
      linked_order_count: count(batch.related_orders),
      compliance_finalization_present: hasComplianceFinalization(batch),
      inventory_po_linkage_present: hasOperationalLinkageRisk(batch),
      proof_drop_present: hasProofDropRisk(batch),
      provider_payment_linkage_present: hasProviderPaymentRisk(batch),
      recalculation_risk: hasRecalculationRisk(batch),
      prior_lifecycle_conflict: priorLifecycleConflict(batch),
      projected_writes: PROJECTED_WRITES,
      live_allowed: uniqueBlockers.length === 0,
      blockers: uniqueBlockers,
      warnings: uniqueWarnings,
      ...(requestId ? { request_id: requestId } : {}),
    });
  } catch {
    console.error('[previewProductionBatchCompleteForCustomerApp] Error');
    return Response.json(safeError('Unable to preview Hub production batch completion', 'internal_error'), { status: 500 });
  }
});
