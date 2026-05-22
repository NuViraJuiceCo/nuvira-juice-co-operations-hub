import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const CHICAGO_TZ = 'America/Chicago';
const MAX_RANGE_DAYS = 31;
const DEFAULT_PRESET = 'next_7_days';
const BATCH_QUERY_LIMIT = 1000;
const RECIPE_QUERY_LIMIT = 500;
const INVENTORY_QUERY_LIMIT = 500;
const YIELD_QUERY_LIMIT = 500;
const SAFE_TEXT_LIMIT = 120;
const OZ_TO_G = 28.3495;
const STATUS_SEVERITY = {
  short: 0,
  low: 1,
  no_data: 2,
  covered: 3,
};

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

function safeText(value, maxLength = SAFE_TEXT_LIMIT) {
  const text = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]');

  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
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

function dayOfWeek(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
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

  if (preset && !['today', 'this_week', 'next_7_days'].includes(preset)) {
    throw new Error('preset must be one of today, this_week, next_7_days');
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
  if (effectivePreset === 'this_week') {
    const mondayOffset = dayOfWeek(today) === 0 ? -6 : 1 - dayOfWeek(today);
    const monday = addDays(today, mondayOffset);
    return { dateFrom: monday, dateTo: addDays(monday, 6) };
  }
  return { dateFrom: today, dateTo: addDays(today, 6) };
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundTenth(value) {
  return Math.round(numberOrZero(value) * 10) / 10;
}

function datePart(value) {
  return normalizeText(value).slice(0, 10);
}

function convertStockToOz(stock, unit) {
  const amount = Number(stock);
  if (!Number.isFinite(amount)) return null;

  switch (normalizeLower(unit)) {
    case 'oz':
      return amount;
    case 'g':
      return amount / OZ_TO_G;
    case 'kg':
      return (amount * 1000) / OZ_TO_G;
    case 'lbs':
    case 'lb':
      return amount * 16;
    case 'l':
      return amount * 33.814;
    case 'ml':
      return amount / 29.5735;
    default:
      return amount;
  }
}

function shouldIncludeBatch(batch, dateFrom, dateTo) {
  const productionDate = datePart(batch.production_date);
  if (!productionDate || productionDate < dateFrom || productionDate > dateTo) return false;

  const status = normalizeLower(batch.status);
  return !['archived', 'cancelled', 'canceled', 'void'].includes(status);
}

function productGroupKey(batch) {
  return `${normalizeKey(batch.product_name)}__${normalizeLower(batch.product_category)}`;
}

function buildProductGroups(batches) {
  const groups = new Map();

  for (const batch of batches) {
    const key = productGroupKey(batch);
    const existing = groups.get(key) || {
      product_name: safeText(batch.product_name),
      product_category: safeText(batch.product_category, 60),
      planned_units: 0,
      produced_units: 0,
      batch_count: 0,
    };

    existing.planned_units += numberOrZero(batch.planned_units);
    existing.produced_units += numberOrZero(batch.actual_units);
    existing.batch_count += 1;
    groups.set(key, existing);
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      planned_units: roundTenth(group.planned_units),
      produced_units: roundTenth(group.produced_units),
    }))
    .sort((a, b) => (a.product_name || '').localeCompare(b.product_name || ''));
}

function computeIngredientStatus(requiredOz, availableOz) {
  if (availableOz === null) return 'no_data';
  if (availableOz < requiredOz) return 'short';
  if (requiredOz > 0 && availableOz <= requiredOz * 1.25) return 'low';
  return 'covered';
}

function emptyIngredientAggregate(name, unit) {
  return {
    ingredient: safeText(name),
    unit: safeText(unit || 'oz', 40),
    requiredOz: 0,
    sourceProducts: new Set(),
    productionDates: new Set(),
  };
}

function addIngredientDemand(targetMap, recipe, batch, productionDate) {
  const units = numberOrZero(batch.planned_units);
  if (units <= 0) return;

  const yieldFactor = numberOrZero(recipe.yield_factor) || 1;
  for (const ingredient of recipe.ingredients || []) {
    const ingredientName = normalizeText(ingredient.ingredient_name);
    if (!ingredientName) continue;

    const key = normalizeKey(ingredientName);
    const existing = targetMap.get(key) || emptyIngredientAggregate(ingredientName, ingredient.unit);
    const perUnitOz = numberOrZero(ingredient.quantity_oz);
    existing.requiredOz += perUnitOz * units * yieldFactor;
    if (batch.product_name) existing.sourceProducts.add(safeText(batch.product_name));
    if (productionDate) existing.productionDates.add(productionDate);
    targetMap.set(key, existing);
  }
}

function sanitizeIngredientAggregate(aggregate, inventoryMap, yieldMap) {
  const key = normalizeKey(aggregate.ingredient);
  const inventory = inventoryMap.get(key);
  const availableStock = inventory ? convertStockToOz(inventory.stock, inventory.unit) : null;
  const requiredQuantity = roundTenth(aggregate.requiredOz);
  const shortageAmount = availableStock === null ? requiredQuantity : roundTenth(Math.max(0, aggregate.requiredOz - availableStock));
  const status = computeIngredientStatus(aggregate.requiredOz, availableStock);

  return {
    ingredient: aggregate.ingredient,
    unit: aggregate.unit || 'oz',
    required_quantity: requiredQuantity,
    available_stock: availableStock === null ? null : roundTenth(availableStock),
    shortage_amount: shortageAmount,
    status,
    source_products: [...aggregate.sourceProducts].filter(Boolean).sort(),
    production_dates: [...aggregate.productionDates].filter(Boolean).sort(),
    missing_yield: status === 'short' && !yieldMap.has(key),
  };
}

