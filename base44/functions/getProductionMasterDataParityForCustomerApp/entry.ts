import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const QUERY_LIMIT = 700;
const MAX_NAMES = 80;
const MAX_TEXT = 160;

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
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function singularKey(value) {
  return normalizeKey(value)
    .split(' ')
    .map(part => (part.length > 3 && part.endsWith('s') ? part.slice(0, -1) : part))
    .join(' ');
}

function matchKeys(value) {
  const exact = normalizeKey(value);
  const singular = singularKey(value);
  return [...new Set([exact, singular].filter(Boolean))];
}

function safeText(value, maxLength = MAX_TEXT) {
  const text = normalizeSingleLine(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\b(?:ch|re|pi|cs|cus|sub|evt|in|pm|seti|si|src|tok|po|li)_[A-Za-z0-9]{8,}\b/g, '[redacted provider id]')
    .replace(/\bgid:\/\/shopify\/[A-Za-z]+\/[A-Za-z0-9_-]+\b/g, '[redacted shopify id]');
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function safeId(value, maxLength = 180) {
  const text = safeText(value, maxLength);
  return text && /^[A-Za-z0-9._:@/#-]+$/.test(text) ? text : null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNames(value) {
  const text = normalizeText(value);
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map(item => safeText(item, 120)).filter(Boolean).slice(0, MAX_NAMES);
    } catch {
      return [];
    }
  }
  return text.split(',').map(item => safeText(item, 120)).filter(Boolean).slice(0, MAX_NAMES);
}

function addToIndex(index, value, row) {
  for (const key of matchKeys(value)) {
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(row);
  }
}

function buildIndex(rows, nameSelector) {
  const index = new Map();
  for (const row of rows || []) addToIndex(index, nameSelector(row), row);
  return index;
}

function findMatches(index, name) {
  for (const key of matchKeys(name)) {
    const matches = index.get(key) || [];
    if (matches.length > 0) return matches;
  }
  return [];
}

function matchStatus(matches) {
  if (!matches || matches.length === 0) return 'missing';
  if (matches.length > 1) return 'ambiguous';
  return 'matched';
}

function summarizeRecipe(recipe) {
  const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
  return {
    id: safeId(recipe?.id),
    name: safeText(recipe?.product_name, 120),
    normalized_name: normalizeKey(recipe?.product_name) || null,
    product_sku: safeText(recipe?.product_sku, 80),
    is_active: recipe?.is_active !== false,
    bottle_size_oz: numberOrNull(recipe?.bottle_size_oz),
    yield_factor: numberOrNull(recipe?.yield_factor),
    ingredient_count: ingredients.length,
    ingredient_names: ingredients.map(item => safeText(item?.ingredient_name, 120)).filter(Boolean).slice(0, 80),
    ingredients: ingredients.slice(0, 80).map(item => ({
      ingredient_name: safeText(item?.ingredient_name, 120),
      quantity_oz: numberOrNull(item?.quantity_oz),
      unit: safeText(item?.unit, 40),
      has_notes: Boolean(safeText(item?.notes, 80)),
    })).filter(item => item.ingredient_name),
    field_compatibility_status: recipe?.product_name && Array.isArray(recipe?.ingredients) ? 'compatible' : 'schema_gap',
    incompatibilities: [
      !recipe?.product_name ? 'missing_product_name' : null,
      !Array.isArray(recipe?.ingredients) ? 'ingredients_not_array' : null,
    ].filter(Boolean),
  };
}

function summarizeBundle(bundle) {
  const components = Array.isArray(bundle?.components) ? bundle.components : [];
  return {
    id: safeId(bundle?.id),
    name: safeText(bundle?.bundle_name, 120),
    normalized_name: normalizeKey(bundle?.bundle_name) || null,
    is_active: bundle?.is_active !== false,
    fulfillment_count: numberOrNull(bundle?.fulfillment_count),
    component_count: components.length,
    component_names: components.map(item => safeText(item?.product_name, 120)).filter(Boolean).slice(0, 80),
    components: components.slice(0, 80).map(item => ({
      product_name: safeText(item?.product_name, 120),
      quantity: numberOrNull(item?.quantity),
    })).filter(item => item.product_name),
    field_compatibility_status: bundle?.bundle_name && Array.isArray(bundle?.components) ? 'compatible' : 'schema_gap',
    incompatibilities: [
      !bundle?.bundle_name ? 'missing_bundle_name' : null,
      !Array.isArray(bundle?.components) ? 'components_not_array' : null,
    ].filter(Boolean),
  };
}

