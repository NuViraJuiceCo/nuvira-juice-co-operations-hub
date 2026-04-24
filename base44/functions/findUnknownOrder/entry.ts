import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500);
    
    const unknownOrders = allOrders.filter(o => 
      !o.customer_email || 
      o.customer_email === 'unknown@unknown.com' || 
      o.customer_email === ''
    );

    return Response.json({
      total_orders: allOrders.length,
      unknown_count: unknownOrders.length,
      unknown_orders: unknownOrders.map(o => ({
        id: o.id,
        order_number: o.shopify_order_number,
        customer_email: o.customer_email || '(blank)',
        customer_name: o.customer_name,
        created_date: o.created_date,
      })),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});