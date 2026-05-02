import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Apply refund status updates to all orders flagged by auditAllStripeRefundStatus.
 * Updates payment_status to "refunded" for orders with actual Stripe refunds.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // First, run the audit to get the list of orders to update
    const auditResult = await base44.asServiceRole.functions.invoke('auditAllStripeRefundStatus', {});
    const ordersToUpdate = auditResult.data?.orders_needing_refund_update || [];

    if (ordersToUpdate.length === 0) {
      return Response.json({
        status: 'success',
        updated_count: 0,
        message: 'No orders needed updating',
      });
    }

    let successCount = 0;
    let failureCount = 0;
    const failures = [];

    // Update each order
    for (const order of ordersToUpdate) {
      try {
        await base44.asServiceRole.entities.ShopifyOrder.update(order.order_id, {
          payment_status: 'refunded',
          last_reconciliation_at: new Date().toISOString(),
          internal_notes: `Payment status updated from "${order.current_payment_status}" to "refunded" based on Stripe refund audit. ${order.refund_count} refund(s) found totaling $${order.total_refund_amount.toFixed(2)}.`,
        });
        successCount++;
        console.log(`[UPDATE-REFUNDS] Updated ${order.order_number} to refunded status`);
      } catch (err) {
        failureCount++;
        failures.push({
          order_number: order.order_number,
          error: err.message,
        });
        console.error(`[UPDATE-REFUNDS] Failed to update ${order.order_number}:`, err.message);
      }
    }

    // Log the audit action
    await base44.asServiceRole.entities.RepairAuditLog.create({
      timestamp: new Date().toISOString(),
      executed_by: user.email,
      user_role: user.role,
      repair_function: 'updateRefundedOrdersFromAudit',
      action: 'reconcile',
      records_affected: successCount,
      reason: 'Bulk update of refund payment statuses based on Stripe audit',
      changes: {
        total_to_update: ordersToUpdate.length,
        successful: successCount,
        failed: failureCount,
      },
      details: {
        failures: failures,
      },
    });

    return Response.json({
      status: 'success',
      total_orders_processed: ordersToUpdate.length,
      updated_count: successCount,
      failed_count: failureCount,
      failures: failures.length > 0 ? failures : null,
      message: `Updated ${successCount} order${successCount !== 1 ? 's' : ''} to refunded status`,
    });

  } catch (error) {
    console.error('[UPDATE-REFUNDS] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});