function inventoryStatus(item) {
  const stock = numberOrNull(item?.stock) ?? 0;
  const reorder = numberOrNull(item?.reorder_point);
  if (stock <= 0) return 'out_of_stock';
  if (reorder !== null && reorder > 0 && stock <= reorder) return 'low';
  return 'ok';
}

function summarizeInventoryItem(item) {
  return {
    id: safeId(item?.id),
    name: safeText(item?.ingredient, 120),
    normalized_name: normalizeKey(item?.ingredient) || null,
    unit: safeText(item?.unit, 40),
    category: safeText(item?.category, 80),
    supplier: safeText(item?.supplier, 120),
    stock: numberOrNull(item?.stock),
    reorder_point: numberOrNull(item?.reorder_point),
    max_stock: numberOrNull(item?.max_stock),
    supplier_packaging_unit: safeText(item?.supplier_packaging_unit, 40),
    supplier_packaging_qty: safeText(item?.supplier_packaging_qty, 80),
    cost_per_unit_present: numberOrNull(item?.cost_per_unit) !== null,
    cost_per_supplier_unit_present: numberOrNull(item?.cost_per_supplier_unit) !== null,
    status: inventoryStatus(item),
    stock_is_live_state: true,
    field_compatibility_status: item?.ingredient && item?.unit && numberOrNull(item?.stock) !== null && numberOrNull(item?.reorder_point) !== null ? 'compatible' : 'schema_gap',
    incompatibilities: [
      !item?.ingredient ? 'missing_ingredient' : null,
      !item?.unit ? 'missing_unit' : null,
      numberOrNull(item?.stock) === null ? 'missing_stock_number' : null,
      numberOrNull(item?.reorder_point) === null ? 'missing_reorder_point_number' : null,
    ].filter(Boolean),
  };
}

function summarizeYield(item) {
  return {
    id: safeId(item?.id),
    name: safeText(item?.ingredient_name, 120),
    normalized_name: normalizeKey(item?.ingredient_name) || null,
    purchase_unit: safeText(item?.purchase_unit, 40),
    oz_per_purchase_unit: numberOrNull(item?.oz_per_purchase_unit),
    trim_waste_factor: numberOrNull(item?.trim_waste_factor),
    units_per_case: numberOrNull(item?.units_per_case),
    split_case_allowed: item?.split_case_allowed === true,
    rounding_rule: safeText(item?.rounding_rule, 80),
    supplier: safeText(item?.supplier, 120),
    field_compatibility_status: item?.ingredient_name && item?.purchase_unit && numberOrNull(item?.oz_per_purchase_unit) !== null ? 'compatible' : 'schema_gap',
    incompatibilities: [
      !item?.ingredient_name ? 'missing_ingredient_name' : null,
      !item?.purchase_unit ? 'missing_purchase_unit' : null,
      numberOrNull(item?.oz_per_purchase_unit) === null ? 'missing_oz_per_purchase_unit_number' : null,
    ].filter(Boolean),
  };
}

function summarizeMatches(index, names, summarizer) {
  return names.map(name => {
    const matches = findMatches(index, name);
    return {
      requested_name: safeText(name, 120),
      normalized_name: normalizeKey(name) || null,
      status: matchStatus(matches),
      count: matches.length,
      matches: matches.slice(0, 5).map(summarizer),
    };
  });
}

