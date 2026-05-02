import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Target specific order numbers
    const targetOrders = ['NV-MONI2Z3R', 'NV-MONGOVGM', 'NV-MONHJHUY', 'NV-MONL4I2M'];
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 200);
    const amarOrders = allOrders.filter(o => 
      o.customer_email === 'amar.kahlon23@yahoo.com' && 
      targetOrders.includes(o.shopify_order_number)
    );

    if (!amarOrders || amarOrders.length === 0) {
      return Response.json({ message: 'No matching orders found' });
    }

    // Delete these orders
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