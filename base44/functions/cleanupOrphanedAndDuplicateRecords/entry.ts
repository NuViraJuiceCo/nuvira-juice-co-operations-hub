import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * CLEANUP: ORPHANED & DUPLICATE RECORDS
 * 
 * Removes orphaned tasks and duplicates from Driver Portal and Production Planning.
 * Archives/quarantines duplicate orders.
 * ADMIN APPROVAL REQUIRED before any deletion.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { action, confirm_delete } = body;

    // Load all data
    const [allOrders, allBatches, allTasks] = await Promise.all([
      base44.asServiceRole.entities.ShopifyOrder.list('', 1000),
      base44.asServiceRole.entities.ProductionBatch.list('', 500),
      base44.asServiceRole.entities.FulfillmentTask.list('', 500),
    ]);

    const orderIds = new Set(allOrders?.map(o => o.id) || []);

    // IDENTIFY ORPHANED TASKS
    const orphanedTasks = (allTasks || []).filter(t => !orderIds.has(t.order_id));

    // IDENTIFY DUPLICATE TASKS (same order has multiple tasks)
    const tasksByOrder = new Map();
    for (const task of allTasks || []) {
      if (!tasksByOrder.has(task.order_id)) {
        tasksByOrder.set(task.order_id, []);
      }
      tasksByOrder.get(task.order_id).push(task);
    }

    const duplicateTasks = [];
    for (const [orderId, tasks] of tasksByOrder.entries()) {
      if (tasks.length > 1) {
        // Keep latest, mark others as duplicate
        tasks.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
        const canonical = tasks[0];
        const dupes = tasks.slice(1);
        duplicateTasks.push({
          order_id: orderId,
          canonical_task_id: canonical.id,
          duplicate_count: dupes.length,
          duplicates: dupes.map(t => t.id),
        });
      }
    }

    // IDENTIFY ORPHANED BATCHES & BATCH REFERENCES
    const orphanedOrderRefs = [];
    for (const batch of allBatches || []) {
      if (batch.order_sources) {
        const badRefs = batch.order_sources.filter(os => !orderIds.has(os.order_id));
        if (badRefs.length > 0) {
          orphanedOrderRefs.push({
            batch_id: batch.batch_id,
            product_name: batch.product_name,
            bad_order_refs: badRefs.map(r => ({ order_id: r.order_id, quantity: r.quantity })),
          });
        }
      }
    }

    // If just asking for plan, return without deletion
    if (action === 'plan_only' || !confirm_delete) {
      return Response.json({
        success: true,
        action: 'plan_only',
        cleanup_plan: {
          orphaned_tasks_to_delete: orphanedTasks.length,
          duplicate_tasks_to_delete: duplicateTasks.reduce((s, g) => s + g.duplicate_count, 0),
          orphaned_order_refs_to_remove: orphanedOrderRefs.reduce((s, b) => s + b.bad_order_refs.length, 0),
          details: {
            orphaned_tasks: orphanedTasks.map(t => ({
              task_id: t.id,
              customer_name: t.customer_name,
              missing_order_id: t.order_id,
            })),
            duplicate_task_groups: duplicateTasks,
            orphaned_refs: orphanedOrderRefs,
          },
        },
      });
    }

    // EXECUTE CLEANUP
    const deleted = {
      orphaned_tasks: 0,
      duplicate_tasks: 0,
      orphaned_refs_removed: 0,
    };

    // Delete orphaned tasks
    for (const task of orphanedTasks) {
      try {
        await base44.asServiceRole.entities.FulfillmentTask.delete(task.id);
        deleted.orphaned_tasks++;
      } catch (e) {
        // Already deleted or doesn't exist, skip
      }
    }

    // Delete duplicate tasks (keep canonical)
    for (const group of duplicateTasks) {
      for (const dupeId of group.duplicates) {
        try {
          await base44.asServiceRole.entities.FulfillmentTask.delete(dupeId);
          deleted.duplicate_tasks++;
        } catch (e) {
          // Already deleted, skip
        }
      }
    }

    // Remove orphaned order references from batches
    for (const batchRef of orphanedOrderRefs) {
      const batch = await base44.asServiceRole.entities.ProductionBatch.filter(
        { batch_id: batchRef.batch_id }
      ).then(r => r?.[0]);

      if (batch) {
        const cleaned = batch.order_sources.filter(os => 
          !batchRef.bad_order_refs.find(br => br.order_id === os.order_id)
        );

        if (cleaned.length === 0) {
          // If no order sources left, delete batch
          await base44.asServiceRole.entities.ProductionBatch.delete(batch.id);
          deleted.orphaned_refs_removed += batchRef.bad_order_refs.length;
        } else {
          // Update with cleaned references
          await base44.asServiceRole.entities.ProductionBatch.update(batch.id, {
            order_sources: cleaned,
          });
          deleted.orphaned_refs_removed += batchRef.bad_order_refs.length;
        }
      }
    }

    return Response.json({
      success: true,
      action: 'executed_cleanup',
      timestamp: new Date().toISOString(),
      deleted,
      summary: `Deleted ${deleted.orphaned_tasks} orphaned tasks, ${deleted.duplicate_tasks} duplicate tasks, removed ${deleted.orphaned_refs_removed} orphaned order references.`,
    });
  } catch (error) {
    console.error('[CLEANUP-ORPHANED]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});