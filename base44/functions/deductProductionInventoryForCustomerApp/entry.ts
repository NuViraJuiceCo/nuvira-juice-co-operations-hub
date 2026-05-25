import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const REAL_DEDUCTION_ENABLED = (Deno.env.get('ENABLE_REAL_PRODUCTION_INVENTORY_DEDUCTION') || '').trim().toLowerCase() === 'true';
const REAL_DEDUCTION_ALLOWED_EMAILS = Deno.env.get('REAL_PRODUCTION_INVENTORY_DEDUCTION_ALLOWED_EMAILS') || '';
const REAL_DEDUCTION_BATCH_ALLOWLIST = Deno.env.get('REAL_PRODUCTION_INVENTORY_DEDUCTION_BATCH_ALLOWLIST') || '';

const COMMAND = 'production_inventory_deduction';
const TARGET_TYPE = 'ProductionBatch';
const SOURCE = 'customer_app_admin';
const COMMAND_SOURCE = 'customer_app';
const FUNCTION_NAME = 'deductProductionInventoryForCustomerApp';
const MAX_TEXT_LENGTH = 160;
const MAX_INGREDIENT_ROWS = 50;
const INVENTORY_QUERY_LIMIT = 1000;
const OZ_PER_LB = 16;
const G_PER_OZ = 28.3495;

const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'batch_id',
  'expected_status',
  'request_id',
  'reason',
  'actor_email',
  'actor_role',
  'source',
]);

const SUPPORTED_UNITS = new Set([
  'lbs',
  'lb',
  'g',
  'kg',
  'l',
  'ml',
  'units',
  'unit',
  'cases',
  'case',
  'bottles',
  'bottle',
  'oz',
]);

const IDEMPOTENT_SUCCESS_STATUSES = new Set(['success', 'skipped']);

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeSingleLine(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function normalizeLower(value) {
  return normalizeSingleLine(value).toLowerCase();
}

function normalizeKey(value) {
  return normalizeLower(value)
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function singularizeIngredientKey(key) {
  const normalized = normalizeKey(key);
  if (!normalized) return '';
  return normalized
    .split(' ')
    .map((part) => {
      if (part.length > 3 && part.endsWith('ies')) return `${part.slice(0, -3)}y`;
      if (part.length > 3 && part.endsWith('s') && !part.endsWith('ss')) return part.slice(0, -1);
      return part;
    })
    .join(' ');
}

function genericIngredientFallbackKey(key) {
  const parts = singularizeIngredientKey(key).split(' ').filter(Boolean);
  if (parts.length < 2) return '';
  return parts[parts.length - 1];
}

function sanitizeText(value, maxLength = MAX_TEXT_LENGTH) {
  const text = normalizeSingleLine(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl)\b/gi, '[redacted address]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]');

  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegativeNumber(value) {
  const parsed = numberOrNull(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
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

function normalizeActorEmail(value) {
  const email = normalizeSingleLine(value).toLowerCase();
  if (!email) throw new Error('actor_email is required');
  if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('actor_email must be a valid email address');
  }
  return email;
}

function normalizeSource(value) {
  const source = normalizeLower(value);
  if (!source) throw new Error('source is required');
  if (source !== SOURCE) throw new Error('source must be customer_app_admin');
  return source;
}

function parseEmailAllowlist(raw) {
  return new Set((raw || '')
    .split(',')
    .map((email) => normalizeLower(email))
    .filter(Boolean));
}

function parseBatchAllowlist(raw) {
  return (raw || '')
    .split(',')
    .map((entry) => normalizeSingleLine(entry))
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(':');
      if (separator <= 0 || separator === entry.length - 1) return null;
      return {
        productionBatchId: entry.slice(0, separator).trim(),
        batchDisplayId: entry.slice(separator + 1).trim(),
      };
    })
    .filter(Boolean);
}

function isActorAllowed(actorEmail, actorRole) {
  if (normalizeLower(actorRole) !== 'admin') return false;
  return parseEmailAllowlist(REAL_DEDUCTION_ALLOWED_EMAILS).has(normalizeLower(actorEmail));
}

function isBatchAllowlisted(productionBatchId, batchDisplayId) {
  return parseBatchAllowlist(REAL_DEDUCTION_BATCH_ALLOWLIST).some((entry) => (
    entry.productionBatchId === productionBatchId &&
    entry.batchDisplayId === batchDisplayId
  ));
}

function findUnsupportedBodyKey(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const key of Object.keys(body)) {
    if (!ALLOWED_BODY_KEYS.has(normalizeLower(key))) return key;
  }
  return null;
}

