import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_TEXT_LENGTH = 160;
const MAX_RECIPE_ROWS = 50;
const INVENTORY_QUERY_LIMIT = 1000;
const RECIPE_QUERY_LIMIT = 500;
const YIELD_QUERY_LIMIT = 1000;
const DEDUCTION_COMMAND_TYPE = 'production_inventory_deduction';
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
  'ProductionBatch.ingredients_used',
  'ProductionBatch.audit_trail',
  'HubCommandLog',
];

const SUPPORTED_INVENTORY_UNITS = new Set([
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

const PRODUCT_ALIASES = {
  're nu': ['re-nu', 're nu', 'renu'],
  oasis: ['oasis'],
  aura: ['aura'],
  'reset shot': ['reset', 'reset shot'],
  'hydration shot': ['hydration', 'hydration shot'],
  'radiance shot': ['radiance', 'radiance shot'],
  'orange juice': ['orange', 'orange juice'],
  'pineapple juice': ['pineapple', 'pineapple juice'],
  'watermelon juice': ['watermelon', 'watermelon juice'],
};

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
    .replace(/[-_]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\b(juice|product|shot)\b/g, '')
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

function safeText(value, maxLength = MAX_TEXT_LENGTH) {
  const text = normalizeSingleLine(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl)\b/gi, '[redacted address]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]');

  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value) {
  const parsed = numberOrNull(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function roundThousandth(value) {
  const parsed = numberOrNull(value);
  return parsed === null ? null : Math.round(parsed * 1000) / 1000;
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
  const matches = await base44.asServiceRole.entities.ProductionBatch.filter(
    { id: productionBatchId },
    '-updated_date',
    2,
  );
  return Array.isArray(matches) && matches.length > 0 ? matches[0] : null;
}

async function fetchComplianceLog(base44, batch) {
  if (!normalizeText(batch?.compliance_log_id)) return null;
  const matches = await base44.asServiceRole.entities.BatchComplianceLog.filter(
    { id: normalizeText(batch.compliance_log_id) },
    '-updated_date',
    1,
  ).catch(() => []);
  return Array.isArray(matches) && matches.length > 0 ? matches[0] : null;
}

async function hasPriorDeductionLog(base44, productionBatchId) {
  const logs = await base44.asServiceRole.entities.HubCommandLog.filter({
    command_type: DEDUCTION_COMMAND_TYPE,
    target_entity: 'ProductionBatch',
    target_id: productionBatchId,
  }, '-created_date', 10).catch(() => []);

  return (logs || []).some(log => ['success', 'skipped', 'processing'].includes(normalizeLower(log.status)));
}

function findBestRecipeMatch(recipes, productName) {
  const normalized = normalizeKey(productName);
  if (!normalized) return null;

  const activeRecipes = (recipes || []).filter(recipe => recipe?.is_active !== false);
  const exact = activeRecipes.find(recipe => normalizeKey(recipe?.product_name) === normalized);
  if (exact) return exact;

  for (const [canonicalKey, aliases] of Object.entries(PRODUCT_ALIASES)) {
    if (aliases.map(normalizeKey).includes(normalized)) {
      const aliasMatch = activeRecipes.find(recipe => normalizeKey(recipe?.product_name) === normalizeKey(canonicalKey));
      if (aliasMatch) return aliasMatch;
    }
  }

  return null;
}

function buildIngredientLookup(items, getName) {
  const exact = new Map();
  const singular = new Map();
  const generic = new Map();

  for (const item of items || []) {
    const key = normalizeKey(getName(item));
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

function findIngredientMatches(lookup, ingredientName) {
  const key = normalizeKey(ingredientName);
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

function buildInventoryMap(items) {
  return buildIngredientLookup(items, item => item?.ingredient);
}

function buildYieldMap(items) {
  return buildIngredientLookup(items, item => item?.ingredient_name);
}

function unitFamily(unit) {
  const normalized = normalizeLower(unit);
  if (['oz', 'lb', 'lbs', 'g', 'kg'].includes(normalized)) return 'mass';
  if (['l', 'ml'].includes(normalized)) return 'volume';
  if (['unit', 'units', 'case', 'cases', 'bottle', 'bottles'].includes(normalized)) return 'count';
  return 'unknown';
}

function isCompatibleUnit(fromUnit, toUnit) {
  const from = normalizeLower(fromUnit);
  const to = normalizeLower(toUnit);
  if (!from || !to) return false;
  if (!SUPPORTED_INVENTORY_UNITS.has(from) || !SUPPORTED_INVENTORY_UNITS.has(to)) return false;
  if (from === to) return true;

  const fromFamily = unitFamily(from);
  const toFamily = unitFamily(to);
  if ((fromFamily === 'mass' || fromFamily === 'volume') && fromFamily === toFamily) return true;

  const aliases = [
    new Set(['lb', 'lbs']),
    new Set(['unit', 'units']),
    new Set(['case', 'cases']),
    new Set(['bottle', 'bottles']),
  ];
  return aliases.some(group => group.has(from) && group.has(to));
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
  if (from === to) return roundThousandth(quantity);

  const fromFamily = unitFamily(from);
  const toFamily = unitFamily(to);
  if (fromFamily !== toFamily) return null;
  if (fromFamily === 'count') return roundThousandth(quantity);

  return roundThousandth(fromBaseUnit(toBaseUnit(quantity, from), to));
}

function sanitizeInventoryItem(item) {
  if (!item) return null;
  return {
    inventory_item_id: safeText(item.id, 100),
    inventory_item_name: safeText(item.ingredient, 120),
    current_stock: numberOrNull(item.stock),
    unit: safeText(item.unit, 40),
    reorder_point: numberOrNull(item.reorder_point),
    max_stock: numberOrNull(item.max_stock),
    category: safeText(item.category, 80),
    supplier: safeText(item.supplier, 120),
    location: safeText(item.location, 120),
  };
}

function sanitizeYieldRecord(item) {
  if (!item) return null;
  return {
    yield_record_id: safeText(item.id, 100),
    ingredient_name: safeText(item.ingredient_name, 120),
    purchase_unit: safeText(item.purchase_unit, 60),
    oz_per_purchase_unit: numberOrNull(item.oz_per_purchase_unit),
    trim_waste_factor: numberOrNull(item.trim_waste_factor),
    units_per_case: numberOrNull(item.units_per_case),
    rounding_rule: safeText(item.rounding_rule, 80),
    supplier: safeText(item.supplier, 120),
  };
}

function buildPreviewRows(recipe, batch, inventoryMap, yieldMap) {
  const rows = [];
  const correctionBlockers = [];
  const deductionBlockers = [];
  const warnings = [];
  const actualUnits = positiveNumber(batch?.actual_units ?? batch?.final_usable_quantity ?? batch?.bottles_produced);
  const yieldFactor = positiveNumber(recipe?.yield_factor) || 1;
  const recipeRows = Array.isArray(recipe?.ingredients) ? recipe.ingredients.slice(0, MAX_RECIPE_ROWS) : [];

  if (!actualUnits) correctionBlockers.push('missing_actual_units');
  if (!Array.isArray(recipe?.ingredients) || recipe.ingredients.length === 0) correctionBlockers.push('missing_recipe_ingredients');
  if ((recipe?.ingredients || []).length > MAX_RECIPE_ROWS) warnings.push('recipe_rows_truncated_for_preview');

  for (const ingredient of recipeRows) {
    const ingredientName = safeText(ingredient?.ingredient_name, 120);
    const ingredientKey = normalizeKey(ingredient?.ingredient_name);
    const quantityOzPerUnit = numberOrNull(ingredient?.quantity_oz);
    const proposedQuantityOz = actualUnits && quantityOzPerUnit !== null
      ? roundThousandth(quantityOzPerUnit * actualUnits * yieldFactor)
      : null;
    const inventoryMatches = findIngredientMatches(inventoryMap, ingredient?.ingredient_name);
    const yieldMatches = findIngredientMatches(yieldMap, ingredient?.ingredient_name);
    const rowCorrectionBlockers = [];
    const rowDeductionBlockers = [];
    const rowWarnings = [];

    if (!ingredientKey || !ingredientName) rowCorrectionBlockers.push('invalid_ingredient_name');
    if (quantityOzPerUnit === null || quantityOzPerUnit <= 0) rowCorrectionBlockers.push('quantity_normalization_issue');
    if (!actualUnits) rowCorrectionBlockers.push('missing_actual_units');
    if (normalizeLower(ingredient?.unit) && normalizeLower(ingredient.unit) !== 'oz') {
      rowWarnings.push('quantity_field_normalized');
    }
    if (inventoryMatches.length === 0) {
      rowCorrectionBlockers.push('missing_inventory_item');
      rowDeductionBlockers.push('missing_inventory_item');
    }
    if (inventoryMatches.length > 1) {
      rowCorrectionBlockers.push('ambiguous_ingredient_match');
      rowDeductionBlockers.push('ambiguous_ingredient_match');
    }
    if (yieldMatches.length === 0) {
      rowCorrectionBlockers.push('missing_ingredient_yield');
      rowDeductionBlockers.push('missing_ingredient_yield');
    }
    if (yieldMatches.length > 1) {
      rowCorrectionBlockers.push('ambiguous_ingredient_match');
      rowDeductionBlockers.push('ambiguous_ingredient_match');
    }

    const inventory = inventoryMatches.length === 1 ? inventoryMatches[0] : null;
    const inventoryUnit = normalizeLower(inventory?.unit);
    const currentStock = numberOrNull(inventory?.stock);
    const quantityToDeduct = inventory && proposedQuantityOz !== null
      ? convertQuantity(proposedQuantityOz, 'oz', inventoryUnit)
      : null;
    const projectedStock = currentStock !== null && quantityToDeduct !== null
      ? roundThousandth(currentStock - quantityToDeduct)
      : null;
    const shortfallQuantity = projectedStock !== null && projectedStock < 0
      ? roundThousandth(Math.abs(projectedStock))
      : 0;
    const reorderPoint = numberOrNull(inventory?.reorder_point);
    const stockAvailable = currentStock !== null && quantityToDeduct !== null && projectedStock !== null && projectedStock >= 0;
    const procurementNeeded = projectedStock !== null && projectedStock < 0;

    if (inventory && quantityToDeduct === null) {
      rowCorrectionBlockers.push('quantity_normalization_issue');
      rowDeductionBlockers.push('quantity_normalization_issue');
    }
    if (procurementNeeded) {
      rowDeductionBlockers.push('inventory_shortfall');
      rowWarnings.push('procurement_needed');
    }
    if (projectedStock !== null && reorderPoint !== null && projectedStock <= reorderPoint) {
      rowWarnings.push('reorder_or_low_stock_after_deduction');
    }

    correctionBlockers.push(...rowCorrectionBlockers);
    deductionBlockers.push(...rowDeductionBlockers);
    warnings.push(...rowWarnings);

    const usageRowReady = rowCorrectionBlockers.length === 0;
    const inventoryDeductionReady = usageRowReady && rowDeductionBlockers.length === 0 && stockAvailable;

    rows.push({
      matched_recipe_ingredient_name: ingredientName,
      recipe_quantity_oz_per_unit: quantityOzPerUnit,
      recipe_unit_label: safeText(ingredient?.unit || 'oz', 40),
      actual_units: actualUnits,
      recipe_yield_factor: yieldFactor,
      proposed_ingredient_usage: proposedQuantityOz === null ? null : {
        ingredient_name: ingredientName,
        quantity: proposedQuantityOz,
        unit: 'oz',
        lot_number: null,
        source: 'recipe_derived_preview',
      },
      proposed_deduction_quantity: quantityToDeduct,
      projected_stock_after_deduction: projectedStock,
      shortfall_quantity: shortfallQuantity,
      usage_row_ready: usageRowReady,
      inventory_match_found: inventoryMatches.length === 1,
      yield_match_found: yieldMatches.length > 0,
      stock_available: stockAvailable,
      procurement_needed: procurementNeeded,
      inventory_deduction_ready: inventoryDeductionReady,
      inventory_match_count: inventoryMatches.length,
      inventory_matches: inventoryMatches.slice(0, 5).map(sanitizeInventoryItem).filter(Boolean),
      yield_match_count: yieldMatches.length,
      yield_matches: yieldMatches.slice(0, 5).map(sanitizeYieldRecord).filter(Boolean),
      status: usageRowReady ? (procurementNeeded ? 'usage_ready_procurement_needed' : 'ready') : 'blocked',
      correction_blockers: [...new Set(rowCorrectionBlockers)],
      deduction_blockers: [...new Set(rowDeductionBlockers)],
      blockers: [...new Set(rowCorrectionBlockers)],
      warnings: [...new Set(rowWarnings)],
    });
  }

  return {
    rows,
    correctionBlockers: [...new Set(correctionBlockers)],
    deductionBlockers: [...new Set(deductionBlockers)],
    warnings: [...new Set(warnings)],
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
    const requestId = safeText(body.request_id, 120);

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

    const correctionBlockers = [];
    const deductionBlockers = [];
    const warnings = [];
    const batchDisplayId = safeText(batch.batch_id, 160);
    const currentStatus = normalizeText(batch.status);

    if (requestBatchId && requestBatchId !== normalizeText(batch.batch_id)) {
      correctionBlockers.push('batch_id_mismatch');
      deductionBlockers.push('batch_id_mismatch');
    }

    if (expectedStatus && expectedStatus !== currentStatus) {
      correctionBlockers.push('expected_status_mismatch');
      deductionBlockers.push('expected_status_mismatch');
    }

    if (currentStatus !== 'verified_logged') {
      correctionBlockers.push('batch_not_verified_logged');
      deductionBlockers.push('batch_not_verified_logged');
    }

    const existingIngredientCount = Array.isArray(batch.ingredients_used) ? batch.ingredients_used.length : 0;
    if (existingIngredientCount > 0) {
      correctionBlockers.push('existing_ingredient_usage');
    }

    const priorDeductionLogPresent = await hasPriorDeductionLog(base44, productionBatchId);
    if (priorDeductionLogPresent) {
      correctionBlockers.push('prior_deduction_log_present');
      deductionBlockers.push('prior_deduction_log_present');
    }

    const [
      complianceLog,
      recipes,
      inventoryItems,
      yieldRows,
    ] = await Promise.all([
      fetchComplianceLog(base44, batch),
      base44.asServiceRole.entities.Recipe.list('-updated_date', RECIPE_QUERY_LIMIT),
      base44.asServiceRole.entities.InventoryItem.list('-updated_date', INVENTORY_QUERY_LIMIT),
      base44.asServiceRole.entities.IngredientYield.list('-updated_date', YIELD_QUERY_LIMIT),
    ]);

    const recipe = findBestRecipeMatch(recipes || [], batch.product_name);
    if (!recipe) {
      correctionBlockers.push('recipe_match_missing');
      deductionBlockers.push('recipe_match_missing');
    }
    if ((recipes || []).length >= RECIPE_QUERY_LIMIT) warnings.push('recipe_query_limit_reached');
    if ((inventoryItems || []).length >= INVENTORY_QUERY_LIMIT) warnings.push('inventory_query_limit_reached');
    if ((yieldRows || []).length >= YIELD_QUERY_LIMIT) warnings.push('yield_query_limit_reached');

    const inventoryMap = buildInventoryMap(inventoryItems || []);
    const yieldMap = buildYieldMap(yieldRows || []);
    const preview = recipe
      ? buildPreviewRows(recipe, batch, inventoryMap, yieldMap)
      : { rows: [], correctionBlockers: [], deductionBlockers: [], warnings: [] };

    correctionBlockers.push(...preview.correctionBlockers);
    deductionBlockers.push(...preview.deductionBlockers);
    warnings.push(...preview.warnings);

    const uniqueCorrectionBlockers = [...new Set(correctionBlockers)];
    const uniqueDeductionBlockers = [...new Set(deductionBlockers)];
    const uniqueWarnings = [...new Set(warnings)];
    const usageReadyRows = preview.rows.filter(row => row.usage_row_ready === true).length;
    const deductionReadyRows = preview.rows.filter(row => row.inventory_deduction_ready === true).length;
    const procurementNeededCount = preview.rows.filter(row => row.procurement_needed === true).length;
    const usageCorrectionAllowed = uniqueCorrectionBlockers.length === 0 && preview.rows.length > 0;
    const inventoryDeductionReady = usageCorrectionAllowed && uniqueDeductionBlockers.length === 0 && deductionReadyRows === preview.rows.length;

    return Response.json({
      success: true,
      dry_run: true,
      function_name: 'previewProductionIngredientUsageCorrectionForCustomerApp',
      production_batch_id: productionBatchId,
      batch_id: batchDisplayId,
      current_status: currentStatus,
      expected_status_match: !expectedStatus || expectedStatus === currentStatus,
      request_id: requestId,
      product_name: safeText(batch.product_name, 160),
      product_category: safeText(batch.product_category, 80),
      production_date: safeText(batch.production_date, 80),
      actual_units: numberOrNull(batch.actual_units),
      existing_ingredients_used_count: existingIngredientCount,
      compliance_log_id: safeText(batch.compliance_log_id, 100),
      compliance_log_ingredients_count: Array.isArray(complianceLog?.ingredients) ? complianceLog.ingredients.length : 0,
      prior_deduction_log_present: priorDeductionLogPresent,
      recipe_match_present: !!recipe,
      recipe_id: recipe ? safeText(recipe.id, 100) : null,
      recipe_product_name: recipe ? safeText(recipe.product_name, 160) : null,
      recipe_yield_factor: recipe ? numberOrNull(recipe.yield_factor) : null,
      recipe_ingredients_count: Array.isArray(recipe?.ingredients) ? recipe.ingredients.length : 0,
      usage_correction_preview_count: preview.rows.length,
      usage_correction_ready_count: usageReadyRows,
      usage_correction_allowed: usageCorrectionAllowed,
      proposed_ingredient_usage_count: preview.rows.length,
      proposed_ingredient_usage_ready_count: usageReadyRows,
      proposed_ingredient_usage_rows: preview.rows,
      inventory_item_count_scanned: Array.isArray(inventoryItems) ? inventoryItems.length : 0,
      ingredient_yield_count_scanned: Array.isArray(yieldRows) ? yieldRows.length : 0,
      projected_writes_if_approved: PROJECTED_WRITES_IF_APPROVED,
      inventory_stock_changes_deferred: true,
      purchase_order_changes_deferred: true,
      batch_compliance_log_changes_deferred: true,
      customer_app_sync_deferred: true,
      notifications_deferred: true,
      procurement_needed: procurementNeededCount > 0,
      procurement_needed_count: procurementNeededCount,
      inventory_deduction_ready: inventoryDeductionReady,
      deduction_blockers: uniqueDeductionBlockers,
      correction_blockers: uniqueCorrectionBlockers,
      live_allowed: usageCorrectionAllowed,
      blockers: uniqueCorrectionBlockers,
      warnings: uniqueWarnings,
    });
  } catch (error) {
    console.error('[previewProductionIngredientUsageCorrectionForCustomerApp] Error');
    return Response.json(
      safeError('Unable to preview production ingredient usage correction', 'internal_error'),
      { status: statusCodeForError('internal_error') },
    );
  }
});
