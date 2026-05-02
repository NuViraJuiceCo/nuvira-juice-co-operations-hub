import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Find all orders by Amar Kahlon
    const amarOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({
      customer_email: 'amar.kahlon23@yahoo.com'
    });

    if (!amarOrders || amarOrders.length === 0) {
      return Response.json({ message: 'No orders found for Amar Kahlon' });
    }

    // Delete all his orders
    const deleted = [];
    for (const order of amarOrders) {
      await base44.asServiceRole.entities.ShopifyOrder.delete(order.id);
      deleted.push(order.shopify_order_number);
    }

    // Recalculate production batches to reflect true demand
    const recalcRes = await base44.functions.invoke('recalculateProductionBatches', {});

    return Response.json({
      message: `Cleaned up ${amarOrders.length} orders (${deleted.join(', ')})`,
      deleted_orders: deleted,
      recalculation: recalcRes.data
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});