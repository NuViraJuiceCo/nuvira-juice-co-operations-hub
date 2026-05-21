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

    // Authorization: only assigned driver, admin, or operations staff can record delivery
    const body = await req.json();
    const { task_id, driver_email, driver_name, photo_url, drop_location, timestamp } = body;

    // ts is the canonical timestamp — use provided timestamp or generate now
    const ts = timestamp || new Date().toISOString();

    if (!task_id) {
      return Response.json({ error: 'task_id required' }, { status: 400 });
    }

    // Fetch task to validate authorization
    const tasks = await base44.asServiceRole.entities.FulfillmentTask.filter({ id: task_id });
    const task = tasks?.[0];

    if (!task) {
      return Response.json({ error: `FulfillmentTask not found: ${task_id}` }, { status: 404 });
    }

    // Guard: already delivered — return success (idempotent)
    if (task.status === 'Completed' && task.delivery_status === 'delivered') {
      console.log(`[RECORD-DELIVERY] Task ${task_id} already delivered — skipping duplicate write`);
      return Response.json({
        status: 'success',
        task_id,
        action: 'mark_delivered',
        new_status: 'Completed',
        timestamp: task.delivered_at || ts,
        idempotent: true,
      });
    }

    // Validate caller is authorized: assigned driver, admin, or operations role
    const isAssignedDriver = task.assigned_driver && (
      task.assigned_driver.toLowerCase() === user.email.toLowerCase() ||
      (driver_email && driver_email.toLowerCase() === user.email.toLowerCase())
    );
    const isOperations = user.role === 'admin' || user.role === 'operations_staff' || user.role === 'production_manager' || user.role === 'driver';
    
    if (!isAssignedDriver && !isOperations) {
      return Response.json({ error: 'Forbidden: Only assigned driver or operations staff can record delivery' }, { status: 403 });
    }

    // Update FulfillmentTask — status='Completed' is terminal, cannot be downgraded by any sync
    await base44.asServiceRole.entities.FulfillmentTask.update(task_id, {
      status: 'Completed',
      delivery_status: 'delivered',
      delivered_at: ts,
      delivery_photo_url: photo_url || null,
      delivery_drop_location: drop_location || null,
      driver_notes: `[DELIVERY CONFIRMED | ${ts}] driver: ${driver_email || user.email}${driver_name ? ` (${driver_name})` : ''}${drop_location ? ` | drop: ${drop_location}` : ''}`,
    });

    console.log(`[RECORD-DELIVERY] Task ${task_id} marked Completed (delivered) by ${driver_email || user.email} at ${ts}`);

    // Sync delivery completion directly to linked ShopifyOrder (operations-safe fields only)
    if (task.order_id) {
      try {
        // Fetch order to check terminal guards before writing
        const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({ id: task.order_id });
        const order = orders?.[0];
        if (order) {
          const isTerminal = order.payment_status === 'refunded' ||
            order.production_status === 'canceled' || order.production_status === 'cancelled' ||
            order.sync_status === 'do_not_sync' ||
            (Array.isArray(order.tags) && order.tags.includes('excluded'));
          if (isTerminal) {
            console.warn(`[RECORD-DELIVERY] Order ${task.order_id} is terminal — skipping ShopifyOrder sync`);
          } else {
            // Only write delivery-outcome fields — never touch Stripe, payment, address, line_items
            await base44.asServiceRole.entities.ShopifyOrder.update(task.order_id, {
              fulfillment_status: 'fulfilled',
              delivered_at: ts,
              delivered_by: driver_name || driver_email || user.email,
              delivery_photo_url: photo_url || null,
              internal_notes: `[DELIVERY | ${ts}] driver: ${driver_email || user.email}${drop_location ? ` | drop: ${drop_location}` : ''}`,
            });
            console.log(`[RECORD-DELIVERY] ShopifyOrder ${task.order_id} delivery sync successful`);
          }
        }
      } catch (syncErr) {
        console.error(`[RECORD-DELIVERY] ShopifyOrder sync failed: ${syncErr.message}`);
      }
    }

    // Customer App owns customer-facing delivery notifications. Hub only writes
    // operational delivery state/proof so duplicate customer emails cannot fire.
    console.log('[RECORD-DELIVERY] Customer delivery email skipped; Customer App owns delivery notifications');

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
