import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({
      customer_email: 'ksukhi2000@yahoo.com',
    });

    if (!orders || orders.length === 0) {
      return Response.json({ error: 'No orders found' });
    }

    const order = orders[0];

    return Response.json({
      id: order.id,
      order_number: order.shopify_order_number,
      source_channel: order.source_channel,
      production_status: order.production_status,
      line_items: order.line_items,
      customer_notes: order.customer_notes,
      fulfillments: order.fulfillments,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});