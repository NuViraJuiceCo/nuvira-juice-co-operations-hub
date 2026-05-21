import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Protected endpoint for Customer App to push driver status updates.
 * Accepts delivery confirmations, unable-to-deliver reports, and bag returns.
 * Routes through safeSyncOrderUpdate with delivery-specific protections.
 */

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    // Verify secret
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    if (token !== SYNC_SECRET) {
      return Response.json({ error: 'Invalid token' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const payload = await req.json();

    const {
      order_id,
      order_number,
      driver_email,
      action, // 'delivered', 'unable_to_deliver', 'bag_return_verified'
      delivery_photo_url,
      delivery_drop_location,
      delivery_notes,
      unable_reason,
      bag_data, // { small_bags_accepted, tote_bags_accepted, credit_issued, etc }
    } = payload;

    if (!order_number || !action) {
      return Response.json({ error: 'Missing order_number or action' }, { status: 400 });
    }

    // Find the order
    const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({
      shopify_order_number: order_number,
    }, '-created_date', 1);

    if (!orders.length) {
      return Response.json({ error: 'Order not found' }, { status: 404 });
    }

    const order = orders[0];
    const updateData = {};
    const auditLog = {
      timestamp: new Date().toISOString(),
      executed_by: driver_email || 'customer_app_driver',
      user_role: 'driver',
      repair_function: 'receiveDriverStatusUpdate',
      action: 'driver_update',
      records_affected: 1,
      reason: `Driver action: ${action}`,
      changes: {},
    };

    const now = new Date().toISOString();
    const nowLocal = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });

    // Build update payload based on action
    if (action === 'delivered') {
      updateData.production_status = 'fulfilled';
      updateData.fulfillment_status = 'fulfilled';
      updateData.delivered_at = now;
      updateData.delivered_by = driver_email || 'driver';
      updateData.delivery_photo_url = delivery_photo_url || null;
      updateData.delivery_drop_location = delivery_drop_location || null;
      updateData.internal_notes = (order.internal_notes || '') + `\n[Driver delivered on ${nowLocal}]` + (delivery_notes ? `\nNotes: ${delivery_notes}` : '');

      auditLog.changes = {
        status: 'fulfilled',
        delivery_confirmed: true,
        photo: delivery_photo_url ? 'captured' : 'none',
        location: delivery_drop_location,
      };

    } else if (action === 'unable_to_deliver') {
      updateData.internal_notes = (order.internal_notes || '') + `\n[Driver unable to deliver on ${nowLocal}]\nReason: ${unable_reason}` + (delivery_notes ? `\nNotes: ${delivery_notes}` : '');

      auditLog.changes = {
        status: 'unable_to_deliver',
        reason: unable_reason,
      };

    } else if (action === 'bag_return_verified') {
      if (bag_data) {
        updateData.internal_notes = (order.internal_notes || '') + `\n[Bag return verified on ${nowLocal}]` + `\nSmall bags: ${bag_data.small_bags_accepted}/${bag_data.small_bags_requested}, Tote bags: ${bag_data.tote_bags_accepted}/${bag_data.tote_bags_requested}` + (bag_data.credit_issued ? `\nCredit issued: $${bag_data.credit_issued.toFixed(2)}` : '');
      }
      auditLog.changes = {
        action: 'bag_return',
        bags: bag_data ? `${bag_data.small_bags_accepted}s/${bag_data.tote_bags_accepted}t` : 'none',
      };
    }

    // ── UPDATE LINKED FULFILLMENT TASK ────────────────────────────────────────
    // Find FulfillmentTask linked to this order and update its status directly
    let taskUpdateResult = null;
    try {
      const linkedTasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
        order_id: order.id,
      });
      const activeTasks = linkedTasks.filter(t =>
        !['Completed', 'Cancelled', 'cancelled', 'canceled'].includes(t.status)
      );

      for (const task of activeTasks) {
        const taskPatch = {};
        if (action === 'delivered') {
          taskPatch.status = 'Completed';
          taskPatch.delivered_at = now;
          if (delivery_photo_url) taskPatch.delivery_photo_url = delivery_photo_url;
          if (delivery_drop_location) taskPatch.delivery_drop_location = delivery_drop_location;
        } else if (action === 'unable_to_deliver') {
          taskPatch.status = 'Unable To Deliver';
          taskPatch.delivery_note = unable_reason || delivery_notes || 'Unable to deliver';
        }
        if (Object.keys(taskPatch).length > 0) {
          await base44.asServiceRole.entities.FulfillmentTask.update(task.id, taskPatch);
          taskUpdateResult = { task_id: task.id, updated: taskPatch };
          console.log(`[DRIVER-STATUS-UPDATE] FulfillmentTask ${task.id} updated: ${JSON.stringify(taskPatch)}`);
        }
      }
    } catch (taskErr) {
      console.warn(`[DRIVER-STATUS-UPDATE] FulfillmentTask update failed (non-fatal): ${taskErr.message}`);
    }

    // Route through safeSyncOrderUpdate to enforce protections
    const syncResponse = await base44.asServiceRole.functions.invoke('safeSyncOrderUpdate', {
      incomingData: updateData,
      source: 'customer_app_driver',
      matchBy: { shopify_order_id: order.shopify_order_id },
    });

    // Log the driver action
    await base44.asServiceRole.entities.RepairAuditLog.create(auditLog);

    if (action === 'delivered') {
      console.log('[DRIVER-UPDATE] Customer delivery email skipped; Customer App owns delivery notifications');
    }

    return Response.json({
      status: 'success',
      order_number,
      action,
      sync_result: syncResponse.data || 'accepted',
    });

  } catch (error) {
    console.error('[DRIVER-STATUS-UPDATE] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
