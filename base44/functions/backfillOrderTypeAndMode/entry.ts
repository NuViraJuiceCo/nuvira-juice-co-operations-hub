import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * BACKFILL ORDER_TYPE AND FULFILLMENT_MODE
 * 
 * Backfills all existing ShopifyOrder records with:
 * - order_type: subscription | one_time | pos
 * - fulfillment_mode: single_delivery | multi_delivery
 * 
 * Rules:
 * - order_type='subscription' ↔ fulfillment_mode='multi_delivery'
 * - order_type='one_time' ↔ fulfillment_mode='single_delivery'
 * - order_type='pos' ↔ fulfillment_mode='single_delivery' (unless explicitly split)
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { dry_run = true } = body;

    // Load all orders
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 1000);
    if (!allOrders || allOrders.length === 0) {
      return Response.json({
        success: true,
        message: 'No orders to backfill',
        dry_run,
        updated: 0,
      });
    }

    const updates = [];
    let updated = 0;

    for (const order of allOrders) {
      // Skip if already has both fields
      if (order.order_type && order.fulfillment_mode) {
        continue;
      }

      let orderType = order.order_type;
      let fulfillmentMode = order.fulfillment_mode;

      // Determine order_type if missing
      if (!orderType) {
        if (order.source_channel === 'subscription' || order.stripe_subscription_id) {
          orderType = 'subscription';
        } else if (order.source_channel === 'pos' || order.fulfillment_method === 'pos') {
          orderType = 'pos';
        } else {
          orderType = 'one_time';
        }
      }

      // Determine fulfillment_mode if missing
      if (!fulfillmentMode) {
        if (orderType === 'subscription') {
          fulfillmentMode = 'multi_delivery';
        } else {
          fulfillmentMode = 'single_delivery';
        }
      }

      updates.push({
        id: order.id,
        order_type: orderType,
        fulfillment_mode: fulfillmentMode,
      });
    }

    // Apply updates if not dry-run
    if (!dry_run && updates.length > 0) {
      for (const update of updates) {
        try {
          await base44.asServiceRole.entities.ShopifyOrder.update(update.id, {
            order_type: update.order_type,
            fulfillment_mode: update.fulfillment_mode,
          });
          updated++;
        } catch (err) {
          console.error(`[BACKFILL] Failed to update order ${update.id}:`, err.message);
        }
      }
    }

    // Summary
    const summary = {};
    for (const update of updates) {
      const key = `${update.order_type}/${update.fulfillment_mode}`;
      summary[key] = (summary[key] || 0) + 1;
    }

    return Response.json({
      success: true,
      dry_run,
      total_orders: allOrders.length,
      orders_to_update: updates.length,
      updated,
      summary,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[BACKFILL] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});