function publicIngredientRow(row) {
  return {
    ingredient: row.ingredient,
    unit: row.unit,
    required_quantity: row.required_quantity,
    available_stock: row.available_stock,
    shortage_amount: row.shortage_amount,
    status: row.status,
    source_products: row.source_products,
    production_dates: row.production_dates,
  };
}

function sortIngredients(a, b) {
  const byStatus = (STATUS_SEVERITY[a.status] ?? 9) - (STATUS_SEVERITY[b.status] ?? 9);
  if (byStatus !== 0) return byStatus;
  return (a.ingredient || '').localeCompare(b.ingredient || '');
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
      const range = resolveDateRange(url);
      dateFrom = range.dateFrom;
      dateTo = range.dateTo;
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
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
      batchRows,
      recipeRows,
      inventoryRows,
      yieldRows,
    ] = await Promise.all([
      base44.asServiceRole.entities.ProductionBatch.list('-production_date', BATCH_QUERY_LIMIT),
      base44.asServiceRole.entities.Recipe.list('-updated_date', RECIPE_QUERY_LIMIT),
      base44.asServiceRole.entities.InventoryItem.list('-updated_date', INVENTORY_QUERY_LIMIT),
      base44.asServiceRole.entities.IngredientYield.list('-updated_date', YIELD_QUERY_LIMIT),
    ]);

    const truncated = Boolean(
      (batchRows || []).length >= BATCH_QUERY_LIMIT ||
      (recipeRows || []).length >= RECIPE_QUERY_LIMIT ||
      (inventoryRows || []).length >= INVENTORY_QUERY_LIMIT ||
      (yieldRows || []).length >= YIELD_QUERY_LIMIT
    );

    const recipeMap = new Map();
    for (const recipe of recipeRows || []) {
      if (recipe?.is_active === false) continue;
      const key = normalizeKey(recipe.product_name);
      if (key) recipeMap.set(key, recipe);
    }

    const inventoryMap = new Map();
    for (const item of inventoryRows || []) {
      const key = normalizeKey(item.ingredient);
      if (key) inventoryMap.set(key, item);
    }

    const yieldMap = new Map();
    for (const item of yieldRows || []) {
      const key = normalizeKey(item.ingredient_name);
      if (key) yieldMap.set(key, true);
    }

    const batches = (batchRows || []).filter(batch => shouldIncludeBatch(batch, dateFrom, dateTo));
    const batchesByDate = new Map();
    const globalIngredients = new Map();
    const missingRecipes = new Set();

    for (const batch of batches) {
      const productionDate = datePart(batch.production_date);
      if (!batchesByDate.has(productionDate)) batchesByDate.set(productionDate, []);
      batchesByDate.get(productionDate).push(batch);

      const recipe = recipeMap.get(normalizeKey(batch.product_name));
      if (!recipe || !Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
        if (batch.product_name) missingRecipes.add(safeText(batch.product_name));
        continue;
      }

      addIngredientDemand(globalIngredients, recipe, batch, productionDate);
    }

    const ingredients = [...globalIngredients.values()]
      .map(aggregate => sanitizeIngredientAggregate(aggregate, inventoryMap, yieldMap))
      .sort(sortIngredients);

    const publicIngredients = ingredients.map(publicIngredientRow);
    const dates = [...batchesByDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([productionDate, dateBatches]) => {
        const dateIngredients = ingredients.filter(row => row.production_dates.includes(productionDate));
        return {
          production_date: productionDate,
          batch_count: dateBatches.length,
          planned_units: roundTenth(dateBatches.reduce((sum, batch) => sum + numberOrZero(batch.planned_units), 0)),
          produced_units: roundTenth(dateBatches.reduce((sum, batch) => sum + numberOrZero(batch.actual_units), 0)),
          product_groups: buildProductGroups(dateBatches),
          ingredient_count: dateIngredients.length,
          shortage_count: dateIngredients.filter(row => row.status === 'short').length,
        };
      });

    console.log(`[PRODUCTION-PLANNING-SUMMARY] date_from=${dateFrom} date_to=${dateTo} batches=${batches.length} truncated=${truncated}`);

    return Response.json({
      success: true,
      date_from: dateFrom,
      date_to: dateTo,
      generated_at: new Date().toISOString(),
      summary: {
        production_date_count: dates.length,
        batch_count: batches.length,
        planned_units: roundTenth(batches.reduce((sum, batch) => sum + numberOrZero(batch.planned_units), 0)),
        produced_units: roundTenth(batches.reduce((sum, batch) => sum + numberOrZero(batch.actual_units), 0)),
        ingredient_count: publicIngredients.length,
        shortage_count: publicIngredients.filter(row => row.status === 'short').length,
        missing_recipe_count: missingRecipes.size,
        missing_yield_count: ingredients.filter(row => row.missing_yield).length,
      },
      dates,
      ingredients: publicIngredients,
      truncated,
    });
  } catch (error) {
    console.error('[PRODUCTION-PLANNING-SUMMARY] Error:', error.message);
    return Response.json({ error: 'Unable to load production planning summary' }, { status: 500 });
  }
});
