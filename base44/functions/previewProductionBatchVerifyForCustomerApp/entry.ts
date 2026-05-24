import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_TEXT_LENGTH = 120;
const SAFE_SUMMARY_LIMIT = 10;

const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'batch_id',
  'expected_status',
  'request_id',
]);

const PROJECTED_WRITES = [
  'ProductionBatch.status',
  'ProductionBatch.production_status',
  'ProductionBatch.verified_by',
  'ProductionBatch.verified_at',
  'ProductionBatch.is_locked',
  'ProductionBatch.compliance_log_id',
  'ProductionBatch.audit_trail',
  'BatchComplianceLog',
  'HubCommandLog',
];

const DEFERRED_CASCADE_WRITES = [
  'FulfillmentTask.status',
  'FulfillmentTask.production_date',
  'ShopifyOrder.production_status',
  'CCPLog',
  'CorrectiveActionLog',
  'SanitationLog',
];

const COMPLIANCE_FINALIZATION_FIELDS = [
  'compliance_log_id',
  'ccp_log_id',
  'corrective_action_log_id',
  'sanitation_log_id',
  'verified_by',
  'verified_at',
];

const REQUIRED_COMPLETION_FIELDS = [
  'production_date',
  'batch_id',
  'product_name',
  'actual_start_time',
  'actual_end_time',
  'completed_by',
];

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
  'actual_end_time',
  'actualendtime',
  'actual_start_time',
  'actualstarttime',
  'actual_units',
  'actualunits',
  'audit_trail',
  'audittrail',
  'batch_id',
  'batchid',
  'completed_by',
  'completedby',
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
  'planned_units',
  'plannedunits',
  'product_category',
  'productcategory',
  'product_name',
  'productname',
  'production_date',
  'productiondate',
  'production_status',
  'productionstatus',
  'source_type',
  'sourcetype',
  'source_item',
  'sourceitem',
  'status',
  'unit',
  'units',
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

