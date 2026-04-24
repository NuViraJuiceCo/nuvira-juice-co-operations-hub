import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { customer_name, delivery_address } = await req.json();

    if (!customer_name || !delivery_address) {
      return Response.json({ error: 'Missing customer_name or delivery_address' }, { status: 400 });
    }

    // Find order by customer name
    const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({});
    const order = orders.find(o => 
      o.customer_name && o.customer_name.toLowerCase().includes(customer_name.toLowerCase())
    );

    if (!order) {
      return Response.json({ error: `Order for ${customer_name} not found` }, { status: 404 });
    }

    // Update delivery address
    await base44.asServiceRole.entities.ShopifyOrder.update(order.id, {
      delivery_address: delivery_address
    });

    return Response.json({
      success: true,
      message: `Updated order ${order.shopify_order_number} with delivery address: ${delivery_address}`,
      order_id: order.id,
      order_number: order.shopify_order_number
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});