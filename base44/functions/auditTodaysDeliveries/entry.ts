import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Audit today's delivery records in detail
 * Reports on 6 completed + 1 pending delivery order status & sync history
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const orderNumbers = [
      'NV-MON7CNYB',   // Jesse Kahlon - delivered
      'NV-MOILSACV',   // Danyelle Nisbet #1 - delivered
      'NV-MOILVI17',   // Danyelle Nisbet #2 - delivered
      'NV-MOF1S04J',   // Parminder - delivered
      'NV-MODIHVQQ',   // Zach Rootz - delivered
      'NV-MON367R7',   // Deepa Jaswal - NOT delivered yet
    ];

    const results = [];
    const today = new Date().toISOString().split('T')[0];

    for (const orderNumber of orderNumbers) {
      try {
        // Get order
        const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({
          shopify_order_number: orderNumber,
        });

        if (!orders || orders.length === 0) {
          results.push({
            order_number: orderNumber,
            status: 'NOT_FOUND_IN_HUB',
            error: 'Order does not exist in Hub database',
          });
          continue;
        }

        const order = orders[0];

        // Get sync logs
        const syncLogs = await base44.asServiceRole.entities.OrderSyncLog.filter({
          order_id: order.id,
        }, '-sync_timestamp', 50);

        // Get fulfillment tasks
        const tasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
          order_id: order.id,
        });

        // Check for audit logs related to this order
        const auditLogs = await base44.asServiceRole.entities.RepairAuditLog.filter({}, '-timestamp', 100);
        const orderAuditLogs = auditLogs.filter(a => 
          a.notes?.includes(order.id) || 
          a.notes?.includes(orderNumber)
        );

        // Detect driver updates from sync logs
        const driverUpdates = syncLogs.filter(log =>
          log.sync_source === 'customer_app_driver' ||
          log.sync_source === 'customer_app_pull' ||
          (log.fields_updated && (log.fields_updated.includes('delivered_at') || log.fields_updated.includes('delivery_photo_url')))
        );

        const todaysSyncLogs = syncLogs.filter(log => 
          log.sync_timestamp && log.sync_timestamp.startsWith(today)
        );

        results.push({
          order_number: orderNumber,
          status: 'FOUND',
          
          // Order details
          hub_order_id: order.id,
          customer_name: order.customer_name,
          customer_email: order.customer_email,
          delivery_address: order.address_line1 ? 
            `${order.address_line1}${order.address_line2 ? ' ' + order.address_line2 : ''}, ${order.address_city}, ${order.address_state} ${order.address_postal_code}` 
            : 'MISSING',
          
          // Status fields (canonical check)
          production_status: order.production_status,
          fulfillment_status: order.fulfillment_status || 'N/A',
          fulfillment_method: order.fulfillment_method,
          
          // Delivery markers
          delivered_at: order.delivered_at || 'NOT SET',
          delivery_photo_url: order.delivery_photo_url ? 'PRESENT' : 'MISSING',
          delivery_drop_location: order.delivery_drop_location || 'N/A',
          delivered_by: order.delivered_by || 'N/A',
          
          // Payment
          payment_status: order.payment_status,
          
          // Task status
          fulfillment_tasks: {
            count: tasks.length,
            statuses: tasks.map(t => ({ id: t.id, status: t.status, date: t.scheduled_date })),
          },
          
          // Sync history
          total_sync_logs: syncLogs.length,
          todays_sync_logs: todaysSyncLogs.length,
          driver_updates_received: driverUpdates.length,
          last_sync: syncLogs[0] ? {
            timestamp: syncLogs[0].sync_timestamp,
            source: syncLogs[0].sync_source,
            action: syncLogs[0].action,
            fields: syncLogs[0].fields_updated,
          } : 'NEVER',
          
          // Audit trail
          audit_logs_found: orderAuditLogs.length,
          recent_audit: orderAuditLogs.length > 0 ? orderAuditLogs[0] : null,
          
          // Critical findings
          driver_update_missing: driverUpdates.length === 0,
          delivered_at_missing: !order.delivered_at,
          photo_missing: !order.delivery_photo_url,
          status_not_fulfilled: order.production_status !== 'fulfilled',
          task_not_updated: tasks.length > 0 && !tasks.every(t => ['Completed', 'Packed', 'In Transit'].includes(t.status)),
        });
      } catch (err) {
        results.push({
          order_number: orderNumber,
          status: 'ERROR',
          error: err.message,
        });
      }
    }

    // Summary
    const delivered = results.filter(r => r.status === 'FOUND' && r.delivered_at !== 'NOT SET').length;
    const notDelivered = results.filter(r => r.status === 'FOUND' && r.delivered_at === 'NOT SET').length;
    const driverUpdatesTotal = results.reduce((sum, r) => sum + (r.driver_updates_received || 0), 0);
    const auditLogsTotal = results.reduce((sum, r) => sum + (r.audit_logs_found || 0), 0);

    return Response.json({
      status: 'success',
      timestamp: new Date().toISOString(),
      summary: {
        total_orders_checked: results.length,
        marked_delivered_in_hub: delivered,
        not_marked_delivered: notDelivered,
        driver_updates_received_total: driverUpdatesTotal,
        audit_logs_found_total: auditLogsTotal,
        critical_issue: driverUpdatesTotal === 0 ? 'DRIVER UPDATES NEVER REACHED HUB' : 'All updates received',
      },
      orders: results,
    });

  } catch (error) {
    console.error('[AUDIT-DELIVERIES] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});