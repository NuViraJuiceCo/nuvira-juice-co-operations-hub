import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get all Sukhwant Kahlon tasks
    const allTasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
      customer_name: 'Sukhwant Kahlon',
    });

    // Group by scheduled_date
    const byDate = {};
    for (const task of allTasks || []) {
      if (!byDate[task.scheduled_date]) {
        byDate[task.scheduled_date] = [];
      }
      byDate[task.scheduled_date].push(task);
    }

    // Find duplicates and keep only the oldest
    const toDelete = [];
    for (const [date, tasks] of Object.entries(byDate)) {
      if (tasks.length > 1) {
        // Sort by created_date, keep the first, delete the rest
        const sorted = tasks.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
        for (let i = 1; i < sorted.length; i++) {
          toDelete.push(sorted[i].id);
        }
      }
    }

    // Delete duplicates
    for (const id of toDelete) {
      await base44.asServiceRole.entities.FulfillmentTask.delete(id);
    }

    return Response.json({
      success: true,
      message: `Cleaned up ${toDelete.length} duplicate tasks for Sukhwant Kahlon`,
      deleted_ids: toDelete,
      remaining_by_date: Object.keys(byDate).length,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});