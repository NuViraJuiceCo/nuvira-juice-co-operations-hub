import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Calculates ingredient demand for each upcoming production date.
 * Applies Recipe ingredient mappings, compares to InventoryItem stock,
 * and converts demand into practical purchase quantities using IngredientYield data.
 */

const OZ_TO_G = 28.3495;

function convertStockToOz(stock, unit) {
  if (!stock || !unit) return 0;
  switch ((unit || '').toLowerCase()) {
    case 'oz': return stock;
    case 'g': return stock / OZ_TO_G;
    case 'kg': return (stock * 1000) / OZ_TO_G;
    case 'lbs': return stock * 16;
    case 'l': return stock * 33.814;
    case 'ml': return stock / 29.5735;
    default: return stock;
  }
}

function normalizeProductName(name) {
  if (!name) return '';
  return name.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

/**
 * Given a shortfall in oz and a yield config, compute purchase recommendation.
 * Returns { units_needed, units_exact, cases_needed, cases_exact, has_yield_data }
 */
function computePurchaseQty(shortfallOz, yieldConfig) {
  if (!yieldConfig || !yieldConfig.oz_per_purchase_unit) {
    return { has_yield_data: false };
  }

  const ozPerUnit = yieldConfig.oz_per_purchase_unit;
  const wasteFactor = yieldConfig.trim_waste_factor || 1.0;
  const unitsPerCase = yieldConfig.units_per_case || null;
  const rounding = yieldConfig.rounding_rule || 'round_up_unit';
  const splitAllowed = yieldConfig.split_case_allowed !== false;

  // Account for trim/waste: need more raw product to get the required usable oz
  const adjustedShortfall = shortfallOz * wasteFactor;
  const unitsExact = adjustedShortfall / ozPerUnit;

  let unitsNeeded;
  if (rounding === 'exact') {
    unitsNeeded = Math.round(unitsExact * 10) / 10;
  } else {
    unitsNeeded = Math.ceil(unitsExact);
  }

  let casesExact = null;
  let casesNeeded = null;

  if (unitsPerCase) {
    casesExact = unitsNeeded / unitsPerCase;
    if (rounding === 'round_up_case') {
      casesNeeded = Math.ceil(casesExact);
      unitsNeeded = casesNeeded * unitsPerCase; // snap to full case
    } else if (splitAllowed) {
      casesNeeded = Math.round(casesExact * 10) / 10; // allow partial case
    } else {
      casesNeeded = Math.ceil(casesExact); // must buy full cases
      unitsNeeded = casesNeeded * unitsPerCase;
    }
  }

  return {
    has_yield_data: true,
    purchase_unit: yieldConfig.purchase_unit,
    oz_per_unit: ozPerUnit,
    trim_waste_factor: wasteFactor,
    units_exact: Math.round(unitsExact * 100) / 100,
    units_needed: unitsNeeded,
    units_per_case: unitsPerCase,
    cases_exact: casesExact !== null ? Math.round(casesExact * 100) / 100 : null,
    cases_needed: casesNeeded,
    split_case_allowed: splitAllowed,
    rounding_rule: rounding,
  };
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

    // Load all data in parallel
    const [allBatches, allRecipes, allInventory, allYields] = await Promise.all([
      base44.asServiceRole.entities.ProductionBatch.list('production_date', 500),
      base44.asServiceRole.entities.Recipe.list(),
      base44.asServiceRole.entities.InventoryItem.list(),
      base44.asServiceRole.entities.IngredientYield.list(),
    ]);

    // Build recipe lookup
    const recipeMap = {};
    for (const recipe of allRecipes) {
      if (recipe.is_active !== false) {
        recipeMap[normalizeProductName(recipe.product_name)] = recipe;
      }
    }

    // Build inventory lookup
    const inventoryMap = {};
    for (const inv of allInventory) {
      inventoryMap[normalizeProductName(inv.ingredient)] = inv;
    }

    // Build yield lookup: normalized ingredient name -> yield config
    const yieldMap = {};
    for (const y of allYields) {
      yieldMap[normalizeProductName(y.ingredient_name)] = y;
    }

    // Filter batches to upcoming dates only
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

    for (const [date, batches] of Object.entries(byDate)) {
      const ingredientTotals = {};
      const missingRecipes = [];

      for (const batch of batches) {
        const normalizedProduct = normalizeProductName(batch.product_name);
        const recipe = recipeMap[normalizedProduct];
        const units = batch.planned_units || 0;

        if (!recipe) {
          missingRecipes.push(batch.product_name);
          continue;
        }

        if (!recipe.ingredients || recipe.ingredients.length === 0) {
          missingRecipes.push(`${batch.product_name} (no ingredients in recipe)`);
          continue;
        }

        const yieldFactor = recipe.yield_factor || 1.05;

        for (const ing of recipe.ingredients) {
          const ingKey = normalizeProductName(ing.ingredient_name);
          const ingQtyPerBottle = (ing.quantity_oz || 0) * yieldFactor;
          const totalQty = ingQtyPerBottle * units;

          if (!ingredientTotals[ingKey]) {
            ingredientTotals[ingKey] = {
              name: ing.ingredient_name,
              qty_oz: 0,
              unit: ing.unit || 'oz',
              sources: [],
            };
          }
          ingredientTotals[ingKey].qty_oz += totalQty;
          ingredientTotals[ingKey].sources.push({
            product: batch.product_name,
            batch_units: units,
            qty_oz: totalQty,
          });
        }
      }

      // Compare demand to stock + add purchase conversion
      const ingredients = [];
      for (const [ingKey, demand] of Object.entries(ingredientTotals)) {
        const inv = inventoryMap[ingKey];
        const yieldConfig = yieldMap[ingKey] || null;
        const stockOz = inv ? convertStockToOz(inv.stock, inv.unit) : null;
        const neededOz = demand.qty_oz;
        const shortfallOz = stockOz !== null ? Math.max(0, neededOz - stockOz) : neededOz;
        const remainingOz = stockOz !== null ? Math.max(0, stockOz - neededOz) : null;

        let status = 'no_stock_data';
        if (stockOz !== null) {
          if (shortfallOz === 0) {
            status = stockOz > neededOz * 1.3 ? 'surplus' : 'sufficient';
          } else {
            status = 'purchase_needed';
          }
        }

        // Purchase quantity conversion (only meaningful if there's a shortfall)
        const purchaseQty = (shortfallOz > 0)
          ? computePurchaseQty(shortfallOz, yieldConfig)
          : { has_yield_data: !!yieldConfig, purchase_unit: yieldConfig?.purchase_unit };

        ingredients.push({
          name: demand.name,
          unit: demand.unit,
          needed_oz: Math.round(neededOz * 10) / 10,
          needed_lbs: Math.round((neededOz / 16) * 100) / 100,
          stock_oz: stockOz !== null ? Math.round(stockOz * 10) / 10 : null,
          stock_lbs: stockOz !== null ? Math.round((stockOz / 16) * 100) / 100 : null,
          shortfall_oz: Math.round(shortfallOz * 10) / 10,
          shortfall_lbs: Math.round((shortfallOz / 16) * 100) / 100,
          remaining_oz: remainingOz !== null ? Math.round(remainingOz * 10) / 10 : null,
          status,
          inventory_item_id: inv?.id || null,
          supplier: yieldConfig?.supplier || inv?.supplier || null,
          purchase: purchaseQty,
          sources: demand.sources.map(s => ({
            product: s.product,
            batch_units: s.batch_units,
            qty_oz: Math.round(s.qty_oz * 10) / 10,
          })),
        });
      }

      // Sort: purchase_needed first, then no_stock_data, then sufficient, surplus
      const statusOrder = { purchase_needed: 0, no_stock_data: 1, sufficient: 2, surplus: 3 };
      ingredients.sort((a, b) => (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4));

      // Grocery list = only purchase_needed
      const groceryList = ingredients
        .filter(i => i.status === 'purchase_needed')
        .map(i => ({
          name: i.name,
          amount_oz: i.shortfall_oz,
          amount_lbs: i.shortfall_lbs,
          unit: i.unit,
          supplier: i.supplier,
          purchase: i.purchase,
        }));

      const totalBatchUnits = batches.reduce((s, b) => s + (b.planned_units || 0), 0);

      dateResults.push({
        date,
        batches: batches.map(b => ({ id: b.id, product_name: b.product_name, planned_units: b.planned_units, product_category: b.product_category })),
        total_units: totalBatchUnits,
        juice_units: batches.filter(b => b.product_category !== 'shot').reduce((s, b) => s + (b.planned_units || 0), 0),
        shot_units: batches.filter(b => b.product_category === 'shot').reduce((s, b) => s + (b.planned_units || 0), 0),
        ingredients,
        grocery_list: groceryList,
        missing_recipes: [...new Set(missingRecipes)],
        has_warnings: missingRecipes.length > 0 || ingredients.some(i => i.status === 'no_stock_data' || !i.purchase?.has_yield_data),
      });
    }

    dateResults.sort((a, b) => a.date.localeCompare(b.date));
    return Response.json({ success: true, dates: dateResults });
  } catch (error) {
    console.error('[INGREDIENT_DEMAND]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});