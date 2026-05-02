import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const targetOrders = ['NV-MONI2Z3R', 'NV-MONGOVGM', 'NV-MONHJHUY', 'NV-MONL4I2M'];
    const customerEmail = 'amar.kahlon23@yahoo.com';
    const cleanup = {};

    // Delete from ShopifyOrder
    const orders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 200);
    const matchingOrders = orders.filter(o => 
      (o.customer_email === customerEmail || o.customer_name?.toLowerCase().includes('amar')) && 
      targetOrders.includes(o.shopify_order_number)
    );
    for (const order of matchingOrders) {
      await base44.asServiceRole.entities.ShopifyOrder.delete(order.id);
    }
    cleanup.shopifyOrders = matchingOrders.length;

    // Delete from FulfillmentTask (if exists)
    try {
      const tasks = await base44.asServiceRole.entities.FulfillmentTask.list('-created_date', 100);
      const matchingTasks = tasks.filter(t => targetOrders.includes(t.order_id));
      for (const task of matchingTasks) {
        await base44.asServiceRole.entities.FulfillmentTask.delete(task.id);
      }
      cleanup.fulfillmentTasks = matchingTasks.length;
    } catch {}

    // Delete from OrderReviewQueue
    try {
      const queue = await base44.asServiceRole.entities.OrderReviewQueue.list('-created_date', 100);
      const matchingQueue = queue.filter(q => q.existing_order_number && targetOrders.includes(q.existing_order_number));
      for (const item of matchingQueue) {
        await base44.asServiceRole.entities.OrderReviewQueue.delete(item.id);
      }
      cleanup.reviewQueue = matchingQueue.length;
    } catch {}

    // Recalculate production
    let recalcMessage = 'skipped';
    try {
      const recalcRes = await base44.functions.invoke('recalculateProductionBatches', {});
      recalcMessage = recalcRes.data?.message || 'recalculated';
    } catch (e) {
      console.log('Recalc skipped:', e.message);
    }

    return Response.json({
      message: 'Cleanup complete',
      cleanup,
      recalculation: recalcMessage
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});