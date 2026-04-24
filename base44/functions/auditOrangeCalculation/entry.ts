import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Detailed audit of orange calculation to identify the 72 oranges error
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const [allYields, allRecipes, allInventory] = await Promise.all([
      base44.asServiceRole.entities.IngredientYield.list(),
      base44.asServiceRole.entities.Recipe.list(),
      base44.asServiceRole.entities.InventoryItem.list(),
    ]);

    // Find orange yield
    const orangeYield = allYields.find(y => 
      y.ingredient_name?.toLowerCase().trim() === 'orange'
    );

    // Find orange inventory
    const orangeInventory = allInventory.find(i => 
      i.ingredient?.toLowerCase().trim() === 'orange'
    );

    // Find all recipes that use orange
    const recipesWithOrange = allRecipes.filter(r => {
      if (!r.ingredients) return false;
      return r.ingredients.some(ing => 
        ing.ingredient_name?.toLowerCase().trim() === 'orange'
      );
    });

    // Test calculation with 13.7 oz shortage
    const shortfallOz = 13.7;
    const audit = {
      orangeYield,
      orangeInventory,
      recipesWithOrange: recipesWithOrange.map(r => ({
        product_name: r.product_name,
        ingredients: r.ingredients.filter(ing => 
          ing.ingredient_name?.toLowerCase().trim() === 'orange'
        ),
      })),
      test_calculation: {
        shortfall_oz: shortfallOz,
        yield_config: orangeYield ? {
          ingredient_name: orangeYield.ingredient_name,
          oz_per_purchase_unit: orangeYield.oz_per_purchase_unit,
          purchase_unit: orangeYield.purchase_unit,
          units_per_case: orangeYield.units_per_case,
          trim_waste_factor: orangeYield.trim_waste_factor,
          rounding_rule: orangeYield.rounding_rule,
          split_case_allowed: orangeYield.split_case_allowed,
        } : null,
      },
    };

    if (orangeYield) {
      const ozPerUnit = orangeYield.oz_per_purchase_unit;
      const wasteFactor = orangeYield.trim_waste_factor || 1.0;
      const adjustedShortfall = shortfallOz * wasteFactor;
      const unitsExact = adjustedShortfall / ozPerUnit;
      const unitsNeeded = Math.ceil(unitsExact);

      audit.test_calculation.steps = {
        step1_yield_per_orange: ozPerUnit,
        step2_waste_factor: wasteFactor,
        step3_adjusted_shortage: `${shortfallOz} oz × ${wasteFactor} = ${adjustedShortfall.toFixed(2)} oz`,
        step4_units_exact: `${adjustedShortfall.toFixed(2)} oz ÷ ${ozPerUnit} oz/orange = ${unitsExact.toFixed(2)} oranges`,
        step5_units_rounded: `ceil(${unitsExact.toFixed(2)}) = ${unitsNeeded} oranges`,
        final_recommendation: `${unitsNeeded} oranges (NOT 72)`,
      };

      // Also check if somehow units_per_case (72) is being used as yield
      const wrongCalculation = {
        if_units_per_case_used_as_yield: {
          units_per_case_value: orangeYield.units_per_case,
          wrong_calc: `${shortfallOz} oz ÷ ${orangeYield.units_per_case} = ${(shortfallOz / orangeYield.units_per_case).toFixed(2)} oranges`,
          note: 'This would be WRONG - units_per_case is case size, not yield',
        },
        if_inverted_divisor: {
          inverted: `${orangeYield.units_per_case} oz (case size) ÷ ${ozPerUnit} oz/orange = ${(orangeYield.units_per_case / ozPerUnit).toFixed(2)} oranges`,
          note: 'If divisor is inverted: 72 ÷ 3.5 = 20.6, not 72, so this is not it',
        },
        if_yield_accidentally_swapped: {
          if_yield_was_72_instead_of_3_5: `${shortfallOz} ÷ 72 = ${(shortfallOz / 72).toFixed(2)} oranges (wrong)`,
          if_yield_was_0_19_inverted: `${shortfallOz} ÷ 0.19 = ${(shortfallOz / 0.19).toFixed(2)} oranges (THIS GIVES ~72!)`,
          note: 'If oz_per_purchase_unit is inverted to 0.19 (i.e., 1/3.5 ≈ 0.286), would get wrong result',
        },
      };
      audit.test_calculation.possible_errors = wrongCalculation;
    }

    return Response.json({ success: true, audit });
  } catch (error) {
    console.error('[AUDIT_ORANGE]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});