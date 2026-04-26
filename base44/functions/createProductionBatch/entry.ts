import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * CREATE PRODUCTION BATCH
 * 
 * When subscription orders exist, create ProductionBatch records
 * for Production Planning.
 * 
 * Groups all deliveries for a given product across a production date.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { stripe_subscription_id } = body;

    if (!stripe_subscription_id) {
      return Response.json({ error: 'stripe_subscription_id required' }, { status: 400 });
    }

    // Get all orders for this subscription
    const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({
      stripe_subscription_id: stripe_subscription_id,
    });

    if (!orders || orders.length === 0) {
      return Response.json({
        success: true,
        batches_created: 0,
        message: 'No orders found for this subscription',
      });
    }

    // Group weekly fulfillment items by product and production date (NOT parent monthly totals)
    const batchGroups = {};

    for (const order of orders) {
      if (!order.fulfillments) continue;
      
      for (const fulfillment of order.fulfillments) {
        const prodDate = fulfillment.production_date;
        if (!prodDate) continue;

        // Use fulfillment.items (weekly quantities), fallback to parent line_items only if missing
        const weeklyItems = fulfillment.items && fulfillment.items.length > 0
          ? fulfillment.items
          : order.line_items || [];

        for (const item of weeklyItems) {
          const product = item.title;
          const key = `${prodDate}__${product}`;

          if (!batchGroups[key]) {
            batchGroups[key] = {
              product_name: product,
              production_date: prodDate,
              planned_units: 0,
              order_sources: [],
            };
          }

          batchGroups[key].planned_units += item.quantity || 1;
          
          // Track order source
          const existingSource = batchGroups[key].order_sources.find(os => os.order_id === order.id);
          if (!existingSource) {
            batchGroups[key].order_sources.push({
              order_id: order.id,
              order_number: order.shopify_order_number,
              customer_email: order.customer_email,
              customer_name: order.customer_name,
              quantity: item.quantity || 1,
              source_type: 'subscription',
              source_item: product,
            });
          }
        }
      }
    }

    // Create ProductionBatch records
    const createdBatches = [];
    for (const batchData of Object.values(batchGroups)) {
      try {
        const batchId = `BATCH-${batchData.production_date.replace(/-/g, '')}-${batchData.product_name.replace(/\s+/g, '')}`;

        const batch = await base44.asServiceRole.entities.ProductionBatch.create({
          batch_id: batchId,
          product_name: batchData.product_name,
          product_category: 'juice',
          status: 'Planned',
          planned_units: batchData.planned_units,
          actual_units: 0,
          production_date: batchData.production_date,
          assigned_to: null,
          notes: `Subscription batch for ${new Date(batchData.production_date).toLocaleDateString()}`,
          is_locked: false,
          order_sources: batchData.order_sources,
        });

        createdBatches.push({
          batch_id: batch.id,
          product: batchData.product_name,
          production_date: batchData.production_date,
          planned_units: batchData.planned_units,
        });
      } catch (err) {
        console.error(`[CREATE-PRODUCTION-BATCH] Failed to create batch for ${batchData.product_name}:`, err.message);
      }
    }

    return Response.json({
      success: true,
      subscription_id: stripe_subscription_id,
      orders_scanned: orders.length,
      batches_created: createdBatches.length,
      batches: createdBatches,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[CREATE-PRODUCTION-BATCH]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});