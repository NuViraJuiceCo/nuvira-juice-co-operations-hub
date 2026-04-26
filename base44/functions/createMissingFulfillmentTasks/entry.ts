import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * CREATE MISSING FULFILLMENT TASKS
 * For orders with fulfillments, ensure all 4 weekly tasks are created (1 per fulfillment)
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get all subscription orders
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({});
    const subscriptionOrders = allOrders?.filter(o => o.stripe_subscription_id && o.fulfillments?.length > 0) || [];

    // Get all existing tasks
    const allTasks = await base44.asServiceRole.entities.FulfillmentTask.filter({});
    const tasksByOrderId = {};
    for (const task of allTasks || []) {
      if (!tasksByOrderId[task.order_id]) tasksByOrderId[task.order_id] = [];
      tasksByOrderId[task.order_id].push(task);
    }

    const createdTasks = [];
    let ordersProcessed = 0;

    for (const order of subscriptionOrders) {
      const fulfillmentCount = order.fulfillments.length;
      const existingTaskCount = tasksByOrderId[order.id]?.length || 0;

      if (existingTaskCount >= fulfillmentCount) {
        console.log(`[CREATE-MISSING] Order ${order.id} has ${existingTaskCount} tasks, all fulfillments covered`);
        continue;
      }

      ordersProcessed++;
      console.log(`[CREATE-MISSING] Order ${order.id} has ${existingTaskCount} tasks but ${fulfillmentCount} fulfillments, creating missing...`);

      for (const fulfillment of order.fulfillments) {
        // Check if task already exists for this fulfillment
        const existingTask = (tasksByOrderId[order.id] || []).find(
          t => t.scheduled_date === fulfillment.delivery_date
        );

        if (existingTask) {
          console.log(`[CREATE-MISSING] Task already exists for fulfillment ${fulfillment.fulfillment_number}`);
          continue;
        }

        try {
          // Build items summary from weekly items
          const itemsSummary = (fulfillment.items && fulfillment.items.length > 0
            ? fulfillment.items
            : order.line_items || [])
            .map(item => `${item.quantity}x ${item.title}`)
            .join(', ');

          const task = await base44.asServiceRole.entities.FulfillmentTask.create({
            customer_name: order.customer_name || 'Unknown',
            fulfillment_type: 'Delivery',
            time_window: '09:00 - 17:00',
            status: 'Unassigned',
            scheduled_date: fulfillment.delivery_date || new Date().toISOString().split('T')[0],
            address: `${fulfillment.address_line1 || ''}, ${fulfillment.address_city || ''}, ${fulfillment.address_state || ''}`.replace(/^,\s*/, '').replace(/,\s*$/, ''),
            assigned_driver: null,
            items_summary: itemsSummary,
            order_id: order.id,
          });

          createdTasks.push({
            task_id: task.id,
            order_id: order.id,
            fulfillment_number: fulfillment.fulfillment_number,
            scheduled_date: fulfillment.delivery_date,
          });

          console.log(`[CREATE-MISSING] Created task for fulfillment ${fulfillment.fulfillment_number}`);
        } catch (err) {
          console.error(`[CREATE-MISSING] Failed to create task for fulfillment ${fulfillment.fulfillment_number}:`, err.message);
        }
      }
    }

    return Response.json({
      success: true,
      orders_processed: ordersProcessed,
      tasks_created: createdTasks.length,
      created_tasks: createdTasks,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[CREATE-MISSING]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});