import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Validate: Check Sukhwant's order has fulfillments with addresses
 */

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
      return Response.json({ error: 'No orders found for Sukhwant' });
    }

    const order = orders[0];

    return Response.json({
      order_id: order.id,
      customer_name: order.customer_name,
      customer_email: order.customer_email,
      order_address: {
        line1: order.address_line1,
        city: order.address_city,
        state: order.address_state,
        postal: order.address_postal_code,
      },
      fulfillment_count: order.fulfillments?.length || 0,
      fulfillments: (order.fulfillments || []).map(f => ({
        number: f.fulfillment_number,
        delivery_date: f.delivery_date,
        has_address: !!f.address_line1,
        address: f.address_line1 ? {
          line1: f.address_line1,
          city: f.address_city,
          state: f.address_state,
          postal: f.address_postal_code,
        } : null,
        items: f.items?.length || 0,
      })),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});