function safeError(error, errorCode, message = error) {
  return {
    success: false,
    error: sanitizeText(error, 180),
    error_code: sanitizeText(errorCode, 80),
    message: sanitizeText(message, 220),
  };
}

function commandId(requestId, productionBatchId) {
  return `${COMMAND}:${TARGET_TYPE}:${productionBatchId}:${requestId}`;
}

function buildNotes({
  requestId,
  batchDisplayId,
  previousStatus,
  inventoryItemCount,
  deductionRowCount,
  lowStockWarningCount,
  source,
}) {
  return JSON.stringify({
    batch_id: sanitizeText(batchDisplayId, 160) || null,
    previous_status: sanitizeText(previousStatus, 80) || null,
    source: sanitizeText(source, 80) || SOURCE,
    request_id: sanitizeText(requestId, 160),
    deduction_type: 'production_ingredients_only',
    inventory_item_count: Number.isFinite(inventoryItemCount) ? inventoryItemCount : 0,
    deduction_row_count: Number.isFinite(deductionRowCount) ? deductionRowCount : 0,
    low_stock_warning_count: Number.isFinite(lowStockWarningCount) ? lowStockWarningCount : 0,
    purchase_order_changes_deferred: true,
    customer_app_sync_deferred: true,
    notifications_deferred: true,
  });
}

