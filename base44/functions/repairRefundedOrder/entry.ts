import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * REFUND REPAIR UTILITY
 * 
 * Manually repair stuck refunded orders (e.g., NV-MOVOAMIF).
 * Applies same refund cascade logic without waiting for Stripe webhook.
 * Idempotent: safe to run multiple times.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin authorization required' }, { status: 403 });
    }

    const { order_number, order_id, stripe_refund_id } = await req.json();

    if (!order_number && !order_id) {
      return Response.json({ error: 'Provide order_number or order_id' }, { status: 400 });
    }

    // Find order
    let hubOrder = null;
    if (order_id) {
      hubOrder = await base44.asServiceRole.entities.ShopifyOrder.get(order_id);
    } else {
      const byNumber = await base44.asServiceRole.entities.ShopifyOrder.filter({
        shopify_order_number: order_number,
      });
      if (byNumber && byNumber.length > 0) hubOrder = byNumber[0];
    }

    if (!hubOrder) {
      return Response.json({ error: `Order not found: ${order_number || order_id}` }, { status: 404 });
    }

    // Check if already refunded (idempotency)
    if (hubOrder.payment_status === 'refunded' && hubOrder.production_status === 'canceled') {
      console.log(`[REPAIR-REFUND] Order ${hubOrder.shopify_order_number} already refunded`);
      return Response.json({
        status: 'already_refunded',
        order_number: hubOrder.shopify_order_number,
        order_id: hubOrder.id,
      });
    }

    console.log(`[REPAIR-REFUND] Repairing ${hubOrder.shopify_order_number}...`);

    // Cancel FulfillmentTasks
    const tasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
      order_id: hubOrder.id,
    });

    let tasksCancelled = 0;
    if (tasks && tasks.length > 0) {
      for (const task of tasks) {
        if (task.status !== 'Cancelled' && task.status !== 'Completed') {
          await base44.asServiceRole.entities.FulfillmentTask.update(task.id, {
            status: 'Cancelled',
            delivery_status: 'cancelled',
            cancelled_at: new Date().toISOString(),
            notes: (task.notes || '') + '\nCancelled due to manual refund repair',
          });
          tasksCancelled++;
        }
      }
    }

    // Remove from ProductionBatches
    const batches = await base44.asServiceRole.entities.ProductionBatch.list('-production_date', 500);
    let batchesUpdated = 0;

    for (const batch of batches) {
      if (!batch.order_sources || batch.order_sources.length === 0) continue;

      const originalCount = batch.order_sources.length;
      const updatedSources = batch.order_sources.filter(
        src => src.order_id !== hubOrder.id && src.order_number !== hubOrder.shopify_order_number
      );

      if (updatedSources.length < originalCount) {
        const removedSources = batch.order_sources.filter(
          src => src.order_id === hubOrder.id || src.order_number === hubOrder.shopify_order_number
        );
        const unitsToSubtract = removedSources.reduce((sum, src) => sum + (src.quantity || 0), 0);
        const newPlannedUnits = Math.max(0, (batch.planned_units || 0) - unitsToSubtract);

        const auditEntry = {
          timestamp: new Date().toISOString(),
          action: 'RefundRepairRemoval',
          performed_by: user.email,
          before: { order_sources_count: originalCount, planned_units: batch.planned_units },
          after: { order_sources_count: updatedSources.length, planned_units: newPlannedUnits },
          reason: `Manual refund repair for ${hubOrder.shopify_order_number}. Removed ${unitsToSubtract} units.`,
        };

        const updateData = {
          order_sources: updatedSources,
          planned_units: newPlannedUnits,
          audit_trail: [...(batch.audit_trail || []), auditEntry],
        };

        if (updatedSources.length === 0 && newPlannedUnits === 0 && batch.status !== 'archived') {
          updateData.status = 'archived';
        }

        await base44.asServiceRole.entities.ProductionBatch.update(batch.id, updateData);
        batchesUpdated++;
      }
    }

    // Update ShopifyOrder
    await base44.asServiceRole.entities.ShopifyOrder.update(hubOrder.id, {
      payment_status: 'refunded',
      production_status: 'canceled',
      fulfillment_status: 'cancelled',
      tags: [...(hubOrder.tags || []), 'refunded', 'excluded'],
      sync_status: 'do_not_sync',
      refunded_at: new Date().toISOString(),
      internal_notes: (hubOrder.internal_notes || '') + `\n[MANUAL-REFUND-REPAIR] ${stripe_refund_id || 'manual'} on ${new Date().toISOString()}`,
      audit_trail: [
        ...(hubOrder.audit_trail || []),
        {
          timestamp: new Date().toISOString(),
          action: 'ManualRefundRepair',
          performed_by: user.email,
          before: { payment_status: hubOrder.payment_status, production_status: hubOrder.production_status },
          after: { payment_status: 'refunded', production_status: 'canceled' },
          reason: `Manual repair: ${stripe_refund_id || 'refund repair'} — Cancelled ${tasksCancelled} tasks, updated ${batchesUpdated} batches`,
        },
      ],
    });

    // Log repair
    await base44.asServiceRole.entities.RepairAuditLog.create({
      timestamp: new Date().toISOString(),
      executed_by: user.email,
      user_role: user.role,
      repair_function: 'repairRefundedOrder',
      action: 'repair',
      records_affected: 1 + tasksCancelled + batchesUpdated,
      reason: `Manual refund repair for ${hubOrder.shopify_order_number}`,
      changes: {
        order: { payment_status: 'refunded', production_status: 'canceled' },
        fulfillment_tasks_cancelled: tasksCancelled,
        production_batches_updated: batchesUpdated,
      },
    });

    console.log(`[REPAIR-REFUND] Complete: ${hubOrder.shopify_order_number} — ${tasksCancelled} tasks, ${batchesUpdated} batches`);

    return Response.json({
      status: 'refund_repair_complete',
      order_number: hubOrder.shopify_order_number,
      order_id: hubOrder.id,
      fulfillment_tasks_cancelled: tasksCancelled,
      production_batches_updated: batchesUpdated,
    });

  } catch (error) {
    console.error('[REPAIR-REFUND] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});