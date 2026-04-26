import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * FIND CUSTOMER BY NAME
 * Lists all orders for customers matching a name
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const { customer_name } = body;

    if (!customer_name) {
      return Response.json({ error: 'customer_name required' }, { status: 400 });
    }

    // Get all orders
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({});
    
    // Filter by name match
    const matchingOrders = allOrders?.filter(o => 
      o.customer_name && o.customer_name.toLowerCase().includes(customer_name.toLowerCase())
    ) || [];

    // Get all tasks
    const allTasks = await base44.asServiceRole.entities.FulfillmentTask.filter({});
    
    // Deduplicate by customer email
    const customerMap = {};
    for (const order of matchingOrders) {
      if (!customerMap[order.customer_email]) {
        customerMap[order.customer_email] = {
          email: order.customer_email,
          name: order.customer_name,
          orders: [],
          tasks: [],
          subscriptions: new Set(),
        };
      }
      customerMap[order.customer_email].orders.push({
        id: order.id,
        order_number: order.shopify_order_number,
        source_channel: order.source_channel,
        created_date: order.created_date,
        stripe_subscription_id: order.stripe_subscription_id,
      });
      if (order.stripe_subscription_id) {
        customerMap[order.customer_email].subscriptions.add(order.stripe_subscription_id);
      }

      // Get tasks for this order
      const orderTasks = allTasks?.filter(t => t.order_id === order.id) || [];
      customerMap[order.customer_email].tasks.push(...orderTasks.map(t => ({
        id: t.id,
        scheduled_date: t.scheduled_date,
        status: t.status,
        items_summary: t.items_summary,
      })));
    }

    return Response.json({
      success: true,
      search_name: customer_name,
      matching_customers: Object.entries(customerMap).map(([email, data]) => ({
        email,
        name: data.name,
        order_count: data.orders.length,
        subscription_count: data.subscriptions.size,
        task_count: data.tasks.length,
        subscriptions: Array.from(data.subscriptions),
        orders: data.orders,
        tasks: data.tasks,
      })),
    });
  } catch (error) {
    console.error('[FIND-CUSTOMER]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});