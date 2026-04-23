import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { order_number } = await req.json();

    // Get all orders
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('', 1000);

    // Find duplicates
    const orderMap = {};
    for (const order of allOrders) {
      const id = order.shopify_order_id;
      if (!id) continue;
      
      if (!orderMap[id]) {
        orderMap[id] = [];
      }
      orderMap[id].push(order);
    }

    let deletedCount = 0;
    const deletedOrders = [];

    // For each order ID with duplicates, keep the newest and delete the rest
    for (const [orderId, orders] of Object.entries(orderMap)) {
      if (orders.length > 1) {
        // Sort by created_date descending (newest first)
        const sorted = orders.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
        
        // Delete all but the first (newest)
        for (let i = 1; i < sorted.length; i++) {
          const orderToDelete = sorted[i];
          
          // Only delete if matching the specific order number if provided
          if (!order_number || orderToDelete.shopify_order_number === order_number) {
            await base44.asServiceRole.entities.ShopifyOrder.delete(orderToDelete.id);
            deletedCount++;
            deletedOrders.push({
              id: orderToDelete.id,
              order_id: orderId,
              order_number: orderToDelete.shopify_order_number,
              created_date: orderToDelete.created_date,
            });
          }
        }
      }
    }

    console.log(`[CLEANUP-DUPLICATES] Deleted ${deletedCount} duplicate orders`);
    return Response.json({ status: 'success', deleted_count: deletedCount, deleted_orders: deletedOrders });
  } catch (error) {
    console.error('[CLEANUP-DUPLICATES] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});