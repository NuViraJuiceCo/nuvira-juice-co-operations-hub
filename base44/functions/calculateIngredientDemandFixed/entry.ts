import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * REBUILT INGREDIENT DEMAND CALCULATION WITH 5-LAYER SYSTEM
 * 
 * Layer 1: Product/Recipe Demand - gather batch totals per date, apply recipes
 * Layer 2: Base Unit Normalization - convert all demands to consistent base units
 * Layer 3: Usable Yield Conversion - convert usable demand to purchase units
 * Layer 4: Case/Pack Conversion - convert purchase units to supplier cases
 * Layer 5: Stock + Shortage Logic - subtract inventory, calculate shortages
 * 
 * Each layer has explicit validation and flags suspicious outputs.
 */

const OZ_TO_G = 28.3495;

function normalizeProductName(name) {
  if (!name) return '';
  return name.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

function normalizeIngredientName(name) {
  if (!name) return '';
  return name.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

/**
 * LAYER 2: Convert stock to base oz for comparison
 */
function convertStockToBaseOz(stock, unit) {
  if (!stock || stock <= 0 || !unit) return 0;
  const u = (unit || '').toLowerCase().trim();
  switch (u) {
    case 'oz': case 'fl oz': return stock;
    case 'g': return stock / OZ_TO_G;
    case 'kg': return (stock * 1000) / OZ_TO_G;
    case 'lbs': case 'lb': return stock * 16;
    case 'l': case 'liter': return stock * 33.814;
    case 'ml': case 'milliliter': return stock / 29.5735;
    default: return null; // unknown unit, flag as missing data
  }
}

/**
 * LAYER 3+4+5: Core yield conversion with validation
 * 
 * Input: shortfall in base oz, yield config, ingredient context
 * Output: purchase recommendation with validation flags
 * 
 * FORMULA (correct direction):
 * purchase_units_needed = shortfall_oz / oz_per_purchase_unit
 * 
 * Then apply waste factor to account for trim/loss in the opposite direction:
 * Actually required (before trim) = shortfall_oz * waste_factor
 * So: units_needed = (shortfall_oz * waste_factor) / oz_per_purchase_unit
 */
function computePurchaseWithValidation(shortfallOz, yieldConfig, ingredientName) {
  const result = {
    has_yield_data: false,
    units_exact: null,
    units_needed: null,
    cases_exact: null,
    cases_needed: null,
    validation_flags: [],
  };

  if (!yieldConfig) {
    result.validation_flags.push('MISSING_YIELD_DATA');
    return result;
  }

  const ozPerUnit = yieldConfig.oz_per_purchase_unit;
  if (!ozPerUnit || ozPerUnit <= 0) {
    result.validation_flags.push('INVALID_YIELD_VALUE');
    return result;
  }

  // Layer 5: Account for trim/waste before division
  const wasteFactor = Math.max(1, yieldConfig.trim_waste_factor || 1.0);
  const adjustedShortfall = shortfallOz * wasteFactor;
  const unitsExact = adjustedShortfall / ozPerUnit;

  result.has_yield_data = true;
  result.oz_per_unit = ozPerUnit;
  result.trim_waste_factor = wasteFactor;
  result.units_exact = Math.round(unitsExact * 1000) / 1000;
  result.purchase_unit = yieldConfig.purchase_unit;
  result.units_per_case = yieldConfig.units_per_case || null;

  // Layer 4: Case conversion
  const rounding = yieldConfig.rounding_rule || 'round_up_unit';
  const splitAllowed = yieldConfig.split_case_allowed !== false;
  const unitsPerCase = yieldConfig.units_per_case;

  if (rounding === 'exact') {
    result.units_needed = Math.round(unitsExact * 10) / 10;
  } else {
    result.units_needed = Math.ceil(unitsExact);
  }

  // Case math
  if (unitsPerCase && unitsPerCase > 0) {
    result.cases_exact = Math.round((result.units_needed / unitsPerCase) * 1000) / 1000;
    
    if (rounding === 'round_up_case') {
      result.cases_needed = Math.ceil(result.cases_exact);
      result.units_needed = result.cases_needed * unitsPerCase;
    } else if (splitAllowed) {
      result.cases_needed = Math.round(result.cases_exact * 10) / 10;
    } else {
      result.cases_needed = Math.ceil(result.cases_exact);
      result.units_needed = result.cases_needed * unitsPerCase;
    }
  }

  // VALIDATION: Sanity check the math
  // If units_needed is much larger than shortfall_oz, the divisor is probably inverted
  if (result.units_needed && shortfallOz > 0) {
    const ratio = result.units_needed / shortfallOz;
    if (ratio > 5) {
      result.validation_flags.push('HIGH_RATIO_UNITS_TO_OZ_NEEDS_REVIEW');
    }
    if (ratio > 100) {
      result.validation_flags.push('SUSPICIOUS_RATIO_UNITS_TO_OZ');
    }
  }

  // Check if oz_per_unit seems wrong
  if (ozPerUnit > 1000) {
    result.validation_flags.push('YIELD_VALUE_UNUSUALLY_HIGH');
  }

  return result;
}

/**
 * LAYER 1: Aggregate ingredient demand from batches on a single production date
 * Strictly isolated to that date only
 */
function calculateDemandForDate(date, batchesForDate, recipeMap, yieldMap) {
  const ingredientDemand = {};
  const missingRecipes = [];

  for (const batch of batchesForDate) {
    const normalizedProduct = normalizeProductName(batch.product_name);
    const recipe = recipeMap[normalizedProduct];
    const units = batch.planned_units || 0;

    if (!units || units <= 0) continue;

    if (!recipe) {
      missingRecipes.push(batch.product_name);
      continue;
    }

    if (!recipe.ingredients || recipe.ingredients.length === 0) {
      missingRecipes.push(`${batch.product_name} (no ingredients)`);
      continue;
    }

    const recipeYieldFactor = recipe.yield_factor || 1.05;

    // For each ingredient in the recipe, multiply by units and accumulate
    for (const ingredient of recipe.ingredients) {
      const ingNormalized = normalizeIngredientName(ingredient.ingredient_name);
      const qtyPerUnit = ingredient.quantity_oz || 0;

      if (qtyPerUnit <= 0) continue;

      const totalQty = qtyPerUnit * recipeYieldFactor * units;

      if (!ingredientDemand[ingNormalized]) {
        ingredientDemand[ingNormalized] = {
          name: ingredient.ingredient_name,
          base_unit: 'oz',
          demand_oz: 0,
          sources: [],
        };
      }

      ingredientDemand[ingNormalized].demand_oz += totalQty;
      ingredientDemand[ingNormalized].sources.push({
        product_name: batch.product_name,
        batch_units: units,
        ingredient_oz: totalQty,
      });
    }
  }

  return { ingredientDemand, missingRecipes };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body = {};
    try { body = await req.json(); } catch {}
    const { date_from, date_to } = body;

    const today = new Date().toISOString().split('T')[0];

    // Load all data
    const [allBatches, allRecipes, allInventory, allYields] = await Promise.all([
      base44.asServiceRole.entities.ProductionBatch.list('production_date', 500),
      base44.asServiceRole.entities.Recipe.list(),
      base44.asServiceRole.entities.InventoryItem.list(),
      base44.asServiceRole.entities.IngredientYield.list(),
    ]);

    // Build lookups
    const recipeMap = {};
    for (const recipe of allRecipes) {
      if (recipe.is_active !== false) {
        recipeMap[normalizeProductName(recipe.product_name)] = recipe;
      }
    }

    const inventoryMap = {};
    for (const inv of allInventory) {
      inventoryMap[normalizeIngredientName(inv.ingredient)] = inv;
    }

    const yieldMap = {};
    for (const y of allYields) {
      yieldMap[normalizeIngredientName(y.ingredient_name)] = y;
    }

    // Filter to upcoming dates
    const upcomingBatches = allBatches.filter(b => {
      if (b.production_date < today) return false;
      if (b.status === 'Completed') return false;
      if (date_from && b.production_date < date_from) return false;
      if (date_to && b.production_date > date_to) return false;
      return true;
    });

    // Group by date
    const byDate = {};
    for (const batch of upcomingBatches) {
      if (!byDate[batch.production_date]) byDate[batch.production_date] = [];
      byDate[batch.production_date].push(batch);
    }

    const dateResults = [];

    // Process each date
    for (const [date, batchesForDate] of Object.entries(byDate)) {
      // LAYER 1: Calculate ingredient demand for this date only
      const { ingredientDemand, missingRecipes } = calculateDemandForDate(
        date,
        batchesForDate,
        recipeMap,
        yieldMap
      );

      // LAYER 2+3+4+5: Convert to purchase quantities with stock subtraction
      const ingredients = [];
      for (const [ingKey, demand] of Object.entries(ingredientDemand)) {
        const inv = inventoryMap[ingKey];
        const yieldConfig = yieldMap[ingKey];

        // Get stock in base oz
        const stockOz = inv ? convertStockToBaseOz(inv.stock, inv.unit) : null;
        const demandOz = demand.demand_oz;

        // Calculate shortage (Layer 5)
        let shortageOz = demandOz;
        let remainingOz = null;
        let status = 'no_stock_data';

        if (stockOz !== null) {
          shortageOz = Math.max(0, demandOz - stockOz);
          remainingOz = Math.max(0, stockOz - demandOz);
          
          if (shortageOz === 0) {
            status = stockOz > demandOz * 1.3 ? 'surplus' : 'sufficient';
          } else {
            status = 'purchase_needed';
          }
        }

        // Calculate purchase recommendation
        const purchase = (shortageOz > 0)
          ? computePurchaseWithValidation(shortageOz, yieldConfig, demand.name)
          : { has_yield_data: !!yieldConfig, validation_flags: [] };

        ingredients.push({
          ingredient_name: demand.name,
          base_unit: 'oz',
          demand_oz: Math.round(demandOz * 100) / 100,
          stock_oz: stockOz !== null ? Math.round(stockOz * 100) / 100 : null,
          shortage_oz: Math.round(shortageOz * 100) / 100,
          remaining_oz: remainingOz !== null ? Math.round(remainingOz * 100) / 100 : null,
          status,
          supplier: yieldConfig?.supplier || inv?.supplier || null,
          purchase,
          validation_flags: purchase.validation_flags || [],
          sources: demand.sources,
        });
      }

      // Sort by status
      const statusOrder = { purchase_needed: 0, no_stock_data: 1, sufficient: 2, surplus: 3 };
      ingredients.sort((a, b) => (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4));

      const totalBatchUnits = batchesForDate.reduce((s, b) => s + (b.planned_units || 0), 0);
      const hasWarnings = missingRecipes.length > 0 || 
                         ingredients.some(i => i.validation_flags.length > 0 || i.status === 'no_stock_data');

      dateResults.push({
        date,
        batches: batchesForDate.map(b => ({
          id: b.id,
          product_name: b.product_name,
          planned_units: b.planned_units,
          product_category: b.product_category,
        })),
        total_units: totalBatchUnits,
        ingredients,
        missing_recipes: [...new Set(missingRecipes)],
        has_warnings: hasWarnings,
      });
    }

    dateResults.sort((a, b) => a.date.localeCompare(b.date));
    return Response.json({ success: true, dates: dateResults });
  } catch (error) {
    console.error('[INGREDIENT_DEMAND_FIXED]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});