import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { customer_name } = await req.json();

    // Fetch all orders
    const orders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 100);
    
    // Find order by customer name
    const order = orders.find(o => 
      o.customer_name && o.customer_name.toLowerCase().includes(customer_name.toLowerCase())
    );

    if (!order) {
      return Response.json({ error: `Order for ${customer_name} not found` }, { status: 404 });
    }

    return Response.json({
      order_number: order.shopify_order_number,
      customer_name: order.customer_name,
      created_date: order.created_date,
      customer_order_date: order.customer_order_date,
      last_sync_at: order.last_sync_at,
      assigned_delivery_date: order.assigned_delivery_date,
      requested_delivery_date: order.requested_delivery_date,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});