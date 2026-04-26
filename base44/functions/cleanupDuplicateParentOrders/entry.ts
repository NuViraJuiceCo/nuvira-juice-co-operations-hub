import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * CLEANUP DUPLICATE PARENT ORDERS
 * 
 * Model A requires 1 parent ShopifyOrder per subscription.
 * This function finds subscriptions with multiple parent orders and removes extras.
 * Keeps the oldest order, deletes newer duplicates along with their tasks and batches.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const { confirm_delete } = body;

    // Get all subscription orders
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({});
    const subscriptionOrders = allOrders?.filter(o => o.stripe_subscription_id) || [];

    // Group by subscription_id
    const grouped = {};
    for (const order of subscriptionOrders) {
      const subId = order.stripe_subscription_id;
      if (!grouped[subId]) grouped[subId] = [];
      grouped[subId].push(order);
    }

    // Find subscriptions with multiple parent orders
    const duplicateGroups = [];
    for (const [subId, orders] of Object.entries(grouped)) {
      if (orders.length > 1) {
        // Sort by created_date, keep oldest, mark rest as duplicates
        orders.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
        const keep = orders[0];
        const toDelete = orders.slice(1);
        duplicateGroups.push({
          subscription_id: subId,
          keep_order_id: keep.id,
          keep_order_number: keep.shopify_order_number,
          delete_count: toDelete.length,
          orders_to_delete: toDelete.map(o => ({
            id: o.id,
            order_number: o.shopify_order_number,
            customer_name: o.customer_name,
            created_date: o.created_date,
          })),
        });
      }
    }

    // Plan
    const plan = {
      total_subscriptions: Object.keys(grouped).length,
      subscriptions_with_duplicates: duplicateGroups.length,
      total_parent_orders_to_delete: duplicateGroups.reduce((sum, d) => sum + d.delete_count, 0),
      details: duplicateGroups,
    };

    if (confirm_delete) {
      // Get all tasks and batches that reference orders to be deleted
      const allTasks = await base44.asServiceRole.entities.FulfillmentTask.filter({});
      const allBatches = await base44.asServiceRole.entities.ProductionBatch.filter({});

      let deletedOrders = 0;
      let deletedTasks = 0;
      let deletedBatches = 0;

      for (const group of duplicateGroups) {
        for (const orderToDelete of group.orders_to_delete) {
          const orderId = orderToDelete.id;

          // Delete associated tasks
          const tasksToDelete = allTasks?.filter(t => t.order_id === orderId) || [];
          for (const task of tasksToDelete) {
            try {
              await base44.asServiceRole.entities.FulfillmentTask.delete(task.id);
              deletedTasks++;
            } catch (err) {
              console.error(`Failed to delete task ${task.id}:`, err.message);
            }
          }

          // Delete associated batches (or update them if they have other orders)
          const batchesToUpdate = allBatches?.filter(b =>
            b.order_sources?.some(os => os.order_id === orderId)
          ) || [];
          for (const batch of batchesToUpdate) {
            try {
              const newSources = batch.order_sources.filter(os => os.order_id !== orderId);
              if (newSources.length === 0) {
                // No other orders for this batch, delete it
                await base44.asServiceRole.entities.ProductionBatch.delete(batch.id);
                deletedBatches++;
              } else {
                // Still has other orders, just update the sources
                const newPlannedUnits = newSources.reduce((sum, os) => sum + (os.quantity || 0), 0);
                await base44.asServiceRole.entities.ProductionBatch.update(batch.id, {
                  order_sources: newSources,
                  planned_units: newPlannedUnits,
                });
              }
            } catch (err) {
              console.error(`Failed to update batch ${batch.id}:`, err.message);
            }
          }

          // Delete the parent order
          try {
            await base44.asServiceRole.entities.ShopifyOrder.delete(orderId);
            deletedOrders++;
          } catch (err) {
            console.error(`Failed to delete order ${orderId}:`, err.message);
          }
        }
      }

      return Response.json({
        success: true,
        action: 'deleted',
        plan,
        execution: {
          deleted_parent_orders: deletedOrders,
          deleted_fulfillment_tasks: deletedTasks,
          deleted_or_updated_production_batches: deletedBatches,
        },
      });
    } else {
      return Response.json({
        success: true,
        action: 'plan_only',
        plan,
        message: 'Pass confirm_delete: true to execute deletion',
      });
    }
  } catch (error) {
    console.error('[CLEANUP-DUPLICATE-PARENT]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});