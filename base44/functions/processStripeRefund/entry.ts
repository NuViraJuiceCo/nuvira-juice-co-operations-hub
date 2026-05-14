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
    const body = await req.json();

    // Auth: accept valid INTERNAL_FUNCTION_SECRET OR authenticated admin user.
    // NOTE: Real Stripe webhooks arrive via stripeChargeRefundedWebhook (signature-verified).
    // This function is only called from: admin UI, internal automation, or that verified webhook handler.
    const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');
    const isInternalCall = body._internalSecret && internalSecret && body._internalSecret === internalSecret;
    if (!isInternalCall) {
      const user = await base44.auth.me();
      if (!user) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (user.role !== 'admin') {
        console.warn(`[REFUND] Denied: user ${user.email} (role=${user.role}) attempted to call processStripeRefund`);
        return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
      }
    }

    const {
      stripe_charge_id,              // From charge.refunded event
      stripe_refund_id,              // From refund event
      stripe_event_id,               // Idempotency key
      stripe_payment_intent_id,      // To find Hub order
      refund_amount,                 // Full amount refunded
      charge_amount,                 // Total charge amount
      manual_order_number,           // Override for finding order
      is_full_refund,                // Explicit full-refund flag from CA subscription cancellation path
      cancel_type,                   // 'admin_refund_cancel' | 'internal_test_owner_override' | undefined (Stripe webhook)
      admin_reason,                  // Required reason code for admin overrides
    } = body;

    // POLICY GUARD: This function is the FULL CASCADE path.
    // It must never be called from customer self-service future cancel/pause flows.
    // customer.subscription_future_cancel → handleSubscriptionFutureCancel (no cascade)
    // processStripeRefund → admin_refund_cancel or Stripe charge.refunded webhook ONLY

    // Validation: stripe_event_id always required for idempotency.
    // At least one of: stripe_refund_id, stripe_charge_id, stripe_payment_intent_id, OR manual_order_number
    // must be present to locate the order. CA subscription cancellation path provides
    // payment_intent_id + manual_order_number but no stripe_refund_id/stripe_charge_id — that's valid.
    const hasOrderLocator = stripe_refund_id || stripe_charge_id || stripe_payment_intent_id || manual_order_number;
    if (!stripe_event_id || !hasOrderLocator) {
      return Response.json({
        error: 'Missing required fields',
        required: ['stripe_event_id', 'at least one of: stripe_refund_id, stripe_charge_id, stripe_payment_intent_id, manual_order_number'],
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
    // Accept explicit is_full_refund=true flag (CA subscription cancellation path)
    // OR compute from amounts. If charge_amount is missing, default to full refund when is_full_refund=true.
    const effectiveChargeAmount = charge_amount || hubOrder.total_price || refund_amount || 0;
    const isFullRefund = is_full_refund === true || Math.abs((refund_amount || 0) - effectiveChargeAmount) < 0.01;
    
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

    // IDEMPOTENCY: If order is already in terminal refund state, skip cascade and log as skipped
    if (hubOrder.payment_status === 'refunded' && hubOrder.production_status === 'canceled') {
      console.log(`[REFUND] Order ${hubOrder.shopify_order_number} already cancelled — skipping duplicate cascade for event ${stripe_event_id}`);
      await base44.asServiceRole.entities.OrderSyncLog.create({
        sync_timestamp: new Date().toISOString(),
        sync_source: 'stripe_refund_webhook',
        event_type: 'charge.refunded',
        stripe_event_id: stripe_event_id,
        order_id: hubOrder.id,
        order_number: hubOrder.shopify_order_number,
        customer_email: hubOrder.customer_email,
        action: 'skipped',
        reason: 'Order already in refunded/canceled state — idempotent replay skipped',
        success: true,
      });
      return Response.json({
        status: 'skipped',
        reason: 'already_cancelled',
        order_number: hubOrder.shopify_order_number,
        order_id: hubOrder.id,
      });
    }

    // FULL REFUND: Process cascading cancellations
    // Determine the cancel type for audit logging
    const effectiveCancelType = cancel_type || 'admin_refund_cancel';
    const isInternalTest = cancel_type === 'internal_test_owner_override';
    console.log(`[REFUND] Processing FULL REFUND for ${hubOrder.shopify_order_number} ($${refund_amount}) — cancel_type=${effectiveCancelType}`);

    // Update Hub Order
    const cancelTags = ['refunded', 'excluded'];
    if (isInternalTest) cancelTags.push('internal_test_owner_override');
    const notePrefix = isInternalTest ? '[INTERNAL_TEST_OWNER_OVERRIDE]' : '[ADMIN_REFUND]';

    await base44.asServiceRole.entities.ShopifyOrder.update(hubOrder.id, {
      payment_status: 'refunded',
      production_status: 'canceled',
      fulfillment_status: 'cancelled',
      tags: [...new Set([...(hubOrder.tags || []), ...cancelTags])],
      sync_status: 'do_not_sync',
      refunded_at: new Date().toISOString(),
      stripe_event_id_applied: stripe_event_id,
      cancel_type: effectiveCancelType,
      internal_notes: (hubOrder.internal_notes || '') +
        `\n${notePrefix} Stripe refund ${stripe_refund_id || stripe_charge_id} - $${refund_amount} on ${new Date().toISOString()}` +
        (admin_reason ? ` | Reason: ${admin_reason}` : ''),
      audit_trail: [
        ...(hubOrder.audit_trail || []),
        {
          timestamp: new Date().toISOString(),
          action: isInternalTest ? 'InternalTestOwnerOverride' : 'AdminRefundCancel',
          performed_by: 'system_stripe_webhook',
          before: { payment_status: hubOrder.payment_status, production_status: hubOrder.production_status },
          after: { payment_status: 'refunded', production_status: 'canceled' },
          reason: admin_reason || `Full Stripe refund: ${stripe_refund_id || stripe_charge_id}`,
          cancel_type: effectiveCancelType,
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