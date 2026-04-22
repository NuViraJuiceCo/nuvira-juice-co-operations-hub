import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user?.role || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Calculate ingredient needs for next 3 days of deliveries
    // (covers orders with delivery dates in upcoming window)
    const today = new Date();
    const dateFrom = today.toISOString().split('T')[0];
    const dateTo = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

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