function parseNotesMetadata(notes) {
  try {
    const parsed = JSON.parse(normalizeText(notes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return {
      batch_id: sanitizeText(parsed.batch_id, 160) || null,
      previous_status: sanitizeText(parsed.previous_status, 80) || null,
      deduction_row_count: Number.isFinite(Number(parsed.deduction_row_count)) ? Number(parsed.deduction_row_count) : 0,
      inventory_item_count: Number.isFinite(Number(parsed.inventory_item_count)) ? Number(parsed.inventory_item_count) : 0,
      low_stock_warning_count: Number.isFinite(Number(parsed.low_stock_warning_count)) ? Number(parsed.low_stock_warning_count) : 0,
    };
  } catch {
    return {};
  }
}

function buildLogPayload({
  requestId,
  productionBatchId,
  batchDisplayId,
  actorEmail,
  actorRole,
  previousStatus,
  status,
  errorCode,
  errorMessage,
  timestamp,
  durationMs,
  inventoryItemCount = 0,
  deductionRowCount = 0,
  lowStockWarningCount = 0,
}) {
  return {
    command_id: commandId(requestId, productionBatchId),
    command_type: COMMAND,
    command_source: COMMAND_SOURCE,
    status,
    target_entity: TARGET_TYPE,
    target_id: productionBatchId,
    target_display_id: batchDisplayId || productionBatchId,
    actor_email: actorEmail,
    actor_role: actorRole,
    actor_type: 'admin',
    idempotency_key: requestId,
    idempotent_skipped: status === 'skipped',
    submitted_at: timestamp,
    started_at: timestamp,
    completed_at: timestamp,
    duration_ms: durationMs,
    function_name: FUNCTION_NAME,
    notes: buildNotes({
      requestId,
      batchDisplayId,
      previousStatus,
      inventoryItemCount,
      deductionRowCount,
      lowStockWarningCount,
      source: SOURCE,
    }),
    error_code: errorCode || null,
    error_message: errorMessage ? sanitizeText(errorMessage, 220) : null,
  };
}

function safeResponse({
  success,
  productionBatchId,
  batchDisplayId,
  status,
  requestId,
  skipped = false,
  updatedAt,
  inventoryItemCount = 0,
  deductionRowCount = 0,
  lowStockWarningCount = 0,
}) {
  return {
    success: success === true,
    production_batch_id: productionBatchId,
    batch_id: batchDisplayId || null,
    status: status || null,
    request_id: requestId,
    skipped: skipped === true,
    updated_at: updatedAt || null,
    inventory_item_count: inventoryItemCount,
    deduction_row_count: deductionRowCount,
    low_stock_warning_count: lowStockWarningCount,
    purchase_order_changes_deferred: true,
    customer_app_sync_deferred: true,
    notifications_deferred: true,
  };
}

function unitFamily(unit) {
  const normalized = normalizeLower(unit);
  if (['oz', 'lb', 'lbs', 'g', 'kg'].includes(normalized)) return 'mass';
  if (['l', 'ml'].includes(normalized)) return 'volume';
  if (['unit', 'units', 'case', 'cases', 'bottle', 'bottles'].includes(normalized)) return 'count';
  return 'unknown';
}

function isCompatibleUnit(ingredientUnit, inventoryUnit) {
  const ing = normalizeLower(ingredientUnit);
  const inv = normalizeLower(inventoryUnit);
  if (!ing || !inv) return false;
  if (!SUPPORTED_UNITS.has(ing) || !SUPPORTED_UNITS.has(inv)) return false;
  if (ing === inv) return true;

  const ingFamily = unitFamily(ing);
  const invFamily = unitFamily(inv);
  if ((ingFamily === 'mass' || ingFamily === 'volume') && ingFamily === invFamily) return true;

  const aliases = [
    new Set(['lb', 'lbs']),
    new Set(['unit', 'units']),
    new Set(['case', 'cases']),
    new Set(['bottle', 'bottles']),
  ];
  return aliases.some((group) => group.has(ing) && group.has(inv));
}

function toBaseUnit(quantity, unit) {
  const normalized = normalizeLower(unit);
  if (normalized === 'oz') return quantity;
  if (normalized === 'lb' || normalized === 'lbs') return quantity * OZ_PER_LB;
  if (normalized === 'g') return quantity / G_PER_OZ;
  if (normalized === 'kg') return (quantity * 1000) / G_PER_OZ;
  if (normalized === 'ml') return quantity;
  if (normalized === 'l') return quantity * 1000;
  return quantity;
}

function fromBaseUnit(quantity, unit) {
  const normalized = normalizeLower(unit);
  if (normalized === 'oz') return quantity;
  if (normalized === 'lb' || normalized === 'lbs') return quantity / OZ_PER_LB;
  if (normalized === 'g') return quantity * G_PER_OZ;
  if (normalized === 'kg') return (quantity * G_PER_OZ) / 1000;
  if (normalized === 'ml') return quantity;
  if (normalized === 'l') return quantity / 1000;
  return quantity;
}

function convertQuantity(quantity, fromUnit, toUnit) {
  const from = normalizeLower(fromUnit);
  const to = normalizeLower(toUnit);
  if (!isCompatibleUnit(from, to)) return null;
  if (from === to) return quantity;

  const fromFamily = unitFamily(from);
  const toFamily = unitFamily(to);
  if (fromFamily !== toFamily) return null;
  if (fromFamily === 'count') return quantity;

  return Math.round(fromBaseUnit(toBaseUnit(quantity, from), to) * 1000) / 1000;
}

function normalizeIngredientRows(batch) {
  const rows = Array.isArray(batch?.ingredients_used) ? batch.ingredients_used : [];
  return rows.slice(0, MAX_INGREDIENT_ROWS).map((row, index) => ({
    index,
    ingredientName: sanitizeText(row?.ingredient_name || row?.ingredient || row?.name, 100),
    key: normalizeKey(row?.ingredient_name || row?.ingredient || row?.name),
    quantity: nonNegativeNumber(row?.quantity ?? row?.amount ?? row?.qty),
    unit: normalizeLower(row?.unit),
    lotPresent: !!normalizeText(row?.lot_number),
  }));
}

function buildInventoryMap(items) {
  const exact = new Map();
  const singular = new Map();
  const generic = new Map();

  for (const item of items || []) {
    const key = normalizeKey(item?.ingredient);
    if (!key) continue;
    const exactItems = exact.get(key) || [];
    exactItems.push(item);
    exact.set(key, exactItems);

    const singularKey = singularizeIngredientKey(key);
    if (singularKey) {
      const singularItems = singular.get(singularKey) || [];
      singularItems.push(item);
      singular.set(singularKey, singularItems);
    }

    const genericKey = genericIngredientFallbackKey(key);
    if (genericKey) {
      const genericItems = generic.get(genericKey) || [];
      genericItems.push(item);
      generic.set(genericKey, genericItems);
    }
  }

  return { exact, singular, generic };
}

function findIngredientMatches(lookup, ingredientKey) {
  const key = normalizeKey(ingredientKey);
  if (!key || !lookup) return [];

  const exactMatches = lookup.exact?.get(key) || [];
  if (exactMatches.length > 0) return exactMatches;

  const singularKey = singularizeIngredientKey(key);
  const singularMatches = lookup.singular?.get(singularKey) || [];
  if (singularMatches.length > 0) return singularMatches;

  const fallbackKey = genericIngredientFallbackKey(key);
  if (!fallbackKey) return [];
  const fallbackMatches = [
    ...(lookup.exact?.get(fallbackKey) || []),
    ...(lookup.singular?.get(fallbackKey) || []),
    ...(lookup.generic?.get(fallbackKey) || []),
  ];
  const uniqueMatches = [...new Map(fallbackMatches.map(item => [item.id, item])).values()];
  return uniqueMatches;
}

function buildDeductionPlan(ingredients, inventoryMap) {
  const blockers = [];
  const warnings = [];
  const rows = [];

  if (ingredients.length === 0) blockers.push('missing_ingredients_used');

  for (const ingredient of ingredients) {
    if (!ingredient.key || !ingredient.ingredientName) {
      blockers.push('invalid_ingredient_name');
      continue;
    }

    if (ingredient.quantity === null || ingredient.quantity <= 0) {
      blockers.push('invalid_ingredient_quantity');
      continue;
    }

    if (!ingredient.unit || !SUPPORTED_UNITS.has(ingredient.unit)) {
      blockers.push('unsupported_ingredient_unit');
      continue;
    }

    const matches = findIngredientMatches(inventoryMap, ingredient.key);
    if (matches.length === 0) {
      blockers.push('inventory_match_missing');
      continue;
    }
    if (matches.length > 1) {
      blockers.push('ambiguous_ingredient_match');
      continue;
    }

    const inventory = matches[0];
    const inventoryItemId = normalizeSingleLine(inventory.id);
    if (!inventoryItemId) {
      blockers.push('inventory_item_id_missing');
      continue;
    }

    const currentStock = numberOrNull(inventory.stock);
    if (currentStock === null) {
      blockers.push('inventory_stock_missing');
      continue;
    }

    const quantityInInventoryUnit = convertQuantity(ingredient.quantity, ingredient.unit, inventory.unit);
    if (quantityInInventoryUnit === null) {
      blockers.push('unit_mismatch');
      continue;
    }

    const projectedStock = Math.round((currentStock - quantityInInventoryUnit) * 1000) / 1000;
    if (projectedStock < 0) blockers.push('inventory_shortfall');
    if (!ingredient.lotPresent) warnings.push('ingredient_lot_missing');

    rows.push({
      inventoryItemId,
      inventoryUnit: sanitizeText(inventory.unit, 40),
      currentStock,
      reorderPoint: numberOrNull(inventory.reorder_point),
      quantityToDeduct: quantityInInventoryUnit,
      projectedStock,
    });
  }

  const aggregatedRows = [];
  const byInventoryItemId = new Map();
  for (const row of rows) {
    const existing = byInventoryItemId.get(row.inventoryItemId);
    if (existing) {
      existing.quantityToDeduct = Math.round((existing.quantityToDeduct + row.quantityToDeduct) * 1000) / 1000;
      existing.projectedStock = Math.round((existing.currentStock - existing.quantityToDeduct) * 1000) / 1000;
    } else {
      byInventoryItemId.set(row.inventoryItemId, { ...row });
    }
  }

  for (const row of byInventoryItemId.values()) {
    if (row.projectedStock < 0) blockers.push('inventory_shortfall');
    aggregatedRows.push(row);
  }

  return {
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    rows: aggregatedRows,
  };
}

async function findProductionBatch(base44, productionBatchId) {
  const batches = await base44.asServiceRole.entities.ProductionBatch.filter(
    { id: productionBatchId },
    '-updated_date',
    1,
  );
  return batches?.[0] || null;
}

async function findExistingCommandLog(base44, requestId, productionBatchId) {
  const candidates = await base44.asServiceRole.entities.HubCommandLog.filter(
    { idempotency_key: requestId },
    '-created_date',
    20,
  ).catch(() => []);

  return (candidates || []).find((log) => (
    log.command_type === COMMAND &&
    log.target_entity === TARGET_TYPE &&
    log.target_id === productionBatchId &&
    log.idempotency_key === requestId
  )) || null;
}

async function hasPriorDeductionLog(base44, productionBatchId) {
  const logs = await base44.asServiceRole.entities.HubCommandLog.filter({
    command_type: COMMAND,
    target_entity: TARGET_TYPE,
    target_id: productionBatchId,
  }, '-created_date', 10).catch(() => []);

  return (logs || []).some((log) => ['success', 'skipped', 'processing'].includes(normalizeLower(log.status)));
}

async function findInventoryItem(base44, inventoryItemId) {
  const items = await base44.asServiceRole.entities.InventoryItem.filter(
    { id: inventoryItemId },
    '-updated_date',
    1,
  );
  return items?.[0] || null;
}

function evaluateGate({
  batch,
  productionBatchId,
  requestBatchId,
  expectedStatus,
  actorEmail,
  actorRole,
}) {
  const failures = [];
  const currentStatus = normalizeSingleLine(batch?.status);
  const batchDisplayId = normalizeSingleLine(batch?.batch_id);

  if (!REAL_DEDUCTION_ENABLED) failures.push('real_inventory_deduction_not_enabled');
  if (!isActorAllowed(actorEmail, actorRole)) failures.push('actor_not_allowed');
  if (!requestBatchId) failures.push('batch_id_required');
  if (requestBatchId && requestBatchId !== batchDisplayId) failures.push('batch_id_mismatch');
  if (!isBatchAllowlisted(productionBatchId, batchDisplayId)) failures.push('batch_not_allowlisted');
  if (!expectedStatus) failures.push('expected_status_required');
  if (expectedStatus && expectedStatus !== currentStatus) failures.push('expected_status_mismatch');
  if (currentStatus !== 'verified_logged') failures.push('batch_not_verified_logged');
  if (batch?.is_locked !== true) failures.push('batch_not_locked');
  if (!normalizeSingleLine(batch?.compliance_log_id)) failures.push('missing_compliance_log');
  if (!normalizeSingleLine(batch?.verified_at) || !normalizeSingleLine(batch?.verified_by)) {
    failures.push('missing_verification_metadata');
  }

  return [...new Set(failures)];
}

function statusForGateFailure(failures) {
  if (!failures.includes('real_inventory_deduction_not_enabled') && failures.includes('actor_not_allowed')) return 403;
  return 409;
}

function errorCodeForGateFailure(failures) {
  const priority = [
    'real_inventory_deduction_not_enabled',
    'actor_not_allowed',
    'batch_not_allowlisted',
    'batch_id_required',
    'batch_id_mismatch',
    'expected_status_required',
    'expected_status_mismatch',
  ];
  return priority.find((code) => failures.includes(code)) || failures[0] || 'real_inventory_deduction_gate_failed';
}

Deno.serve(async (req) => {
  const submittedAt = new Date().toISOString();
  const startedMs = Date.now();

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

    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const unsupportedKey = findUnsupportedBodyKey(body);
    if (unsupportedKey) {
      return Response.json({
        ...safeError(`Unsupported field: ${unsupportedKey}`, 'unsupported_field'),
      }, { status: 400 });
    }

    let productionBatchId;
    let requestBatchId;
    let expectedStatus;
    let requestId;
    let actorEmail;
    let actorRole;

    try {
      productionBatchId = normalizeId(body.production_batch_id, 'production_batch_id');
      requestBatchId = normalizeId(body.batch_id, 'batch_id');
      expectedStatus = normalizeOptionalStatus(body.expected_status);
      if (!expectedStatus) throw new Error('expected_status is required');
      requestId = normalizeId(body.request_id, 'request_id');
      actorEmail = normalizeActorEmail(body.actor_email);
      actorRole = sanitizeText(body.actor_role, 60);
      if (!actorRole) throw new Error('actor_role is required');
      normalizeSource(body.source);
      if (body.reason !== undefined) sanitizeText(body.reason, 180);
    } catch (error) {
      return Response.json(safeError(error.message, 'invalid_input'), { status: 400 });
    }

    const batch = await findProductionBatch(base44, productionBatchId);
    if (!batch) {
      return Response.json(safeError('ProductionBatch not found', 'batch_not_found'), { status: 404 });
    }

    const existingLog = await findExistingCommandLog(base44, requestId, productionBatchId);
    if (existingLog && IDEMPOTENT_SUCCESS_STATUSES.has(normalizeLower(existingLog.status))) {
      const metadata = parseNotesMetadata(existingLog.notes);
      return Response.json(safeResponse({
        success: true,
        productionBatchId,
        batchDisplayId: metadata.batch_id || sanitizeText(batch.batch_id, 160),
        status: sanitizeText(batch.status, 80),
        requestId,
        skipped: true,
        updatedAt: sanitizeText(existingLog.completed_at || existingLog.updated_date, 80) || null,
        inventoryItemCount: metadata.inventory_item_count || 0,
        deductionRowCount: metadata.deduction_row_count || 0,
        lowStockWarningCount: metadata.low_stock_warning_count || 0,
      }));
    }
    if (existingLog) {
      return Response.json(safeError('Conflicting idempotency record exists', 'idempotency_conflict'), { status: 409 });
    }

    const gateFailures = evaluateGate({
      batch,
      productionBatchId,
      requestBatchId,
      expectedStatus,
      actorEmail,
      actorRole,
    });

    if (gateFailures.length > 0) {
      const errorCode = errorCodeForGateFailure(gateFailures);
      return Response.json(
        safeError('Real inventory deduction gate failed', errorCode),
        { status: statusForGateFailure(gateFailures) },
      );
    }

    const priorDeductionLogPresent = await hasPriorDeductionLog(base44, productionBatchId);
    if (priorDeductionLogPresent) {
      return Response.json(safeError('Inventory deduction already logged for this batch', 'inventory_deduction_already_logged'), { status: 409 });
    }

    const inventoryItems = await base44.asServiceRole.entities.InventoryItem.list('-updated_date', INVENTORY_QUERY_LIMIT);
    const inventoryMap = buildInventoryMap(inventoryItems || []);
    const rawIngredientRows = Array.isArray(batch?.ingredients_used) ? batch.ingredients_used : [];
    const ingredientRows = normalizeIngredientRows(batch);
    const plan = buildDeductionPlan(ingredientRows, inventoryMap);
    const blockers = [...plan.blockers];
    if (rawIngredientRows.length > MAX_INGREDIENT_ROWS) blockers.push('ingredient_rows_exceed_safe_limit');

    if (blockers.length > 0) {
      return Response.json(safeError('Inventory deduction precheck failed', blockers[0]), { status: 409 });
    }

    const now = new Date().toISOString();
    const lowStockWarningCount = plan.rows.filter((row) => row.reorderPoint !== null && row.projectedStock <= row.reorderPoint).length;
    const durationMs = Date.now() - startedMs;
    const commandMetadata = {
      requestId,
      productionBatchId,
      batchDisplayId: batch.batch_id,
      actorEmail,
      actorRole,
      previousStatus: batch.status,
      timestamp: submittedAt,
      durationMs,
      inventoryItemCount: new Set(plan.rows.map((row) => row.inventoryItemId)).size,
      deductionRowCount: plan.rows.length,
      lowStockWarningCount,
    };

    let commandLog;
    try {
      commandLog = await base44.asServiceRole.entities.HubCommandLog.create(buildLogPayload({
        ...commandMetadata,
        status: 'processing',
      }));
    } catch {
      return Response.json(safeError('Command audit could not be created', 'command_log_failed'), { status: 500 });
    }

    try {
      for (const row of plan.rows) {
        const latestInventory = await findInventoryItem(base44, row.inventoryItemId);
        const latestStock = numberOrNull(latestInventory?.stock);
        if (latestStock === null || latestStock !== row.currentStock) {
          throw new Error('inventory_stock_changed');
        }
      }
      for (const row of plan.rows) {
        await base44.asServiceRole.entities.InventoryItem.update(row.inventoryItemId, {
          stock: row.projectedStock,
        });
      }
    } catch (error) {
      const errorCode = error?.message === 'inventory_stock_changed' ? 'inventory_stock_changed' : 'inventory_update_failed';
      await base44.asServiceRole.entities.HubCommandLog.update(commandLog.id, buildLogPayload({
        ...commandMetadata,
        status: 'failed',
        errorCode,
        errorMessage: errorCode === 'inventory_stock_changed'
          ? 'Inventory stock changed after precheck'
          : 'One or more inventory updates failed after precheck',
        durationMs: Date.now() - startedMs,
      })).catch(() => null);
      return Response.json(
        safeError(errorCode === 'inventory_stock_changed' ? 'Inventory stock changed after precheck' : 'Inventory update failed after precheck', errorCode),
        { status: errorCode === 'inventory_stock_changed' ? 409 : 500 },
      );
    }

    const existingAuditTrail = Array.isArray(batch.audit_trail) ? batch.audit_trail : [];
    const auditEntry = {
      timestamp: now,
      action: 'ProductionInventoryDeducted',
      performed_by: actorEmail,
      source: SOURCE,
      request_id: requestId,
      deduction_row_count: plan.rows.length,
      inventory_item_count: commandMetadata.inventoryItemCount,
      purchase_order_changes_deferred: true,
      customer_app_sync_deferred: true,
      notifications_deferred: true,
    };

    try {
      await base44.asServiceRole.entities.ProductionBatch.update(batch.id, {
        audit_trail: [...existingAuditTrail, auditEntry],
      });
    } catch {
      await base44.asServiceRole.entities.HubCommandLog.update(commandLog.id, buildLogPayload({
        ...commandMetadata,
        status: 'failed',
        errorCode: 'partial_inventory_deducted_audit_failed',
        errorMessage: 'Inventory was deducted but ProductionBatch audit trail was not updated',
        durationMs: Date.now() - startedMs,
      })).catch(() => null);
      return Response.json(safeError('Inventory deducted but batch audit was not updated', 'partial_inventory_deducted_audit_failed'), { status: 500 });
    }

    try {
      await base44.asServiceRole.entities.HubCommandLog.update(commandLog.id, buildLogPayload({
        ...commandMetadata,
        status: 'success',
        durationMs: Date.now() - startedMs,
      }));
    } catch {
      return Response.json(safeError('Inventory deducted but command audit was not finalized', 'command_log_update_failed'), { status: 500 });
    }

    return Response.json(safeResponse({
      success: true,
      productionBatchId,
      batchDisplayId: sanitizeText(batch.batch_id, 160),
      status: sanitizeText(batch.status, 80),
      requestId,
      skipped: false,
      updatedAt: now,
      inventoryItemCount: commandMetadata.inventoryItemCount,
      deductionRowCount: plan.rows.length,
      lowStockWarningCount,
    }));
  } catch {
    console.error('[deductProductionInventoryForCustomerApp] Error');
    return Response.json(safeError('Unable to deduct production inventory', 'internal_error'), { status: 500 });
  }
});
