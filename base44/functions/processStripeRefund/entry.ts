import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * STRIPE REFUND PROCESSOR
 * 
 * Triggered by Stripe webhook: charge.refunded or refund.created
 * Processes full/partial refunds and cascades through:
 *   - Hub ShopifyOrder (payment_status → refunded, production_status → canceled)
 *   - FulfillmentTasks (status → Cancelled)
 *   - ProductionBatches (remove from order_sources, recalculate planned_units)
 *   - Driver Portal (order auto-excluded)
 * 
 * Idempotent via refund_id and stripe_event_id tracking
 */

async function cancelFulfillmentTasksForOrder(base44, orderId) {
  try {
    const tasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
      order_id: orderId,
    });
    
    if (!tasks || tasks.length === 0) return [];
    
    const cancelled = [];
    for (const task of tasks) {
      if (task.status !== 'Cancelled' && task.status !== 'Completed') {
        await base44.asServiceRole.entities.FulfillmentTask.update(task.id, {
          status: 'Cancelled',
          delivery_status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          notes: (task.notes ? task.notes + '\n' : '') + 'Cancelled due to Stripe refund',
        });
        cancelled.push(task.id);
      }
    }
    return cancelled;
  } catch (err) {
    console.error(`[REFUND] FulfillmentTask cancellation error for order ${orderId}:`, err.message);
    return [];
  }
}

