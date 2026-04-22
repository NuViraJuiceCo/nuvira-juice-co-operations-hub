import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Conversion: 1 oz = 28.3495 grams
const OZ_TO_G = 28.3495;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { date_from, date_to, order_ids } = body;

    // 1. Fetch all active recipes
    const recipes = await base44.asServiceRole.entities.Recipe.list();
    if (!recipes || recipes.length === 0) {
      return Response.json({ error: 'No recipes found. Please add recipes first.' }, { status: 400 });
    }

    // Build a fast lookup map: product name (lowercase) -> recipe
    const recipeMap = {};
    for (const recipe of recipes) {
      if (recipe.is_active !== false) {
        recipeMap[recipe.product_name.toLowerCase().trim()] = recipe;
      }
    }

    // 2. Fetch orders - either by specific IDs or by date range
    let orders = [];
    if (order_ids && order_ids.length > 0) {
      orders = await base44.asServiceRole.entities.ShopifyOrder.list();
      orders = orders.filter(o => order_ids.includes(o.id));
    } else {
      orders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500);
      if (date_from || date_to) {
        orders = orders.filter(o => {
          const orderDate = new Date(o.requested_delivery_date || o.created_date);
          const from = date_from ? new Date(date_from) : null;
          const to = date_to ? new Date(date_to + 'T23:59:59') : null;
          if (from && orderDate < from) return false;
          if (to && orderDate > to) return false;
          return true;
        });
      }
    }

    // Filter to only active/unfulfilled orders
    const activeOrders = orders.filter(o =>
      !['fulfilled', 'canceled', 'refunded'].includes(o.production_status)
    );

    if (activeOrders.length === 0) {
      return Response.json({
        summary: { total_orders: 0, matched_orders: 0, unmatched_items: [] },
        ingredient_needs: [],
        orders_included: []
      });
    }

    // 3. Aggregate ingredient needs across all orders
    const ingredientTotals = {}; // { ingredient_name: { quantity_oz, quantity_g, unit } }
    const unmatchedItems = new Set();
    const bottleCounts = {}; // { product_name: total_bottles }
    let matchedOrders = 0;

    for (const order of activeOrders) {
      if (!order.line_items || order.line_items.length === 0) continue;

      let orderMatched = false;
      for (const item of order.line_items) {
        const itemTitle = (item.title || '').toLowerCase().trim();
        const qty = item.quantity || 1;

        // Try to find matching recipe
        let recipe = null;
        for (const [key, rec] of Object.entries(recipeMap)) {
          if (itemTitle.includes(key) || key.includes(itemTitle)) {
            recipe = rec;
            break;
          }
        }

        if (!recipe) {
          unmatchedItems.add(item.title);
          continue;
        }

        orderMatched = true;
        const yieldFactor = recipe.yield_factor || 1.05;
        bottleCounts[recipe.product_name] = (bottleCounts[recipe.product_name] || 0) + qty;

        for (const ing of (recipe.ingredients || [])) {
          const name = ing.ingredient_name;
          const ingQtyOz = (ing.quantity_oz || 0) * qty * yieldFactor;
          const ingQtyG = ingQtyOz * OZ_TO_G;

          if (!ingredientTotals[name]) {
            ingredientTotals[name] = { quantity_oz: 0, quantity_g: 0, unit: ing.unit || 'oz' };
          }
          ingredientTotals[name].quantity_oz += ingQtyOz;
          ingredientTotals[name].quantity_g += ingQtyG;
        }
      }

      if (orderMatched) matchedOrders++;
    }

    // 4. Fetch current inventory to compare
    const inventory = await base44.asServiceRole.entities.InventoryItem.list();
    const inventoryMap = {};
    for (const inv of inventory) {
      inventoryMap[(inv.ingredient || '').toLowerCase().trim()] = inv;
    }

    // 5. Build final ingredient needs report
    const ingredientNeeds = Object.entries(ingredientTotals).map(([name, totals]) => {
      const invItem = inventoryMap[name.toLowerCase().trim()];
      const currentStockOz = invItem
        ? (invItem.unit === 'kg' ? invItem.stock * 35.274
          : invItem.unit === 'g' ? invItem.stock / OZ_TO_G
          : invItem.unit === 'L' ? invItem.stock * 33.814
          : invItem.stock)
        : 0;

      const neededOz = totals.quantity_oz;
      const shortfallOz = Math.max(0, neededOz - currentStockOz);
      const status = shortfallOz === 0
        ? (currentStockOz > neededOz * 1.5 ? 'surplus' : 'sufficient')
        : 'purchase_needed';

      return {
        ingredient: name,
        needed_oz: Math.round(neededOz * 100) / 100,
        needed_g: Math.round(totals.quantity_g * 100) / 100,
        needed_lbs: Math.round((neededOz / 16) * 100) / 100,
        current_stock_oz: Math.round(currentStockOz * 100) / 100,
        shortfall_oz: Math.round(shortfallOz * 100) / 100,
        shortfall_lbs: Math.round((shortfallOz / 16) * 100) / 100,
        status,
        inventory_unit: invItem?.unit || 'oz',
        inventory_id: invItem?.id || null
      };
    });

    // Sort: purchase_needed first, then sufficient, then surplus
    ingredientNeeds.sort((a, b) => {
      const order = { purchase_needed: 0, sufficient: 1, surplus: 2 };
      return (order[a.status] ?? 3) - (order[b.status] ?? 3);
    });

    return Response.json({
      summary: {
        total_orders: activeOrders.length,
        matched_orders: matchedOrders,
        unmatched_items: Array.from(unmatchedItems),
        bottle_counts: bottleCounts,
        date_from: date_from || null,
        date_to: date_to || null
      },
      ingredient_needs: ingredientNeeds,
      orders_included: activeOrders.map(o => ({
        id: o.id,
        order_number: o.shopify_order_number,
        delivery_date: o.requested_delivery_date || o.assigned_delivery_date,
        status: o.production_status
      }))
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});