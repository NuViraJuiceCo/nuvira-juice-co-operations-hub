import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Cleanup old subscription test records from previous test runs.
 * Removes all test ShopifyOrders, FulfillmentTasks, and ProductionBatches created during testing.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    console.log('[CLEANUP] Starting test record cleanup...');

    const testEmails = [
      'pbatch.live.sub@example.com',
      'pbatch.pending.sub@example.com',
      'e2e.live.subscription@example.com',
      'e2e.pending.subscription@example.com',
      'handler.paid.sub@example.com',
      'handler.pending.sub@example.com',
      'opsvis.live.sub@example.com',
      'opsvis.pending.sub@example.com',
      'live.subscription.paid@example.com',
      'live.subscription.pending@example.com',
    ];

    let deletedOrders = 0;
    let deletedTasks = 0;
    let deletedBatches = 0;

    // Delete test ShopifyOrders
    for (const email of testEmails) {
      const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({
        customer_email: email,
      });
      for (const order of orders) {
        await base44.asServiceRole.entities.ShopifyOrder.delete(order.id);
        deletedOrders++;
      }
    }

    // Delete test FulfillmentTasks
    for (const email of testEmails) {
      const tasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
        customer_email: email,
      });
      for (const task of tasks) {
        await base44.asServiceRole.entities.FulfillmentTask.delete(task.id);
        deletedTasks++;
      }
    }

    // Delete test ProductionBatches (look for BATCH-20260526, BATCH-20260530, BATCH-20260531, BATCH-20260529)
    const testBatchPatterns = ['BATCH-20260526', 'BATCH-20260530', 'BATCH-20260531', 'BATCH-20260529'];
    const allBatches = await base44.asServiceRole.entities.ProductionBatch.list('-created_date', 500);
    
    for (const batch of allBatches) {
      if (testBatchPatterns.some(pattern => batch.batch_id?.includes(pattern))) {
        await base44.asServiceRole.entities.ProductionBatch.delete(batch.id);
        deletedBatches++;
      }
    }

    console.log('[CLEANUP] Deleted:', { deletedOrders, deletedTasks, deletedBatches });

    return Response.json({
      status: 'success',
      cleanup_result: {
        deleted_orders: deletedOrders,
        deleted_tasks: deletedTasks,
        deleted_batches: deletedBatches,
      },
      message: `Cleaned up ${deletedOrders + deletedTasks + deletedBatches} test records`,
    });

  } catch (error) {
    console.error('[CLEANUP] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});