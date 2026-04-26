import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Sync Fulfillment Tasks from Orders
 * Ensures every order with fulfillment needs has corresponding FulfillmentTask records
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get all orders
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({});
    
    // Get all existing fulfillment tasks
    const allTasks = await base44.asServiceRole.entities.FulfillmentTask.filter({});
    const tasksByOrderId = {};
    for (const task of allTasks || []) {
      if (!tasksByOrderId[task.order_id]) tasksByOrderId[task.order_id] = [];
      tasksByOrderId[task.order_id].push(task);
    }

    const createdTasks = [];
    let processedOrders = 0;

    for (const order of allOrders || []) {
      // Skip orders that already have tasks
      if (tasksByOrderId[order.id] && tasksByOrderId[order.id].length > 0) {
        continue;
      }

      // Skip cancelled or refunded orders
      if (order.payment_status === 'Refunded' || order.production_status === 'canceled') {
        continue;
      }

      // For subscription orders with fulfillments, create tasks for each fulfillment
      if (order.fulfillments && order.fulfillments.length > 0) {
        processedOrders++;
        for (const fulfillment of order.fulfillments) {
          try {
            const itemsSummary = (fulfillment.items && fulfillment.items.length > 0
              ? fulfillment.items
              : order.line_items || [])
              .map(item => `${item.quantity}x ${item.title}`)
              .join(', ');

            const task = await base44.asServiceRole.entities.FulfillmentTask.create({
              customer_name: order.customer_name || 'Unknown',
              fulfillment_type: order.fulfillment_method === 'pickup' ? 'Pickup' : 'Delivery',
              time_window: order.fulfillment_window || '09:00 - 17:00',
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
              customer: order.customer_name,
              fulfillment_date: fulfillment.delivery_date,
            });
          } catch (err) {
            console.error(`Failed to create task for order ${order.id}:`, err.message);
          }
        }
      } 
      // For non-subscription orders, create a single fulfillment task
      else if (order.fulfillment_type && order.fulfillment_type !== 'Wholesale' && order.fulfillment_type !== 'Event') {
        processedOrders++;
        try {
          const itemsSummary = (order.line_items || [])
            .map(item => `${item.quantity}x ${item.product_name || item.title}`)
            .join(', ');

          const deliveryDate = order.assigned_delivery_date || order.requested_delivery_date || new Date().toISOString().split('T')[0];

          const task = await base44.asServiceRole.entities.FulfillmentTask.create({
            customer_name: order.customer_name || 'Unknown',
            fulfillment_type: order.fulfillment_type,
            time_window: order.fulfillment_window || '09:00 - 17:00',
            status: 'Unassigned',
            scheduled_date: deliveryDate,
            address: order.delivery_address || `${order.address_line1 || ''}, ${order.address_city || ''}`.replace(/^,\s*/, ''),
            assigned_driver: null,
            items_summary: itemsSummary,
            order_id: order.id,
          });

          createdTasks.push({
            task_id: task.id,
            order_id: order.id,
            customer: order.customer_name,
            delivery_date: deliveryDate,
          });
        } catch (err) {
          console.error(`Failed to create task for order ${order.id}:`, err.message);
        }
      }
    }

    return Response.json({
      success: true,
      orders_scanned: allOrders?.length || 0,
      orders_with_missing_tasks: processedOrders,
      tasks_created: createdTasks.length,
      created_tasks: createdTasks,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[SYNC-FULFILLMENT-TASKS]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});