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

    // 1. Fetch all active recipes, bundles, and manual batches in parallel
    const [recipes, bundles, manualBatches] = await Promise.all([
      base44.asServiceRole.entities.Recipe.list(),
      base44.asServiceRole.entities.Bundle.list(),
      base44.asServiceRole.entities.ManualProductionBatch.list(),
    ]);

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

    // Build bundle lookup map: bundle name (lowercase) -> bundle
    const bundleMap = {};
    for (const bundle of (bundles || [])) {
      if (bundle.is_active !== false) {
        bundleMap[bundle.bundle_name.toLowerCase().trim()] = bundle;
      }
    }

    // 2. Fetch orders - either by specific IDs or by date range
    let orders = [];
    if (order_ids && order_ids.length > 0) {
      orders = await base44.asServiceRole.entities.ShopifyOrder.list();
      orders = orders.filter(o => order_ids.includes(o.id));
    } else {
      orders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500);
    }

    // ── Multi-guard production filter ─────────────────────────────────────────
    // Note: subscriptions with fulfillment_status=fulfilled may still have FUTURE
    // pending fulfillments — never exclude them on fulfillment_status alone.
    const isProductionVisible = (o) => {
      if (!o) return false;
      const tags = o.tags || [];
      if (tags.includes('refunded') || tags.includes('excluded') || tags.includes('do_not_sync') || tags.includes('not_for_production')) {
        console.log(`[CALC] Excluding ${o.shopify_order_number} — excluded tag`);
        return false;
      }
      if (o.sync_status === 'do_not_sync') {
        console.log(`[CALC] Excluding ${o.shopify_order_number} — sync_status=do_not_sync`);
        return false;
      }
      // Only exclude cancelled fulfillment_status for NON-subscription one-time orders
      const isSubscription = o.order_type === 'subscription' || o.source_channel === 'subscription';
      if (!isSubscription && (o.fulfillment_status === 'cancelled' || o.fulfillment_status === 'canceled')) {
        console.log(`[CALC] Excluding ${o.shopify_order_number} — fulfillment_status=cancelled (one-time)`);
        return false;
      }
      if (['fulfilled', 'canceled', 'refunded', 'excluded'].includes(o.production_status)) {
        console.log(`[CALC] Excluding ${o.shopify_order_number} — production_status=${o.production_status}`);
        return false;
      }
      if (o.data_quality_status === 'quarantined') {
        console.log(`[CALC] Excluding ${o.shopify_order_number} — data_quality_status=quarantined`);
        return false;
      }
      if (o.payment_status !== 'paid') {
        console.log(`[CALC] Excluding ${o.shopify_order_number} — payment_status=${o.payment_status}`);
        return false;
      }
      return true;
    };

    let activeOrders = orders.filter(isProductionVisible);

    // ── Date range filter ─────────────────────────────────────────────────────
    // For multi-delivery subscriptions, check if any fulfillment falls in range.
    // For one-time orders, check delivery date fields.
    if (date_from || date_to) {
      const from = date_from ? new Date(date_from) : null;
      const to = date_to ? new Date(date_to + 'T23:59:59') : null;
      activeOrders = activeOrders.filter(o => {
        const isSubscription = o.order_type === 'subscription' || o.source_channel === 'subscription';
        if (isSubscription && o.fulfillments && o.fulfillments.length > 0) {
          // Include if any pending fulfillment falls in the date range
          return o.fulfillments.some(f => {
            if (f.status === 'delivered') return false;
            const fDate = new Date(f.delivery_date || f.production_date);
            if (from && fDate < from) return false;
            if (to && fDate > to) return false;
            return true;
          });
        }
        // One-time: check canonical delivery date fields
        const orderDate = new Date(o.assigned_delivery_date || o.requested_delivery_date || o.selected_delivery_date || o.created_date);
        if (from && orderDate < from) return false;
        if (to && orderDate > to) return false;
        return true;
      });
    }

    console.log(`[CALC] Production-visible orders after date filter: ${activeOrders.length}`);

    // Filter active manual batches (optionally by production/use date)
    const activeManualBatches = (manualBatches || []).filter(b => {
      if (!b || b.status === 'cancelled' || b.status === 'draft' || b.status === 'produced') return false;
      if (date_from || date_to) {
        const bDate = new Date(b.production_date || b.use_date);
        const from = date_from ? new Date(date_from) : null;
        const to = date_to ? new Date(date_to + 'T23:59:59') : null;
        if (from && bDate < from) return false;
        if (to && bDate > to) return false;
      }
      return true;
    });

    if (activeOrders.length === 0 && activeManualBatches.length === 0) {
      return Response.json({
        summary: { total_orders: 0, matched_orders: 0, unmatched_items: [], manual_batch_count: 0 },
        ingredient_needs: [],
        orders_included: [],
        manual_batches_included: []
      });
    }

    // 3. Aggregate ingredient needs across all orders
    const ingredientTotals = {}; // { ingredient_name: { quantity_oz, quantity_g, unit } }
    const unmatchedItems = new Set();
    const bottleCounts = {}; // { product_name: total_bottles }
    const bundleCounts = {}; // { bundle_name: total_bundles }
    let matchedOrders = 0;

    for (const order of activeOrders) {
      if (!order.line_items || order.line_items.length === 0) continue;

      let orderMatched = false;
      for (const item of order.line_items) {
        const itemTitle = (item.title || '').toLowerCase().trim();
        const qty = item.quantity || 1;

        // Helper: accumulate ingredients for a single recipe + bottle count
        const addRecipeIngredients = (recipe, bottleQty) => {
          const yieldFactor = recipe.yield_factor || 1.05;
          bottleCounts[recipe.product_name] = (bottleCounts[recipe.product_name] || 0) + bottleQty;
          for (const ing of (recipe.ingredients || [])) {
            const ingName = ing.ingredient_name;
            const ingQtyOz = (ing.quantity_oz || 0) * bottleQty * yieldFactor;
            const ingQtyG = ingQtyOz * OZ_TO_G;
            if (!ingredientTotals[ingName]) {
              ingredientTotals[ingName] = { quantity_oz: 0, quantity_g: 0, unit: ing.unit || 'oz' };
            }
            ingredientTotals[ingName].quantity_oz += ingQtyOz;
            ingredientTotals[ingName].quantity_g += ingQtyG;
          }
        };

        // Try to find exact match or best match for bundle first
        let matchedBundle = null;
        let bestBundleMatch = null;
        let bestBundleScore = 0;
        
        for (const [key, bnd] of Object.entries(bundleMap)) {
          if (key === itemTitle) {
            matchedBundle = bnd;
            break;
          }
          // Score: higher if key is at start of itemTitle
          const score = itemTitle.startsWith(key) ? 2 : itemTitle.includes(key) ? 1 : 0;
          if (score > bestBundleScore) {
            bestBundleScore = score;
            bestBundleMatch = bnd;
          }
        }
        
        matchedBundle = matchedBundle || (bestBundleScore > 0 ? bestBundleMatch : null);

        if (matchedBundle) {
          // Expand bundle into component bottles
          orderMatched = true;
          bundleCounts[matchedBundle.bundle_name] = (bundleCounts[matchedBundle.bundle_name] || 0) + qty;
          for (const component of (matchedBundle.components || [])) {
            const componentRecipe = recipeMap[component.product_name.toLowerCase().trim()];
            if (componentRecipe) {
              addRecipeIngredients(componentRecipe, component.quantity * qty);
            }
          }
          continue;
        }

        // Try to find exact match or best match for single recipe
        let recipe = null;
        let bestRecipeMatch = null;
        let bestRecipeScore = 0;
        
        for (const [key, rec] of Object.entries(recipeMap)) {
          if (key === itemTitle) {
            recipe = rec;
            break;
          }
          const score = itemTitle.startsWith(key) ? 2 : itemTitle.includes(key) ? 1 : 0;
          if (score > bestRecipeScore) {
            bestRecipeScore = score;
            bestRecipeMatch = rec;
          }
        }
        
        recipe = recipe || (bestRecipeScore > 0 ? bestRecipeMatch : null);

        if (!recipe) {
          unmatchedItems.add(item.title);
          continue;
        }

        orderMatched = true;
        addRecipeIngredients(recipe, qty);
      }

      if (orderMatched) matchedOrders++;
    }

    // 3b. Accumulate manual batch ingredient needs
    for (const batch of activeManualBatches) {
      for (const item of (batch.items || [])) {
        const productKey = (item.product_name || '').toLowerCase().trim();
        const qty = item.quantity || 1;
        const recipe = recipeMap[productKey];
        if (!recipe) {
          unmatchedItems.add(item.product_name);
          continue;
        }
        const yieldFactor = recipe.yield_factor || 1.05;
        bottleCounts[recipe.product_name] = (bottleCounts[recipe.product_name] || 0) + qty;
        for (const ing of (recipe.ingredients || [])) {
          const ingName = ing.ingredient_name;
          const ingQtyOz = (ing.quantity_oz || 0) * qty * yieldFactor;
          const ingQtyG = ingQtyOz * OZ_TO_G;
          if (!ingredientTotals[ingName]) {
            ingredientTotals[ingName] = { quantity_oz: 0, quantity_g: 0, unit: ing.unit || 'oz' };
          }
          ingredientTotals[ingName].quantity_oz += ingQtyOz;
          ingredientTotals[ingName].quantity_g += ingQtyG;
        }
      }
    }

    // 4. Fetch current inventory to compare
    const inventory = await base44.asServiceRole.entities.InventoryItem.list();
    const inventoryMap = {};
    for (const inv of inventory) {
      inventoryMap[(inv.ingredient || '').toLowerCase().trim()] = inv;
    }

    // Helper: convert inventory stock to oz for comparison
    const convertToOz = (stock, unit) => {
      if (!unit) return stock;
      switch (unit.toLowerCase()) {
        case 'oz': return stock;
        case 'g': return stock / OZ_TO_G;
        case 'kg': return (stock * 1000) / OZ_TO_G;
        case 'lbs': return stock * 16;
        case 'l': return stock * 33.814;
        case 'ml': return stock / 29.5735;
        default: return stock;
      }
    };

    // 5. Helper: parse supplier packaging qty string (e.g., "40 lbs" -> 40)
    const parsePackagingQty = (pkgQty, pkgUnit) => {
      if (!pkgQty) return null;
      const match = pkgQty.match(/^\d+/);
      return match ? parseFloat(match[0]) : null;
    };

    // 6. Build final ingredient needs report
    const ingredientNeeds = Object.entries(ingredientTotals).map(([name, totals]) => {
      const invItem = inventoryMap[name.toLowerCase().trim()];
      const currentStockOz = invItem ? convertToOz(invItem.stock, invItem.unit) : 0;

      const neededOz = totals.quantity_oz;
      const shortfallOz = Math.max(0, neededOz - currentStockOz);
      const status = shortfallOz === 0
        ? (currentStockOz > neededOz * 1.5 ? 'surplus' : 'sufficient')
        : 'purchase_needed';

      // Calculate supplier cases needed (if packaging info exists)
      let casesNeeded = null;
      let casesNeededRounded = null;
      if (invItem?.supplier_packaging_qty && invItem?.supplier_packaging_unit) {
        const pkgQty = parsePackagingQty(invItem.supplier_packaging_qty, invItem.supplier_packaging_unit);
        if (pkgQty && invItem.weight_per_supplier_unit) {
          // If we know weight per unit, calculate total case weight
          // e.g., 4 melons × 13 lbs/melon = 52 lbs per case
          const totalWeightPerCase = pkgQty * invItem.weight_per_supplier_unit;
          const shortfallLbs = shortfallOz / 16;
          casesNeeded = shortfallLbs / totalWeightPerCase;
          casesNeededRounded = Math.ceil(casesNeeded);
        }
      }

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
        inventory_id: invItem?.id || null,
        supplier: invItem?.supplier || null,
        supplier_packaging_unit: invItem?.supplier_packaging_unit || null,
        supplier_packaging_qty: invItem?.supplier_packaging_qty || null,
        cost_per_supplier_unit: invItem?.cost_per_supplier_unit || null,
        cases_needed: casesNeeded ? Math.round(casesNeeded * 100) / 100 : null,
        cases_needed_rounded: casesNeededRounded
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
        manual_batch_count: activeManualBatches.length,
        matched_orders: matchedOrders,
        unmatched_items: Array.from(unmatchedItems),
        bottle_counts: bottleCounts,
        bundle_counts: bundleCounts,
        date_from: date_from || null,
        date_to: date_to || null
      },
      ingredient_needs: ingredientNeeds,
      orders_included: activeOrders.map(o => ({
        id: o.id,
        order_number: o.shopify_order_number,
        delivery_date: o.assigned_delivery_date || o.requested_delivery_date,
        production_status: o.production_status,
        source: 'customer_order'
      })),
      manual_batches_included: activeManualBatches.map(b => ({
        id: b.id,
        title: b.title,
        purpose: b.purpose,
        production_date: b.production_date,
        items: b.items,
        source: 'manual_internal_batch'
      }))
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});