import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * autoArchiveRefundedOrders - Automatically archive refunded/canceled POS orders
 * 
 * This function:
 * - Updates order_status and operational_visibility for refunded/canceled orders
 * - Automatically moves refunded orders out of operational dashboards
 * - Keeps records in database for audit/accounting purposes
 * - Can be called after sync or as a scheduled cleanup
 * - Ensures fulfillment tasks for archived orders are marked canceled
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    // Admin-only
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const report = {
      status: 'IN_PROGRESS',
      timestamp: new Date().toISOString(),
      archived_orders: {
        refunded: 0,
        canceled: 0,
        total: 0,
        errors: [],
      },
      fulfillment_cleanup: {
        canceled_tasks: 0,
        errors: [],
      },
    };

    // Get all orders that are refunded or canceled but not yet archived
    const refundedOrders = await base44.entities.ShopifyOrder.filter({
      $or: [
        { payment_status: 'refunded' },
        { payment_status: 'partially_refunded' },
        { production_status: 'refunded' },
        { production_status: 'canceled' },
      ],
    });

    for (const order of refundedOrders) {
      try {
        // Skip if already archived
        if (order.order_status === 'refunded' || order.order_status === 'canceled' || order.operational_visibility === 'archived') {
          continue;
        }

        // Determine order_status based on payment or production status
        let newOrderStatus = 'archived';
        if (order.payment_status === 'refunded' || order.payment_status === 'partially_refunded') {
          newOrderStatus = 'refunded';
        } else if (order.production_status === 'refunded') {
          newOrderStatus = 'refunded';
        } else if (order.production_status === 'canceled') {
          newOrderStatus = 'canceled';
        }

        // Update order with archival metadata
        await base44.entities.ShopifyOrder.update(order.id, {
          order_status: newOrderStatus,
          operational_visibility: 'archived',
          tags: Array.from(new Set([
            ...(order.tags || []),
            'auto_archived',
            newOrderStatus === 'refunded' ? 'refunded_order' : 'canceled_order',
          ])),
          manual_override: true,
          manual_override_at: new Date().toISOString(),
          manual_override_by: 'auto_archive_system',
        });

        if (newOrderStatus === 'refunded') {
          report.archived_orders.refunded++;
        } else if (newOrderStatus === 'canceled') {
          report.archived_orders.canceled++;
        }
        report.archived_orders.total++;

      } catch (orderError) {
        report.archived_orders.errors.push({
          order_id: order.id,
          order_number: order.shopify_order_number,
          error: orderError.message,
        });
      }
    }

    // Find and cancel fulfillment tasks for archived orders
    try {
      const fulfillmentTasks = await base44.entities.FulfillmentTask.list();
      const archivedOrderIds = refundedOrders
        .filter(o => o.operational_visibility === 'archived')
        .map(o => o.id);

      for (const task of fulfillmentTasks) {
        if (archivedOrderIds.includes(task.order_id) && task.status !== 'Cancelled') {
          try {
            await base44.entities.FulfillmentTask.update(task.id, {
              status: 'Cancelled',
            });
            report.fulfillment_cleanup.canceled_tasks++;
          } catch (taskError) {
            report.fulfillment_cleanup.errors.push({
              task_id: task.id,
              error: taskError.message,
            });
          }
        }
      }
    } catch (fulfillmentError) {
      report.fulfillment_cleanup.errors.push({
        error: `Failed to process fulfillment tasks: ${fulfillmentError.message}`,
      });
    }

    report.status = report.archived_orders.errors.length === 0 && report.fulfillment_cleanup.errors.length === 0 ? 'SUCCESS' : 'COMPLETED_WITH_ERRORS';

    return Response.json(report);

  } catch (error) {
    return Response.json({
      status: 'FAILED',
      error: error.message,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
});