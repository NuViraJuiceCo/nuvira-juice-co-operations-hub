import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * CLEANUP DUPLICATE FULFILLMENT TASKS
 * 
 * Removes duplicate FulfillmentTask records that reference the same order.
 * Keeps the most recent task, deletes older duplicates.
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

    // Get all fulfillment tasks
    const allTasks = await base44.asServiceRole.entities.FulfillmentTask.list('', 1000);

    if (!allTasks || allTasks.length === 0) {
      return Response.json({
        success: true,
        message: 'No tasks found',
        duplicates_found: 0,
      });
    }

    // Group by order_id and customer combination
    const grouped = {};
    for (const task of allTasks) {
      const key = `${task.order_id}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(task);
    }

    // Find duplicates (same order_id with multiple tasks)
    const duplicates = [];
    for (const [key, tasks] of Object.entries(grouped)) {
      if (tasks.length > 1) {
        // Sort by created_date, keep newest, mark rest as duplicates
        tasks.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
        const keep = tasks[0];
        const toDelete = tasks.slice(1);
        duplicates.push({
          order_id: key,
          keep_task_id: keep.id,
          delete_count: toDelete.length,
          task_ids_to_delete: toDelete.map(t => t.id),
          tasks: toDelete.map(t => ({
            id: t.id,
            customer_name: t.customer_name,
            scheduled_date: t.scheduled_date,
            created_date: t.created_date,
          })),
        });
      }
    }

    // Plan
    const plan = {
      total_tasks: allTasks.length,
      duplicates_found: duplicates.length,
      total_duplicates_to_delete: duplicates.reduce((sum, d) => sum + d.delete_count, 0),
      details: duplicates,
    };

    if (confirm_delete) {
      // Execute deletion
      let deleted = 0;
      for (const group of duplicates) {
        for (const taskId of group.task_ids_to_delete) {
          try {
            await base44.asServiceRole.entities.FulfillmentTask.delete(taskId);
            deleted++;
          } catch (err) {
            console.error(`Failed to delete task ${taskId}:`, err.message);
          }
        }
      }

      return Response.json({
        success: true,
        action: 'deleted',
        plan,
        deleted: deleted,
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
    console.error('[CLEANUP-DUPLICATE-TASKS]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});