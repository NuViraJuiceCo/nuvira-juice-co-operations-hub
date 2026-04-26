import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * CREATE FULFILLMENT TASKS
 * 
 * When subscription orders are created, generate corresponding FulfillmentTask records
 * for the Driver Portal.
 * 
 * One FulfillmentTask per weekly delivery order.
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
        tasks_created: 0,
        message: 'No orders found for this subscription',
      });
    }

    const createdTasks = [];

    for (const order of orders) {
      if (!order.fulfillments || order.fulfillments.length === 0) {
        continue; // Skip orders without fulfillments
      }

      for (const fulfillment of order.fulfillments) {
        try {
          // Build items summary from WEEKLY fulfillment items, NOT parent monthly totals
          const itemsSummary = (fulfillment.items && fulfillment.items.length > 0
            ? fulfillment.items
            : order.line_items || [])
            .map(item => `${item.quantity}x ${item.title}`)
            .join(', ');

          // Create FulfillmentTask
          const task = await base44.asServiceRole.entities.FulfillmentTask.create({
            customer_name: order.customer_name || 'Unknown',
            fulfillment_type: 'Delivery',
            time_window: '09:00 - 17:00', // Default delivery window
            status: 'Unassigned',
            scheduled_date: fulfillment.delivery_date || new Date().toISOString().split('T')[0],
            address: `${fulfillment.address_line1 || ''}, ${fulfillment.address_city || ''}, ${fulfillment.address_state || ''}`.replace(/^,\s*/, '').replace(/,\s*$/, ''),
            assigned_driver: null,
            items_summary: itemsSummary,
            order_id: order.id,
          });

          createdTasks.push({
            task_id: task.id,
            order_id: order.id,
            delivery_date: fulfillment.delivery_date,
            customer_name: order.customer_name,
          });
        } catch (err) {
          console.error(`[CREATE-FULFILLMENT-TASKS] Failed to create task for order ${order.id}:`, err.message);
        }
      }
    }

    return Response.json({
      success: true,
      subscription_id: stripe_subscription_id,
      orders_scanned: orders.length,
      tasks_created: createdTasks.length,
      tasks: createdTasks,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[CREATE-FULFILLMENT-TASKS]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});