import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all products and recipes
    const [products, recipes, bundles] = await Promise.all([
      base44.asServiceRole.entities.Product.list('-updated_date', 100),
      base44.asServiceRole.entities.Recipe.list('-updated_date', 100),
      base44.asServiceRole.entities.Bundle.list('-updated_date', 100),
    ]);

    if (!Array.isArray(products) || products.length === 0) {
      return Response.json({ status: 'success', synced: 0, message: 'No products to sync' });
    }

    // Build product name lookup
    const productNames = new Set();
    for (const p of products) {
      if (p.name) productNames.add(p.name);
    }

    // Validate recipes reference valid products
    const recipeResults = [];
    for (const recipe of (recipes || [])) {
      if (!recipe.ingredients || !Array.isArray(recipe.ingredients)) continue;
      
      let isDirty = false;
      const validIngredients = recipe.ingredients.filter(ing => {
        if (!ing.ingredient_name || !productNames.has(ing.ingredient_name)) {
          return false;
        }
        return true;
      });

      if (validIngredients.length !== recipe.ingredients.length) {
        isDirty = true;
        await base44.asServiceRole.entities.Recipe.update(recipe.id, {
          ...recipe,
          ingredients: validIngredients,
        });
      }
      recipeResults.push({
        recipe_id: recipe.id,
        product_name: recipe.product_name,
        valid_ingredients: validIngredients.length,
        total_ingredients: recipe.ingredients.length,
      });
    }

    // Validate bundles reference valid recipes
    const bundleResults = [];
    for (const bundle of (bundles || [])) {
      if (!bundle.components || !Array.isArray(bundle.components)) continue;

      let isDirty = false;
      const validComponents = bundle.components.filter(comp => {
        if (!comp.product_name) return false;
        const recipe = recipes.find(r => r.product_name === comp.product_name);
        return recipe !== undefined;
      });

      if (validComponents.length !== bundle.components.length) {
        isDirty = true;
        await base44.asServiceRole.entities.Bundle.update(bundle.id, {
          ...bundle,
          components: validComponents,
        });
      }
      bundleResults.push({
        bundle_id: bundle.id,
        bundle_name: bundle.bundle_name,
        valid_components: validComponents.length,
        total_components: bundle.components.length,
      });
    }

    console.log('[SYNC-PRODUCT-INGREDIENTS] Completed validation');
    return Response.json({
      status: 'success',
      products_count: products.length,
      recipes: recipeResults,
      bundles: bundleResults,
    });
  } catch (error) {
    console.error('[SYNC-PRODUCT-INGREDIENTS] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});