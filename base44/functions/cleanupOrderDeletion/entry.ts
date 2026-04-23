import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user?.role || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { event } = await req.json();

    if (event.type !== 'delete' || event.entity_name !== 'ShopifyOrder') {
      return Response.json({ status: 'ignored' });
    }

    const order_id = event.entity_id;

    // Find and delete all fulfillment tasks for this order
    const tasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
      order_id: order_id
    });

    for (const task of tasks) {
      await base44.asServiceRole.entities.FulfillmentTask.delete(task.id);
    }

    console.log(`[CLEANUP-ORDER] Deleted ${tasks.length} fulfillment tasks for order ${order_id}`);
    return Response.json({ status: 'success', tasks_deleted: tasks.length });
  } catch (error) {
    console.error('[CLEANUP-ORDER] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});