async function removeOrderFromProductionBatches(base44, orderId, orderNumber) {
  try {
    const batches = await base44.asServiceRole.entities.ProductionBatch.list('-production_date', 500);
    const updated = [];
    
    for (const batch of batches) {
      if (!batch.order_sources || batch.order_sources.length === 0) continue;
      
      const originalCount = batch.order_sources.length;
      const updatedSources = batch.order_sources.filter(
        src => src.order_id !== orderId && src.order_number !== orderNumber
      );
      
      if (updatedSources.length < originalCount) {
        // Calculate units to subtract
        const removedSources = batch.order_sources.filter(
          src => src.order_id === orderId || src.order_number === orderNumber
        );
        const unitsToSubtract = removedSources.reduce((sum, src) => sum + (src.quantity || 0), 0);
        const newPlannedUnits = Math.max(0, (batch.planned_units || 0) - unitsToSubtract);
        
        const auditEntry = {
          timestamp: new Date().toISOString(),
          action: 'RefundRemoval',
          performed_by: 'system_refund_processor',
          before: { order_sources_count: originalCount, planned_units: batch.planned_units },
          after: { order_sources_count: updatedSources.length, planned_units: newPlannedUnits },
          reason: `Refund removal for ${orderNumber}. Removed ${unitsToSubtract} units.`,
        };
        
        const updateData = {
          order_sources: updatedSources,
          planned_units: newPlannedUnits,
          audit_trail: [...(batch.audit_trail || []), auditEntry],
        };
        
        // If no valid order sources remain and status allows, archive
        if (updatedSources.length === 0 && newPlannedUnits === 0 && batch.status !== 'archived') {
          updateData.status = 'archived';
          console.log(`[REFUND] Batch ${batch.batch_id} archived (no remaining sources)`);
        }
        
        await base44.asServiceRole.entities.ProductionBatch.update(batch.id, updateData);
        updated.push({ batch_id: batch.batch_id, units_removed: unitsToSubtract });
      }
    }
    return updated;
  } catch (err) {
    console.error(`[REFUND] ProductionBatch update error for order ${orderNumber}:`, err.message);
    return [];
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      stripe_charge_id,              // From charge.refunded event
      stripe_refund_id,              // From refund event
      stripe_event_id,               // Idempotency key
      stripe_payment_intent_id,      // To find Hub order
      refund_amount,                 // Full amount refunded
      charge_amount,                 // Total charge amount
      manual_order_number,           // Override for finding order
    } = await req.json();

    if (!stripe_event_id || (!stripe_refund_id && !stripe_charge_id) || !stripe_payment_intent_id) {
      return Response.json({
        error: 'Missing required Stripe refund identifiers',
        required: ['stripe_event_id', '(stripe_refund_id OR stripe_charge_id)', 'stripe_payment_intent_id'],
      }, { status: 400 });
    }

    // IDEMPOTENCY: Check if this refund event was already processed
    const existingLogs = await base44.asServiceRole.entities.OrderSyncLog.filter({
      stripe_event_id: stripe_event_id,
      action: 'refund_processed',
    });

    if (existingLogs && existingLogs.length > 0) {
      console.log(`[REFUND] Idempotent: Refund event ${stripe_event_id} already processed`);
      return Response.json({
        status: 'skipped',
        reason: 'idempotent_already_processed',
        stripe_event_id,
        order_id: existingLogs[0].order_id,
      });
    }

    // FIND ORDER in Hub
    let hubOrder = null;
    if (manual_order_number) {
      const byNumber = await base44.asServiceRole.entities.ShopifyOrder.filter({
        shopify_order_number: manual_order_number,
      });
      if (byNumber && byNumber.length > 0) hubOrder = byNumber[0];
    }

    if (!hubOrder) {
      const byPI = await base44.asServiceRole.entities.ShopifyOrder.filter({
        stripe_payment_intent_id: stripe_payment_intent_id,
      });
      if (byPI && byPI.length > 0) hubOrder = byPI[0];
    }

    if (!hubOrder) {
      // Log refund with no matching order
      await base44.asServiceRole.entities.OrderSyncLog.create({
        sync_timestamp: new Date().toISOString(),
        sync_source: 'stripe_refund_webhook',
        event_type: 'charge.refunded',
        stripe_event_id: stripe_event_id,
        action: 'rejected',
        reason: `No order found for payment_intent=${stripe_payment_intent_id}`,
        success: false,
        customer_email: null,
      });

      return Response.json({
        status: 'order_not_found',
        stripe_payment_intent_id,
        stripe_event_id,
        refund_amount,
      });
    }

    // DETERMINE REFUND TYPE (full vs partial)
    const isFullRefund = Math.abs(refund_amount - charge_amount) < 0.01;
    
    if (!isFullRefund) {
      console.warn(`[REFUND] PARTIAL REFUND for ${hubOrder.shopify_order_number}: $${refund_amount} of $${charge_amount}. Flagging for manual review.`);
      await base44.asServiceRole.entities.OrderReviewQueue.create({
        incident_type: 'partial_refund_received',
        customer_email: hubOrder.customer_email,
        customer_name: hubOrder.customer_name,
        existing_order_id: hubOrder.id,
        existing_order_number: hubOrder.shopify_order_number,
        incoming_source: 'stripe_refund_webhook',
        incoming_payload: { refund_amount, charge_amount, stripe_refund_id },
        issue_description: `Partial refund received for $${refund_amount} (charge was $${charge_amount}). Requires manual review.`,
        recommended_action: 'manual_review',
        status: 'pending',
      });

      await base44.asServiceRole.entities.OrderSyncLog.create({
        sync_timestamp: new Date().toISOString(),
        sync_source: 'stripe_refund_webhook',
        event_type: 'charge.refunded',
        stripe_event_id: stripe_event_id,
        order_id: hubOrder.id,
        order_number: hubOrder.shopify_order_number,
        customer_email: hubOrder.customer_email,
        action: 'flagged',
        reason: `Partial refund $${refund_amount} of $${charge_amount} — manual review queued`,
        success: true,
      });

      return Response.json({
        status: 'partial_refund_flagged_for_review',
        order_number: hubOrder.shopify_order_number,
        refund_amount,
        charge_amount,
      });
    }

    // FULL REFUND: Process cascading cancellations
    console.log(`[REFUND] Processing FULL REFUND for ${hubOrder.shopify_order_number} ($${refund_amount})`);

    // Update Hub Order
    await base44.asServiceRole.entities.ShopifyOrder.update(hubOrder.id, {
      payment_status: 'refunded',
      production_status: 'canceled',
      fulfillment_status: 'cancelled',
      tags: [...(hubOrder.tags || []), 'refunded', 'excluded'],
      sync_status: 'do_not_sync',
      refunded_at: new Date().toISOString(),
      stripe_event_id_applied: stripe_event_id,
      internal_notes: (hubOrder.internal_notes || '') + `\n[REFUND] Stripe refund ${stripe_refund_id || stripe_charge_id} - $${refund_amount} on ${new Date().toISOString()}`,
      audit_trail: [
        ...(hubOrder.audit_trail || []),
        {
          timestamp: new Date().toISOString(),
          action: 'RefundProcessed',
          performed_by: 'system_stripe_webhook',
          before: { payment_status: hubOrder.payment_status, production_status: hubOrder.production_status },
          after: { payment_status: 'refunded', production_status: 'canceled' },
          reason: `Full Stripe refund: ${stripe_refund_id || stripe_charge_id}`,
        },
      ],
    });

    // Cancel linked FulfillmentTasks
    const cancelledTasks = await cancelFulfillmentTasksForOrder(base44, hubOrder.id);

    // Remove from ProductionBatches
    const batchUpdates = await removeOrderFromProductionBatches(base44, hubOrder.id, hubOrder.shopify_order_number);

    // Log success
    await base44.asServiceRole.entities.OrderSyncLog.create({
      sync_timestamp: new Date().toISOString(),
      sync_source: 'stripe_refund_webhook',
      event_type: 'charge.refunded',
      stripe_event_id: stripe_event_id,
      order_id: hubOrder.id,
      order_number: hubOrder.shopify_order_number,
      customer_email: hubOrder.customer_email,
      action: 'refund_processed',
      reason: `Full refund $${refund_amount}. Cancelled ${cancelledTasks.length} fulfillment tasks. Updated ${batchUpdates.length} production batches.`,
      success: true,
    });

    console.log(`[REFUND] Complete for ${hubOrder.shopify_order_number}: ${cancelledTasks.length} tasks cancelled, ${batchUpdates.length} batches updated`);

    return Response.json({
      status: 'refund_processed',
      order_number: hubOrder.shopify_order_number,
      order_id: hubOrder.id,
      refund_amount,
      fulfillment_tasks_cancelled: cancelledTasks.length,
      production_batches_updated: batchUpdates.length,
      batch_details: batchUpdates,
    });

  } catch (error) {
    console.error('[REFUND] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});