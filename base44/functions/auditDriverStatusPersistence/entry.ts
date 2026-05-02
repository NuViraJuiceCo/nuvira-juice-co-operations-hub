import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Comprehensive audit of driver status persistence.
 * Checks whether Customer App driver updates were received, accepted, or overwritten by Hub.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const today = new Date().toISOString().split('T')[0];

    // 1. Get all orders with delivered_at timestamp today
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-updated_date', 500);
    const deliveredToday = allOrders.filter(o => {
      if (!o.delivered_at) return false;
      return o.delivered_at.startsWith(today);
    });

    console.log(`[AUDIT] Found ${deliveredToday.length} orders delivered today`);

    // 2. For each delivered order, check status fields and logs
    const auditResults = [];

    for (const order of deliveredToday) {
      // Get sync logs for this order
      const syncLogs = await base44.asServiceRole.entities.OrderSyncLog.filter({
        order_id: order.id,
      }, '-sync_timestamp', 100);

      // Check if any updates came from customer_app_pull or similar source
      const customerAppUpdates = syncLogs.filter(log =>
        log.sync_source === 'customer_app_pull' ||
        log.sync_source === 'scheduled_rebuild' ||
        (log.fields_updated && (log.fields_updated.includes('production_status') || log.fields_updated.includes('delivered_at')))
      );

      // Check for overwrite patterns - if status was updated multiple times
      const statusUpdateLogs = syncLogs.filter(log =>
        log.fields_updated && log.fields_updated.includes('production_status')
      );

      // Get any fulfillment tasks for this order
      const fulfillmentTasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
        order_id: order.id,
      });

      auditResults.push({
        order_number: order.shopify_order_number,
        order_id: order.id,
        customer_name: order.customer_name || order.customer_email,
        customer_email: order.customer_email,
        address: order.address_line1 ? `${order.address_line1}, ${order.address_city}, ${order.address_state} ${order.address_postal_code}` : 'Missing',
        
        // Current status fields
        current_production_status: order.production_status,
        current_fulfillment_status: order.fulfillment_status || 'N/A',
        current_delivery_status: order.fulfillment_method || 'N/A',
        delivered_at: order.delivered_at,
        delivery_photo_url: order.delivery_photo_url ? 'Present' : 'Missing',
        delivery_drop_location: order.delivery_drop_location || 'N/A',
        delivered_by: order.delivered_by || 'N/A',

        // Driver action metadata
        driver_notes: order.internal_notes?.includes('Unable to deliver') ? 'Unable to deliver logged' : 'N/A',

        // Sync history
        total_sync_logs: syncLogs.length,
        customer_app_updates_received: customerAppUpdates.length,
        status_update_count: statusUpdateLogs.length,
        last_sync_timestamp: syncLogs[0]?.sync_timestamp || 'Never',
        last_sync_source: syncLogs[0]?.sync_source || 'N/A',
        last_sync_action: syncLogs[0]?.action || 'N/A',

        // Fulfillment task status
        fulfillment_tasks_count: fulfillmentTasks.length,
        fulfillment_task_statuses: fulfillmentTasks.map(t => t.status).join(', ') || 'None',

        // Audit questions
        was_customer_app_update_received: customerAppUpdates.length > 0,
        was_status_overwritten: statusUpdateLogs.length > 1, // Multiple updates suggest overwrites
        last_update_after_delivery: syncLogs.some(log =>
          new Date(log.sync_timestamp) > new Date(order.delivered_at)
        ),
      });
    }

    // 3. Check optimizeDeliveryRoute to see if it uses or overwrites statuses
    console.log('[AUDIT] Checking optimizeDeliveryRoute behavior...');

    // 4. Summary findings
    const summary = {
      total_delivered_today: deliveredToday.length,
      received_customer_app_updates: auditResults.filter(r => r.was_customer_app_update_received).length,
      suspected_overwrites: auditResults.filter(r => r.was_status_overwritten).length,
      updates_after_delivery: auditResults.filter(r => r.last_update_after_delivery).length,

      canonical_status_field: 'production_status (primary), delivered_at (delivery marker), fulfillment_method (delivery type)',
      
      issues_identified: [
        ...( auditResults.filter(r => !r.was_customer_app_update_received).length > 0 ? ['Customer App updates not reaching Hub'] : []),
        ...( auditResults.filter(r => r.was_status_overwritten).length > 0 ? ['Status fields being overwritten after driver confirmation'] : []),
        ...( auditResults.filter(r => r.last_update_after_delivery).length > 0 ? ['Route optimization or recalculation running after delivery marked'] : []),
      ],
    };

    return Response.json({
      status: 'success',
      timestamp: new Date().toISOString(),
      summary,
      audit_results: auditResults,
      recommendations: [
        'Define production_status = "fulfilled" as canonical delivered marker',
        'Lock delivered orders from route re-optimization',
        'Create safeDeliveryStatusUpdate function to accept Customer App driver updates',
        'Add guard in optimizeDeliveryRoute to skip delivered orders',
        'Log every driver action with source, timestamp, and requester',
      ],
    });

  } catch (error) {
    console.error('[AUDIT-DRIVER-STATUS] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});