import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get all orders
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('', 1000);

    // Group by shopify_order_id to find duplicates
    const orderMap = {};
    for (const order of allOrders) {
      const id = order.shopify_order_id;
      if (!id) continue;
      
      if (!orderMap[id]) {
        orderMap[id] = [];
      }
      orderMap[id].push(order);
    }

    // Find duplicates
    const duplicates = [];
    for (const [orderId, orders] of Object.entries(orderMap)) {
      if (orders.length > 1) {
        duplicates.push({
          shopify_order_id: orderId,
          shopify_order_number: orders[0].shopify_order_number,
          customer_email: orders[0].customer_email,
          count: orders.length,
          records: orders.map(o => ({
            id: o.id,
            created_date: o.created_date,
            production_status: o.production_status,
          })),
        });
      }
    }

    console.log(`[FIND-DUPLICATES] Found ${duplicates.length} duplicate orders`);
    return Response.json({ status: 'success', duplicates_count: duplicates.length, duplicates });
  } catch (error) {
    console.error('[FIND-DUPLICATES] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});