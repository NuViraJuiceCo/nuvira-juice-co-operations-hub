import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all products
    const products = await base44.entities.Product.list('name', 100);
    const inventoryItems = await base44.entities.InventoryItem.list('ingredient', 100);

    // Build a map of ingredients to their default settings
    const ingredientMap = new Map();

    // Extract all unique ingredients from products
    products.forEach(product => {
      if (product.ingredients && Array.isArray(product.ingredients)) {
        product.ingredients.forEach(ingredient => {
          if (!ingredientMap.has(ingredient)) {
            ingredientMap.set(ingredient, {
              ingredient: ingredient,
              category: 'Produce',
              stock: 0,
              unit: 'kg',
              reorder_point: 10,
              max_stock: 100,
              cost_per_unit: 0,
              supplier: '',
              location: '',
              notes: `Auto-synced from products: ${product.name}`
            });
          }
        });
      }
    });

    // Update or create inventory items
    const results = [];

    for (const [ingredientName, defaults] of ingredientMap) {
      const existing = inventoryItems.find(i => i.ingredient?.toLowerCase() === ingredientName.toLowerCase());

      if (existing) {
        // Update existing with synced notes
        await base44.entities.InventoryItem.update(existing.id, {
          notes: `Ingredient in: ${products.filter(p => p.ingredients?.includes(ingredientName)).map(p => p.name).join(', ')}`
        });
        results.push({ action: 'updated', ingredient: ingredientName, id: existing.id });
      } else {
        // Create new inventory item
        const created = await base44.entities.InventoryItem.create(defaults);
        results.push({ action: 'created', ingredient: ingredientName, id: created.id });
      }
    }

    return Response.json({
      success: true,
      message: `Synced ${results.length} ingredients from ${products.length} products`,
      results
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});