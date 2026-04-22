import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user?.role || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Determine which delivery date to target based on day of week and automation run time
    // Monday 6 AM → Tuesday production for Wednesday delivery
    // Thursday 6 AM → Friday production for Saturday delivery
    // Friday 6 AM → Saturday production for Sunday delivery
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sunday, 1=Monday, 5=Friday, 6=Saturday
    
    let deliveryDate;
    if (dayOfWeek === 1) { // Monday
      // Target Wednesday delivery (Tuesday production)
      deliveryDate = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);
    } else if (dayOfWeek === 4) { // Thursday
      // Target Saturday delivery (Friday production)
      deliveryDate = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);
    } else if (dayOfWeek === 5) { // Friday
      // Target Sunday delivery (Saturday production)
      deliveryDate = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);
    } else {
      // Fallback: shouldn't run on other days, but target next day if it does
      deliveryDate = new Date(today.getTime() + 1 * 24 * 60 * 60 * 1000);
    }

    const deliveryDateStr = deliveryDate.toISOString().split('T')[0];
    // Include a 1-day buffer before target date to catch all relevant orders
    const dateFrom = new Date(deliveryDate.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const dateTo = deliveryDateStr;

    const ingredientRes = await base44.functions.invoke('calculateIngredientNeeds', {
      date_from: dateFrom,
      date_to: dateTo
    });

    if (!ingredientRes.data) {
      return Response.json({ 
        status: 'no_orders',
        message: 'No orders found for batch generation'
      });
    }

    const { summary, ingredient_needs } = ingredientRes.data;

    // Identify items needing purchase
    const purchaseNeeded = ingredient_needs.filter(i => i.status === 'purchase_needed');
    const sufficientStock = ingredient_needs.filter(i => i.status === 'sufficient');

    // Create a production batch record (optional, for tracking)
    const batch = await base44.asServiceRole.entities.ProductionBatch.create({
      product_name: 'Auto-Generated Batch',
      batch_date: dateFrom,
      batch_time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
      status: 'Awaiting Ingredients',
      units_planned: summary.bottle_counts ? Object.values(summary.bottle_counts).reduce((a, b) => a + b, 0) : 0,
      notes: `Auto-generated on ${new Date().toLocaleDateString()}. ${purchaseNeeded.length} items need purchasing, ${sufficientStock.length} items in stock.`
    });

    return Response.json({
      status: 'success',
      batch_id: batch.id,
      summary: {
        orders_included: summary.matched_orders,
        total_units: summary.bottle_counts ? Object.values(summary.bottle_counts).reduce((a, b) => a + b, 0) : 0,
        items_to_purchase: purchaseNeeded.length,
        items_in_stock: sufficientStock.length,
        target_delivery_date: deliveryDateStr,
        date_range: { from: dateFrom, to: dateTo }
      },
      shopping_list: purchaseNeeded.map(i => ({
        ingredient: i.ingredient,
        needed_lbs: i.needed_lbs,
        shortfall_lbs: i.shortfall_lbs,
        supplier: i.supplier,
        cases_needed: i.cases_needed_rounded
      }))
    });
  } catch (error) {
    console.error('[AUTO-BATCH] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});