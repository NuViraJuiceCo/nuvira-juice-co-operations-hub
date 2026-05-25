import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_TEXT_LENGTH = 120;
const MAX_INGREDIENT_ROWS = 50;
const MAX_PREVIEW_ROWS = 25;
const INVENTORY_QUERY_LIMIT = 1000;
const COMMAND_TYPE = 'production_inventory_deduction';
const OZ_PER_LB = 16;
const G_PER_OZ = 28.3495;
const ML_PER_FL_OZ = 29.5735;

const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'batch_id',
  'expected_status',
  'request_id',
]);

const PROJECTED_WRITES_IF_APPROVED = [
  'InventoryItem.stock',
  'ProductionBatch.audit_trail',
  'HubCommandLog',
];

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

function normalizeText(value) {
  return (value || '').toString().trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeKey(value) {
  return normalizeLower(value)
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeText(value, maxLength = MAX_TEXT_LENGTH) {
  const text = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]');

  if (!text) return null;
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

function statusCodeForError(errorCode) {
  if (errorCode === 'unauthorized') return 401;
  if (errorCode === 'method_not_allowed') return 405;
  if (errorCode === 'unsupported_field' || errorCode === 'invalid_request') return 400;
  if (errorCode === 'batch_not_found') return 404;
  if (errorCode === 'internal_error') return 500;
  return 409;
}

function safeError(message, errorCode, extra = {}) {
  return {
    success: false,
    dry_run: true,
    error: message,
    error_code: errorCode,
    message,
    ...extra,
  };
}

async function parseBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

function rejectUnsupportedFields(body) {
  const unsupported = Object.keys(body || {}).filter(key => !ALLOWED_BODY_KEYS.has(key));
  if (unsupported.length > 0) {
    throw new Error('unsupported_field');
  }
}

async function fetchBatch(base44, productionBatchId) {
  const matches = await base44.asServiceRole.entities.ProductionBatch.filter({ id: productionBatchId }, '-updated_date', 2);
  return Array.isArray(matches) && matches.length > 0 ? matches[0] : null;
}

async function hasPriorDeductionLog(base44, productionBatchId) {
  const logs = await base44.asServiceRole.entities.HubCommandLog.filter({
    command_type: COMMAND_TYPE,
    target_entity: 'ProductionBatch',
    target_id: productionBatchId,
  }, '-created_date', 5);

  return (logs || []).some(log => ['success', 'skipped', 'processing'].includes(normalizeLower(log.status)));
}

function normalizeIngredientRows(batch) {
  const rows = Array.isArray(batch?.ingredients_used) ? batch.ingredients_used : [];
  return rows
    .slice(0, MAX_INGREDIENT_ROWS)
    .map((row, index) => ({
      index,
      ingredient_name: safeText(row?.ingredient_name || row?.ingredient || row?.name, 100),
      key: normalizeKey(row?.ingredient_name || row?.ingredient || row?.name),
      quantity: nonNegativeNumber(row?.quantity ?? row?.amount ?? row?.qty),
      unit: normalizeLower(row?.unit),
      lot_present: !!normalizeText(row?.lot_number),
    }));
}

function buildInventoryMap(items) {
  const map = new Map();
  for (const item of items || []) {
    const key = normalizeKey(item?.ingredient);
    if (!key) continue;
    const existing = map.get(key) || [];
    existing.push(item);
    map.set(key, existing);
  }
  return map;
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
  return aliases.some(group => group.has(ing) && group.has(inv));
}

function unitFamily(unit) {
  const normalized = normalizeLower(unit);
  if (['oz', 'lb', 'lbs', 'g', 'kg'].includes(normalized)) return 'mass';
  if (['l', 'ml'].includes(normalized)) return 'volume';
  if (['unit', 'units', 'case', 'cases', 'bottle', 'bottles'].includes(normalized)) return 'count';
  return 'unknown';
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

  const converted = fromBaseUnit(toBaseUnit(quantity, from), to);
  return Math.round(converted * 1000) / 1000;
}

function buildDeductionPreview(ingredients, inventoryMap) {
  const blockers = [];
  const warnings = [];
  const previewRows = [];

  if (ingredients.length === 0) {
    blockers.push('missing_ingredients_used');
  }

  for (const ingredient of ingredients) {
    if (!ingredient.key || !ingredient.ingredient_name) {
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

    const matches = inventoryMap.get(ingredient.key) || [];
    if (matches.length === 0) {
      blockers.push('inventory_match_missing');
      previewRows.push({
        ingredient_name: ingredient.ingredient_name,
        ingredient_unit: ingredient.unit,
        quantity_to_deduct: ingredient.quantity,
        inventory_match_count: 0,
        lot_present: ingredient.lot_present,
        status: 'blocked',
      });
      continue;
    }

    if (matches.length > 1) {
      blockers.push('inventory_match_ambiguous');
      previewRows.push({
        ingredient_name: ingredient.ingredient_name,
        ingredient_unit: ingredient.unit,
        quantity_to_deduct: ingredient.quantity,
        inventory_match_count: matches.length,
        lot_present: ingredient.lot_present,
        status: 'blocked',
      });
      continue;
    }

    const inventory = matches[0];
    const currentStock = numberOrNull(inventory.stock);
    if (currentStock === null) {
      blockers.push('inventory_stock_missing');
      continue;
    }

    const quantityInInventoryUnit = convertQuantity(ingredient.quantity, ingredient.unit, inventory.unit);
    if (quantityInInventoryUnit === null) {
      blockers.push('unit_mismatch');
      previewRows.push({
        ingredient_name: ingredient.ingredient_name,
        ingredient_unit: ingredient.unit,
        inventory_item_id: inventory.id || null,
        inventory_unit: safeText(inventory.unit, 40),
        quantity_to_deduct: ingredient.quantity,
        current_stock: currentStock,
        projected_stock: null,
        lot_present: ingredient.lot_present,
        status: 'blocked',
      });
      continue;
    }

    const projectedStock = Math.round((currentStock - quantityInInventoryUnit) * 1000) / 1000;
    if (projectedStock < 0) {
      blockers.push('inventory_shortfall');
    }

    if (!ingredient.lot_present) {
      warnings.push('ingredient_lot_missing');
    }

    previewRows.push({
      ingredient_name: ingredient.ingredient_name,
      inventory_item_id: inventory.id || null,
      unit: safeText(inventory.unit, 40),
      source_quantity: ingredient.quantity,
      source_unit: ingredient.unit,
      quantity_to_deduct: quantityInInventoryUnit,
      current_stock: currentStock,
      projected_stock: projectedStock,
      reorder_point: numberOrNull(inventory.reorder_point),
      lot_present: ingredient.lot_present,
      status: projectedStock < 0 ? 'blocked' : 'ready',
    });
  }

  return {
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    previewRows: previewRows.slice(0, MAX_PREVIEW_ROWS),
    previewRowsTruncated: previewRows.length > MAX_PREVIEW_ROWS,
  };
}

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return Response.json(safeError('Unauthorized', 'unauthorized'), { status: 401 });
    }

    const token = authHeader.slice(7);
    if (!SYNC_SECRET || token !== SYNC_SECRET) {
      return Response.json(safeError('Unauthorized', 'unauthorized'), { status: 401 });
    }

    if (req.method !== 'POST') {
      return Response.json(safeError('Method not allowed', 'method_not_allowed'), { status: 405 });
    }

    const body = await parseBody(req);
    try {
      rejectUnsupportedFields(body);
    } catch {
      return Response.json(safeError('Unsupported request field', 'unsupported_field'), { status: 400 });
    }

    const productionBatchId = normalizeText(body.production_batch_id);
    const requestBatchId = normalizeText(body.batch_id);
    const expectedStatus = normalizeText(body.expected_status);
    const requestId = safeText(body.request_id, 100);

    if (!productionBatchId) {
      return Response.json(safeError('production_batch_id is required', 'invalid_request'), { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const batch = await fetchBatch(base44, productionBatchId);
    if (!batch) {
      return Response.json(safeError('ProductionBatch not found', 'batch_not_found', {
        production_batch_id: productionBatchId,
      }), { status: 404 });
    }

    const blockers = [];
    const warnings = [];
    const batchDisplayId = safeText(batch.batch_id, 160);
    const currentStatus = normalizeText(batch.status);

    if (requestBatchId && requestBatchId !== normalizeText(batch.batch_id)) {
      blockers.push('batch_id_mismatch');
    }

    if (expectedStatus && expectedStatus !== currentStatus) {
      blockers.push('expected_status_mismatch');
    }

    if (currentStatus !== 'verified_logged') {
      blockers.push('batch_not_verified_logged');
    }

    if (batch.is_locked !== true) {
      blockers.push('batch_not_locked');
    }

    if (!normalizeText(batch.compliance_log_id)) {
      blockers.push('missing_compliance_log');
    }

    if (!normalizeText(batch.verified_at) || !normalizeText(batch.verified_by)) {
      blockers.push('missing_verification_metadata');
    }

    const priorDeductionLogPresent = await hasPriorDeductionLog(base44, productionBatchId);
    if (priorDeductionLogPresent) {
      blockers.push('inventory_deduction_already_logged');
    }

    const inventoryItems = await base44.asServiceRole.entities.InventoryItem.list('-updated_date', INVENTORY_QUERY_LIMIT);
    const inventoryMap = buildInventoryMap(inventoryItems || []);
    const rawIngredientRows = Array.isArray(batch?.ingredients_used) ? batch.ingredients_used : [];
    const ingredientRows = normalizeIngredientRows(batch);
    const deductionPreview = buildDeductionPreview(ingredientRows, inventoryMap);

    blockers.push(...deductionPreview.blockers);
    warnings.push(...deductionPreview.warnings);
    if (rawIngredientRows.length > MAX_INGREDIENT_ROWS) warnings.push('ingredient_rows_truncated_for_preview');
    if (deductionPreview.previewRowsTruncated) warnings.push('deduction_preview_rows_truncated');

    const uniqueBlockers = [...new Set(blockers)];
    const uniqueWarnings = [...new Set(warnings)];

    return Response.json({
      success: true,
      dry_run: true,
      function_name: 'previewProductionInventoryDeductionForCustomerApp',
      production_batch_id: productionBatchId,
      batch_id: batchDisplayId,
      current_status: currentStatus,
      expected_status_match: !expectedStatus || expectedStatus === currentStatus,
      request_id: requestId,
      inventory_item_count_scanned: Array.isArray(inventoryItems) ? inventoryItems.length : 0,
      ingredients_used_count: rawIngredientRows.length,
      deduction_preview_count: deductionPreview.previewRows.length,
      deduction_preview_rows: deductionPreview.previewRows,
      prior_deduction_log_present: priorDeductionLogPresent,
      projected_writes_if_approved: PROJECTED_WRITES_IF_APPROVED,
      purchase_order_changes_deferred: true,
      customer_app_sync_deferred: true,
      notifications_deferred: true,
      live_allowed: uniqueBlockers.length === 0,
      blockers: uniqueBlockers,
      warnings: uniqueWarnings,
    });
  } catch (error) {
    console.error('[previewProductionInventoryDeductionForCustomerApp] Error');
    return Response.json(safeError('Unable to preview inventory deduction', 'internal_error'), { status: statusCodeForError('internal_error') });
  }
});
