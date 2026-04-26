import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * AUDIT CUSTOMER SUBSCRIPTIONS
 * Shows all subscriptions for a customer and their fulfillment tasks
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const { customer_email } = body;

    if (!customer_email) {
      return Response.json({ error: 'customer_email required' }, { status: 400 });
    }

    // Get all orders for this customer
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({
      customer_email: customer_email,
    });

    // Get all tasks for this customer
    const allTasks = await base44.asServiceRole.entities.FulfillmentTask.filter({});
    const customerTasks = allTasks?.filter(t => t.customer_name && allOrders?.some(o => o.id === t.order_id)) || [];

    // Group orders by subscription_id
    const subscriptions = {};
    const nonSubscriptionOrders = [];

    for (const order of allOrders || []) {
      if (order.stripe_subscription_id) {
        const subId = order.stripe_subscription_id;
        if (!subscriptions[subId]) {
          subscriptions[subId] = {
            subscription_id: subId,
            orders: [],
            tasks: [],
          };
        }
        subscriptions[subId].orders.push({
          id: order.id,
          order_number: order.shopify_order_number,
          source_channel: order.source_channel,
          created_date: order.created_date,
        });

        // Get tasks for this order
        const orderTasks = customerTasks.filter(t => t.order_id === order.id);
        subscriptions[subId].tasks.push(...orderTasks.map(t => ({
          id: t.id,
          scheduled_date: t.scheduled_date,
          status: t.status,
          items_summary: t.items_summary,
        })));
      } else {
        nonSubscriptionOrders.push({
          id: order.id,
          order_number: order.shopify_order_number,
          source_channel: order.source_channel,
          created_date: order.created_date,
        });
      }
    }

    return Response.json({
      success: true,
      customer_email: customer_email,
      total_orders: (allOrders || []).length,
      subscription_count: Object.keys(subscriptions).length,
      non_subscription_orders: nonSubscriptionOrders.length,
      subscriptions: subscriptions,
      total_fulfillment_tasks: customerTasks.length,
    });
  } catch (error) {
    console.error('[AUDIT-SUBSCRIPTIONS]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});