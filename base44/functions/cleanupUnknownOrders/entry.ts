import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Remove unrecoverable #unknown orders (no email, no Stripe linkage)
 * Then recalculate production batches
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const result = {
      timestamp: new Date().toISOString(),
      deleted_count: 0,
      deleted_orders: [],
    };

    // Find and delete unrecoverable #unknown orders
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500);
    
    for (const order of allOrders) {
      // Delete if: no email OR email is 'unknown@unknown.com' AND no Stripe IDs
      const isUnrecoverable = 
        (!order.customer_email || order.customer_email === 'unknown@unknown.com') &&
        !order.stripe_customer_id &&
        !order.stripe_checkout_session_id &&
        !order.stripe_payment_intent_id;

      if (isUnrecoverable) {
        try {
          await base44.asServiceRole.entities.ShopifyOrder.delete(order.id);
          result.deleted_count++;
          result.deleted_orders.push({
            id: order.id,
            order_number: order.shopify_order_number,
            email: order.customer_email || '(blank)',
          });
          console.log(`[CLEANUP] Deleted unrecoverable order ${order.id}`);
        } catch (err) {
          console.error(`[CLEANUP] Failed to delete ${order.id}:`, err.message);
        }
      }
    }

    console.log(`[CLEANUP] Deleted ${result.deleted_count} unrecoverable orders`);

    // Recalculate production batches
    console.log('[CLEANUP] Recalculating production batches...');
    try {
      const recalcRes = await base44.asServiceRole.functions.invoke('recalculateProductionBatches', {});
      result.recalculation = recalcRes?.results || recalcRes?.data?.results || {};
    } catch (err) {
      result.recalculation_error = err.message;
    }

    return Response.json({ success: true, result });
  } catch (error) {
    console.error('[CLEANUP] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});