import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * DEBUG/ADMIN-ONLY: Search utility for specific customer orders.
 * RESTRICTED TO ADMIN ONLY — contains PII and should not be in production.
 * Consider removing after debugging is complete.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required — debug utility restricted' }, { status: 403 });
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