function ingredientNamesFromRecipes(recipes) {
  const names = new Set();
  for (const recipe of recipes || []) {
    for (const item of recipe?.ingredients || []) {
      const ingredientName = safeText(item?.ingredient_name, 120);
      if (ingredientName) names.add(ingredientName);
    }
  }
  return [...names];
}

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return Response.json({ success: false, error_code: 'unauthorized', message: 'Missing or invalid Authorization header' }, { status: 401 });
    }
    const token = authHeader.slice(7);
    if (!SYNC_SECRET || token !== SYNC_SECRET) {
      return Response.json({ success: false, error_code: 'unauthorized', message: 'Unauthorized' }, { status: 401 });
    }
    if (req.method !== 'GET') {
      return Response.json({ success: false, error_code: 'method_not_allowed', message: 'GET required' }, { status: 405 });
    }

    const url = new URL(req.url);
    const requestedNames = parseNames(url.searchParams.get('names'));
    const base44 = createClientFromRequest(req);
    const [recipes, bundles, inventoryItems, ingredientYields] = await Promise.all([
      base44.asServiceRole.entities.Recipe.list('-updated_date', QUERY_LIMIT),
      base44.asServiceRole.entities.Bundle.list('-updated_date', QUERY_LIMIT),
      base44.asServiceRole.entities.InventoryItem.list('-updated_date', QUERY_LIMIT),
      base44.asServiceRole.entities.IngredientYield.list('-updated_date', QUERY_LIMIT),
    ]);

    const recipeIndex = buildIndex(recipes, row => row?.product_name);
    const bundleIndex = buildIndex(bundles, row => row?.bundle_name);
    const inventoryIndex = buildIndex(inventoryItems, row => row?.ingredient);
    const yieldIndex = buildIndex(ingredientYields, row => row?.ingredient_name);

    const directRecipeMatches = summarizeMatches(recipeIndex, requestedNames, summarizeRecipe);
    const directBundleMatches = summarizeMatches(bundleIndex, requestedNames, summarizeBundle);

    const matchedBundles = directBundleMatches.flatMap(row => row.matches || []);
    const componentNames = [...new Set(matchedBundles.flatMap(bundle => bundle.components || []).map(component => component.product_name).filter(Boolean))];
    const componentRecipeMatches = summarizeMatches(recipeIndex, componentNames, summarizeRecipe);
    const allMatchedRecipes = [
      ...directRecipeMatches.flatMap(row => row.matches || []),
      ...componentRecipeMatches.flatMap(row => row.matches || []),
    ];
    const ingredientNames = ingredientNamesFromRecipes(allMatchedRecipes);

    return Response.json({
      success: true,
      dry_run: true,
      function_name: 'getProductionMasterDataParityForCustomerApp',
      generated_at: new Date().toISOString(),
      requested_names: requestedNames,
      counts: {
        recipe_count: (recipes || []).length,
        bundle_count: (bundles || []).length,
        inventory_item_count: (inventoryItems || []).length,
        ingredient_yield_count: (ingredientYields || []).length,
      },
      truncated: Boolean(
        (recipes || []).length >= QUERY_LIMIT ||
        (bundles || []).length >= QUERY_LIMIT ||
        (inventoryItems || []).length >= QUERY_LIMIT ||
        (ingredientYields || []).length >= QUERY_LIMIT
      ),
      recipe_matches: directRecipeMatches,
      bundle_matches: directBundleMatches,
      component_recipe_matches: componentRecipeMatches,
      inventory_matches: summarizeMatches(inventoryIndex, ingredientNames, summarizeInventoryItem),
      yield_matches: summarizeMatches(yieldIndex, ingredientNames, summarizeYield),
      safety: {
        dry_run_only: true,
        writes_performed: false,
        master_data_imported: false,
        production_batches_created: false,
        inventory_deducted: false,
        purchase_orders_created: false,
        provider_calls_performed: false,
        notifications_sent: false,
      },
    });
  } catch (error) {
    console.error(`[PRODUCTION-MASTER-DATA-PARITY] Error: ${error?.message || 'unknown'}`);
    return Response.json({
      success: false,
      dry_run: true,
      error_code: 'hub_production_master_data_parity_failed',
      message: 'Unable to load Hub production master data parity preview.',
      writes_performed: false,
    }, { status: 500 });
  }
});
