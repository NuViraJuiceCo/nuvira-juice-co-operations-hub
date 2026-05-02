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

    // Build update payload based on action
    if (action === 'delivered') {
      updateData.production_status = 'fulfilled';
      updateData.delivered_at = new Date().toISOString();
      updateData.delivered_by = driver_email || 'driver';
      updateData.delivery_photo_url = delivery_photo_url;
      updateData.delivery_drop_location = delivery_drop_location;
      updateData.internal_notes = (order.internal_notes || '') + `\n[Driver delivered on ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })}]` + (delivery_notes ? `\nNotes: ${delivery_notes}` : '');
      
      auditLog.changes = {
        status: 'new -> fulfilled',
        delivery_confirmed: true,
        photo: delivery_photo_url ? 'captured' : 'none',
        location: delivery_drop_location,
      };

    } else if (action === 'unable_to_deliver') {
      updateData.production_status = 'new'; // Reset to allow rescheduling
      updateData.internal_notes = (order.internal_notes || '') + `\n[Driver unable to deliver on ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })}]\nReason: ${unable_reason}` + (delivery_notes ? `\nNotes: ${delivery_notes}` : '');
      
      auditLog.changes = {
        status: 'delivery_failed',
        reason: unable_reason,
        resettable: true,
      };

    } else if (action === 'bag_return_verified') {
      // Preserve existing status, but add bag return metadata
      if (bag_data) {
        updateData.internal_notes = (order.internal_notes || '') + `\n[Bag return verified on ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })}]` + `\nSmall bags: ${bag_data.small_bags_accepted}/${bag_data.small_bags_requested}, Tote bags: ${bag_data.tote_bags_accepted}/${bag_data.tote_bags_requested}` + (bag_data.credit_issued ? `\nCredit issued: $${bag_data.credit_issued.toFixed(2)}` : '');
      }
      
      auditLog.changes = {
        action: 'bag_return',
        bags: bag_data ? `${bag_data.small_bags_accepted}s/${bag_data.tote_bags_accepted}t` : 'none',
      };
    }

    // Route through safeSyncOrderUpdate to enforce protections
    const syncResponse = await base44.asServiceRole.functions.invoke('safeSyncOrderUpdate', {
      incomingData: updateData,
      source: 'customer_app_driver',
      matchBy: { shopify_order_id: order.shopify_order_id },
    });

    // Log the driver action
    await base44.asServiceRole.entities.RepairAuditLog.create(auditLog);

    // If delivered, send confirmation email to customer
    if (action === 'delivered' && order.customer_email) {
      try {
        await base44.integrations.Core.SendEmail({
          to: order.customer_email,
          subject: `Your NuVira order #${order_number} has been delivered! 🥤`,
          body: `Hi ${order.customer_name || 'there'}!\n\nYour order has been delivered to: ${delivery_drop_location || 'your address'}.\n\n${delivery_notes ? `Delivery notes: ${delivery_notes}\n\n` : ''}If you have any issues, please contact us.\n\nThank you for choosing NuVira!\n\nThe NuVira Team`,
        });
      } catch (emailError) {
        console.warn(`[DRIVER-UPDATE] Failed to send delivery confirmation email: ${emailError.message}`);
      }
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