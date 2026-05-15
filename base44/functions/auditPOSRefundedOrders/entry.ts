import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * auditPOSRefundedOrders - Inspect ShopifyOrder records for refund/cancel status
 * Identifies which test POS orders (#1001-#1006) were refunded and how their status is stored.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Fetch test orders
    const testOrders = await base44.entities.ShopifyOrder.filter({
      shopify_order_number: { $in: ['#1001', '#1002', '#1003', '#1004', '#1005', '#1006'] }
    });

    const audit = testOrders.map(order => ({
      order_number: order.shopify_order_number,
      order_id: order.id,
      order_type: order.order_type,
      source_type: order.source_type,
      payment_status: order.payment_status,
      order_status: order.order_status,
      production_status: order.production_status,
      operational_visibility: order.operational_visibility,
      fulfillment_method: order.fulfillment_method,
      tags: order.tags,
      total_price: order.total_price,
      refund_amount: order.refund_amount,
      archived_at: order.archived_at,
      cancelled_at: order.cancelled_at,
      sync_status: order.sync_status,
      last_sync_at: order.last_sync_at,
    }));

    return Response.json({
      status: 'SUCCESS',
      timestamp: new Date().toISOString(),
      total_found: testOrders.length,
      orders: audit,
      summary: {
        active_orders: testOrders.filter(o => o.operational_visibility !== 'archived').length,
        archived_orders: testOrders.filter(o => o.operational_visibility === 'archived').length,
        refunded_count: testOrders.filter(o => o.payment_status === 'refunded').length,
        canceled_count: testOrders.filter(o => o.order_status === 'canceled').length,
      }
    });

  } catch (error) {
    return Response.json({
      status: 'FAILED',
      error: error.message,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
});