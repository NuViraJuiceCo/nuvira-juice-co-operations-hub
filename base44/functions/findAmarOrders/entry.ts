import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 100);

    const amarMatches = allOrders.filter(o => 
      o.customer_name?.toLowerCase().includes('amar') || 
      o.customer_email?.toLowerCase().includes('amar') ||
      o.customer_name?.toLowerCase().includes('kahlon') ||
      o.customer_email?.toLowerCase().includes('kahlon')
    );

    return Response.json({
      total_orders: allOrders.length,
      amar_matches: amarMatches.map(o => ({
        order_id: o.shopify_order_id,
        order_number: o.shopify_order_number,
        customer_name: o.customer_name,
        customer_email: o.customer_email,
        status: o.production_status,
        payment_status: o.payment_status
      }))
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});