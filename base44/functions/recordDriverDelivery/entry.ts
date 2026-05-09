import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * recordDriverDelivery
 *
 * Marks a FulfillmentTask as delivered with photo proof.
 * Authenticates user, updates task status, syncs to ShopifyOrder.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { task_id, driver_email, driver_name, photo_url, drop_location, timestamp } = body;

    if (!task_id) {
      return Response.json({ error: 'task_id required' }, { status: 400 });
    }

    const ts = timestamp || new Date().toISOString();

    // Fetch task
    const tasks = await base44.asServiceRole.entities.FulfillmentTask.filter({ id: task_id });
    const task = tasks?.[0];

    if (!task) {
      return Response.json({ error: `FulfillmentTask not found: ${task_id}` }, { status: 404 });
    }

    // Update FulfillmentTask
    await base44.asServiceRole.entities.FulfillmentTask.update(task_id, {
      status: 'Completed',
      delivery_status: 'delivered',
      delivered_at: ts,
      delivery_photo_url: photo_url || null,
      delivery_drop_location: drop_location || null,
      driver_notes: `[DELIVERY CONFIRMED | ${ts}] driver: ${driver_email || user.email}${driver_name ? ` (${driver_name})` : ''}${drop_location ? ` | drop: ${drop_location}` : ''}`,
    });

    console.log(`[RECORD-DELIVERY] Task ${task_id} marked delivered by ${driver_email || user.email}`);

    // Sync to ShopifyOrder if linked
    if (task.order_id) {
      try {
        await base44.asServiceRole.functions.invoke('safeSyncOrderUpdate', {
          incomingData: {
            fulfillment_status: 'fulfilled',
            delivered_at: ts,
            delivered_by: driver_name || driver_email || user.email,
            delivery_photo_url: photo_url || null,
            internal_notes: `[DELIVERY | ${ts}] driver: ${driver_email || user.email}`,
          },
          source: 'operations',
          matchBy: { internal_id: task.order_id },
        });
      } catch (syncErr) {
        console.warn(`[RECORD-DELIVERY] Order sync failed (non-fatal): ${syncErr.message}`);
      }
    }

    return Response.json({
      status: 'success',
      task_id,
      action: 'mark_delivered',
      new_status: 'Completed',
      timestamp: ts,
    });

  } catch (error) {
    console.error('[RECORD-DELIVERY]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});