function resolveBatchQuantity(batch) {
  const candidates = [
    batch?.actual_quantity_produced,
    batch?.actual_units,
    batch?.actual_quantity,
    batch?.completed_quantity,
    batch?.quantity,
    batch?.final_usable_quantity,
  ];
  for (const value of candidates) {
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

function hasComplianceFinalization(batch) {
  return COMPLIANCE_FINALIZATION_FIELDS.some((field) => hasMeaningfulFieldValue(batch?.[field]));
}

function hasOperationalLinkageRisk(batch) {
  const shallow = { ...batch };
  delete shallow.order_sources;
  delete shallow.related_orders;
  delete shallow.audit_trail;
  return findUnsafeFieldKeys(shallow, OPERATIONAL_LINKAGE_KEY_TERMS, SAFE_OPERATIONAL_KEYS).length > 0;
}

function hasProofDropRisk(batch) {
  return findUnsafeFieldKeys(batch, PROOF_DROP_KEY_TERMS, SAFE_OPERATIONAL_KEYS).length > 0;
}

function hasProviderPaymentRisk(batch) {
  const shallow = { ...batch };
  delete shallow.order_sources;
  delete shallow.audit_trail;
  return findUnsafeFieldKeys(shallow, PROVIDER_PAYMENT_KEY_TERMS, SAFE_OPERATIONAL_KEYS).length > 0 ||
    findUnsafeFieldKeys(batch?.order_sources || [], PROVIDER_PAYMENT_KEY_TERMS, SAFE_OPERATIONAL_KEYS).length > 0;
}

function hasSecretAuthRisk(batch) {
  return findUnsafeFieldKeys(batch, SECRET_AUTH_KEY_TERMS, SAFE_OPERATIONAL_KEYS).length > 0;
}

function hasUnsafeCustomerContext(batch) {
  const shallow = { ...batch };
  delete shallow.order_sources;
  delete shallow.audit_trail;
  return findUnsafeFieldKeys(shallow, UNSAFE_CUSTOMER_CONTEXT_KEY_TERMS, SAFE_OPERATIONAL_KEYS).length > 0 ||
    findUnsafeFieldKeys(batch?.order_sources || [], UNSAFE_CUSTOMER_CONTEXT_KEY_TERMS, SAFE_OPERATIONAL_KEYS).length > 0;
}

function hasRecalculationRisk(batch) {
  return findUnsafeFieldKeys(batch, RECALCULATION_KEY_TERMS, SAFE_OPERATIONAL_KEYS).length > 0;
}

function hasPriorVerificationConflict(batch) {
  if (hasMeaningfulFieldValue(batch?.verified_at)) return true;
  if (hasMeaningfulFieldValue(batch?.verified_by)) return true;
  if (hasMeaningfulFieldValue(batch?.compliance_log_id)) return true;
  return (Array.isArray(batch?.audit_trail) ? batch.audit_trail : []).some((entry) => {
    const action = normalizeLower(entry?.action);
    return action.includes('verified') || action.includes('compliance') || action.includes('logged');
  });
}

function hasManualSources(orderSources) {
  return (Array.isArray(orderSources) ? orderSources : [])
    .some((source) => normalizeLower(source?.source_type) === 'manual_internal_batch');
}

function completionFieldPresence(batch) {
  const resolvedQuantity = resolveBatchQuantity(batch);
  return {
    required_completion_fields_present: REQUIRED_COMPLETION_FIELDS.every((field) => hasMeaningfulFieldValue(batch?.[field])),
    actual_start_time_present: hasMeaningfulFieldValue(batch?.actual_start_time),
    actual_end_time_present: hasMeaningfulFieldValue(batch?.actual_end_time),
    completed_by_present: hasMeaningfulFieldValue(batch?.completed_by),
    quantity_present: resolvedQuantity !== null,
    staff_on_duty_count: Array.isArray(batch?.staff_on_duty) ? batch.staff_on_duty.length : 0,
    ph_result_present: hasMeaningfulFieldValue(batch?.pH_result),
    ph_status_present: hasMeaningfulFieldValue(batch?.pH_passed_failed),
    batch_pass_fail_present: hasMeaningfulFieldValue(batch?.passed_failed),
  };
}

function validateVerificationReadiness(batch, blockers, warnings) {
  const fields = completionFieldPresence(batch);
  if (!fields.required_completion_fields_present) blockers.push('missing_required_completion_fields');
  if (!fields.quantity_present) blockers.push('missing_quantity');
  if (fields.staff_on_duty_count < 1) blockers.push('missing_staff_on_duty');
  if (!fields.ph_result_present || !fields.ph_status_present || !fields.batch_pass_fail_present) {
    blockers.push('missing_qc_fields');
  }

  const phResult = Number(batch?.pH_result);
  if (Number.isFinite(phResult) && phResult >= 4.6) blockers.push('ph_result_out_of_range');
  if (normalizeLower(batch?.pH_passed_failed) && normalizeLower(batch?.pH_passed_failed) !== 'passed') {
    blockers.push('ph_status_not_passed');
  }
  if (normalizeLower(batch?.passed_failed) && normalizeLower(batch?.passed_failed) !== 'passed') {
    blockers.push('batch_status_not_passed');
  }
  if (batch?.ccp_check_complete === true) warnings.push('ccp_log_deferred_to_separate_command');
  if (batch?.corrective_action_required === true) warnings.push('corrective_action_log_deferred_to_separate_command');
  if (batch?.sanitation_verification_complete === true) warnings.push('sanitation_log_deferred_to_separate_command');
}

async function readCascadePreview(base44, batch, orderSources) {
  const sourceOrderIds = (Array.isArray(orderSources) ? orderSources : [])
    .map((source) => normalizeSingleLine(source?.order_id))
    .filter(Boolean);
  const relatedOrderIds = (Array.isArray(batch?.related_orders) ? batch.related_orders : [])
    .map((orderId) => normalizeSingleLine(orderId))
    .filter(Boolean);
  const orderIds = [...new Set([...sourceOrderIds, ...relatedOrderIds])];

  let linkedTaskCount = 0;
  let packableTaskCount = 0;
  let broadDateTaskMatch = false;

  const productionDate = normalizeSingleLine(batch?.production_date);
  if (productionDate) {
    try {
      const deliveryDate = new Date(productionDate);
      deliveryDate.setDate(deliveryDate.getDate() + 1);
      const deliveryDateStr = Number.isNaN(deliveryDate.getTime()) ? '' : deliveryDate.toISOString().split('T')[0];
      const [tasksByProdDate, tasksBySchedDate] = await Promise.all([
        base44.asServiceRole.entities.FulfillmentTask.filter({ production_date: productionDate }).catch(() => []),
        deliveryDateStr
          ? base44.asServiceRole.entities.FulfillmentTask.filter({ scheduled_date: deliveryDateStr }).catch(() => [])
          : Promise.resolve([]),
      ]);
      const tasksById = {};
      for (const task of [...tasksByProdDate, ...tasksBySchedDate]) {
        if (task?.id) tasksById[task.id] = task;
      }
      const tasks = Object.values(tasksById);
      linkedTaskCount = tasks.filter((task) => orderIds.length === 0 || orderIds.includes(normalizeSingleLine(task?.order_id))).length;
      packableTaskCount = tasks.filter((task) =>
        ['Unassigned', 'Scheduled'].includes(normalizeSingleLine(task?.status)) &&
        (orderIds.length === 0 || orderIds.includes(normalizeSingleLine(task?.order_id)))
      ).length;
      broadDateTaskMatch = orderIds.length === 0 && packableTaskCount > 0;
    } catch {
      return {
        linked_task_count: 0,
        packable_task_count: 0,
        linked_order_count: orderIds.length,
        broad_date_task_match: false,
        cascade_preview_error: true,
      };
    }
  }

  return {
    linked_task_count: linkedTaskCount,
    packable_task_count: packableTaskCount,
    linked_order_count: orderIds.length,
    broad_date_task_match: broadDateTaskMatch,
    cascade_preview_error: false,
  };
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
    const fieldPresence = completionFieldPresence(batch);
    const cascadePreview = await readCascadePreview(base44, batch, orderSources);

    if (requestBatchId && requestBatchId !== normalizeSingleLine(batch.batch_id)) blockers.push('batch_id_mismatch');
    if (expectedStatus && expectedStatus !== currentStatus) blockers.push('expected_status_mismatch');
    if (currentStatus !== 'completed_pending_verification') blockers.push('invalid_status_transition');
    if (['verified_logged', 'archived', 'completed'].includes(currentStatus)) blockers.push('terminal_status_blocked');
    if (batch.is_locked === true) blockers.push('batch_locked');
    if (hasComplianceFinalization(batch)) blockers.push('compliance_finalization_present');
    if (hasPriorVerificationConflict(batch)) blockers.push('prior_verification_conflict');
    if (hasManualSources(orderSources)) blockers.push('manual_sources_out_of_scope');
    if (hasOperationalLinkageRisk(batch)) blockers.push('operational_linkage_blocked');
    if (hasProofDropRisk(batch)) blockers.push('proof_drop_out_of_scope');
    if (hasProviderPaymentRisk(batch)) blockers.push('provider_payment_fields_present');
    if (hasSecretAuthRisk(batch)) blockers.push('secret_or_auth_field_present');
    if (hasUnsafeCustomerContext(batch)) blockers.push('unsafe_customer_context_present');
    if (hasRecalculationRisk(batch)) blockers.push('recalculation_risk');
    validateVerificationReadiness(batch, blockers, warnings);

    if (cascadePreview.broad_date_task_match) warnings.push('broad_date_task_cascade_risk');
    if (cascadePreview.packable_task_count > 0) warnings.push('fulfillment_task_cascade_deferred');
    if (cascadePreview.linked_order_count > 0) warnings.push('shopify_order_bottled_cascade_deferred');
    if (cascadePreview.cascade_preview_error) warnings.push('cascade_preview_unavailable');

    const uniqueBlockers = [...new Set(blockers)];
    const uniqueWarnings = [...new Set(warnings.filter(Boolean))];

    return Response.json({
      success: true,
      dry_run: true,
      production_batch_id: productionBatchId,
      batch_id: sanitizeText(batch.batch_id, 180) || null,
      current_status: sanitizeText(currentStatus, 80) || null,
      eligible_status: currentStatus === 'completed_pending_verification',
      is_locked: batch.is_locked === true,
      actual_start_time_present: fieldPresence.actual_start_time_present,
      actual_end_time_present: fieldPresence.actual_end_time_present,
      completed_by_present: fieldPresence.completed_by_present,
      quantity_present: fieldPresence.quantity_present,
      staff_on_duty_count: fieldPresence.staff_on_duty_count,
      ph_result_present: fieldPresence.ph_result_present,
      ph_status_present: fieldPresence.ph_status_present,
      batch_pass_fail_present: fieldPresence.batch_pass_fail_present,
      pH_passed_failed: sanitizeText(batch.pH_passed_failed, 40) || null,
      passed_failed: sanitizeText(batch.passed_failed, 40) || null,
      ccp_check_complete: batch.ccp_check_complete === true,
      corrective_action_required: batch.corrective_action_required === true,
      sanitation_verification_complete: batch.sanitation_verification_complete === true,
      compliance_finalization_present: hasComplianceFinalization(batch),
      existing_log_ids_present: {
        compliance_log_id: hasMeaningfulFieldValue(batch.compliance_log_id),
        ccp_log_id: hasMeaningfulFieldValue(batch.ccp_log_id),
        corrective_action_log_id: hasMeaningfulFieldValue(batch.corrective_action_log_id),
        sanitation_log_id: hasMeaningfulFieldValue(batch.sanitation_log_id),
      },
      order_sources_count: orderSources.length,
      order_source_type_counts: orderSourceTypeCounts(orderSources),
      customer_context_present: orderSources.some((source) =>
        hasMeaningfulFieldValue(source?.customer_name) || hasMeaningfulFieldValue(source?.customer_email)
      ),
      customer_context_allowed_for_preview: true,
      order_sources_preview_allowed: true,
      safe_order_source_summaries: safeOrderSourceSummaries(orderSources),
      linked_order_count: cascadePreview.linked_order_count,
      linked_task_count: cascadePreview.linked_task_count,
      packable_task_count: cascadePreview.packable_task_count,
      broad_date_task_match: cascadePreview.broad_date_task_match,
      inventory_po_linkage_present: hasOperationalLinkageRisk(batch),
      proof_drop_present: hasProofDropRisk(batch),
      provider_payment_linkage_present: hasProviderPaymentRisk(batch),
      recalculation_risk: hasRecalculationRisk(batch),
      projected_writes: PROJECTED_WRITES,
      deferred_cascade_writes: DEFERRED_CASCADE_WRITES,
      live_allowed: uniqueBlockers.length === 0,
      blockers: uniqueBlockers,
      warnings: uniqueWarnings,
      ...(requestId ? { request_id: requestId } : {}),
    });
  } catch {
    console.error('[previewProductionBatchVerifyForCustomerApp] Error');
    return Response.json(safeError('Unable to preview Hub production batch verification', 'internal_error'), { status: 500 });
  }
});
