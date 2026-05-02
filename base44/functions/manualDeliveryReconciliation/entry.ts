import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Manual reconciliation: Mark 5 orders as delivered on 2026-05-02
 * Driver completed deliveries in Customer App but webhook never reached Hub
 * This function creates audit trail and updates orders to fulfilled state
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const deliveredOrders = [
      { order_number: 'NV-MON7CNYB', customer: 'Jesse Kahlon', driver: 'driver_portal_user' },
      { order_number: 'NV-MOILSACV', customer: 'Danyelle Nisbet', driver: 'driver_portal_user' },
      { order_number: 'NV-MOILVI17', customer: 'Danyelle Nisbet', driver: 'driver_portal_user' },
      { order_number: 'NV-MOF1S04J', customer: 'Parminder P Singh', driver: 'driver_portal_user' },
      { order_number: 'NV-MODIHVQQ', customer: 'Zach Rootz', driver: 'driver_portal_user' },
    ];

    const results = [];
    const timestamp = new Date().toISOString();
    const today = '2026-05-02';

    for (const delivery of deliveredOrders) {
      try {
        // Get order
        const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({
          shopify_order_number: delivery.order_number,
        });

        if (!orders || orders.length === 0) {
          results.push({
            order_number: delivery.order_number,
            status: 'ERROR',
            error: 'Order not found',
          });
          continue;
        }

        const order = orders[0];

        // Update order to fulfilled with delivery marker
        await base44.asServiceRole.entities.ShopifyOrder.update(order.id, {
          production_status: 'fulfilled',
          delivered_at: timestamp,
          delivered_by: delivery.driver,
          delivery_drop_location: 'Main delivery (driver confirmed)',
          internal_notes: `[MANUAL-RECONCILE] Order delivered on ${today} via Driver Portal. No photo captured (manual reconciliation).`,
        });

        // Update fulfillment tasks to Completed
        const tasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
          order_id: order.id,
        });

        for (const task of tasks) {
          await base44.asServiceRole.entities.FulfillmentTask.update(task.id, {
            status: 'Completed',
          });
        }

        // Create audit log entry
        await base44.asServiceRole.entities.RepairAuditLog.create({
          timestamp: timestamp,
          executed_by: user.email,
          user_role: user.role,
          repair_function: 'manualDeliveryReconciliation',
          action: 'repair',
          records_affected: 2, // 1 order + 1 task
          reason: `Manual reconciliation: ${delivery.customer} delivery on ${today} was completed in Customer App Driver Portal but webhook did not reach Hub. Marked as fulfilled now.`,
          changes: {
            production_status: 'fulfilled',
            delivered_at: timestamp,
            delivered_by: delivery.driver,
            delivery_drop_location: 'Main delivery (driver confirmed)',
            fulfillment_task_status: 'Completed',
          },
          details: {
            order_number: delivery.order_number,
            customer: delivery.customer,
            order_id: order.id,
          },
          app_version: 'Driver Status Persistence Fix - Manual Reconciliation',
        });

        results.push({
          order_number: delivery.order_number,
          status: 'RECONCILED',
          order_id: order.id,
          timestamp_delivered: timestamp,
          tasks_updated: tasks.length,
          audit_log_created: true,
        });
      } catch (err) {
        results.push({
          order_number: delivery.order_number,
          status: 'ERROR',
          error: err.message,
        });
      }
    }

    return Response.json({
      status: 'success',
      timestamp: timestamp,
      reconciliation_results: results,
      summary: {
        total_processed: results.length,
        reconciled: results.filter(r => r.status === 'RECONCILED').length,
        errors: results.filter(r => r.status === 'ERROR').length,
      },
    });

  } catch (error) {
    console.error('[RECONCILE] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});