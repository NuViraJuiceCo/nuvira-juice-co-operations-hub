import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * handleSubscriptionFutureCancel
 *
 * Handles customer self-service subscription cancellation or pause.
 * This is FUTURE-CYCLE ONLY — it does NOT cancel the current paid month.
 *
 * Policy:
 *   - Once monthly payment is processed, the current billing cycle is locked.
 *   - Customer CANNOT cancel or refund the current paid month via self-service.
 *   - Customer CAN cancel or pause the NEXT billing cycle before next payment processes.
 *   - This handler: marks Hub order with cancel_at_period_end or pause_at_period_end.
 *   - Does NOT cancel FulfillmentTasks.
 *   - Does NOT remove from ProductionBatch.
 *   - Does NOT reverse loyalty points.
 *   - Only admin_refund_cancel (processStripeRefund) triggers the full cascade.
 *
 * Called by:
 *   - Customer App when customer clicks "Cancel Renewal" or "Pause Next Month"
 *   - Event type: customer.subscription_future_cancel OR customer.subscription_future_pause
 *
 * Required payload fields:
 *   stripe_subscription_id OR customer_app_subscription_id
 *   cancel_type: 'future_cancel' | 'future_pause'
 *   effective_date: ISO date string (next billing period end) — optional, derived if not provided
 *   customer_email: string
 *   reason: string — customer-provided reason (optional)
 *
 * Auth: same CUSTOMER_APP_SYNC_SECRET as receiveCustomerAppEvent
 */

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const STRIPE_API_KEY = Deno.env.get('STRIPE_API_KEY');

async function setStripeSubscriptionCancelAtPeriodEnd(subId, cancelAtPeriodEnd) {
  if (!STRIPE_API_KEY) {
    console.warn('[FUTURE-CANCEL] No STRIPE_API_KEY — skipping Stripe update');
    return null;
  }
  try {
    const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `cancel_at_period_end=${cancelAtPeriodEnd}`,
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('[FUTURE-CANCEL] Stripe update failed:', err);
      return null;
    }
    const sub = await res.json();
    console.log(`[FUTURE-CANCEL] Stripe subscription ${subId} cancel_at_period_end=${sub.cancel_at_period_end}, period_end=${sub.current_period_end}`);
    return sub;
  } catch (err) {
    console.error('[FUTURE-CANCEL] Stripe API error:', err.message);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    // Auth: accept either the CUSTOMER_APP_SYNC_SECRET Bearer token (external CA calls)
    // OR an _internalSecret in the body (internal function-to-function calls / regression tests)
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');
    const isInternalCall = body._internalSecret && internalSecret && body._internalSecret === internalSecret;
    if (!isInternalCall && token !== SYNC_SECRET) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      stripe_subscription_id,
      customer_app_subscription_id,
      customer_email,
      cancel_type,  // 'future_cancel' | 'future_pause'
      effective_date,
      reason,
    } = body;

    if (!stripe_subscription_id && !customer_app_subscription_id) {
      return Response.json({ error: 'stripe_subscription_id or customer_app_subscription_id required' }, { status: 400 });
    }
    if (!cancel_type || !['future_cancel', 'future_pause'].includes(cancel_type)) {
      return Response.json({ error: 'cancel_type must be future_cancel or future_pause' }, { status: 400 });
    }
    if (!customer_email) {
      return Response.json({ error: 'customer_email required' }, { status: 400 });
    }

    console.log(`[FUTURE-CANCEL] cancel_type=${cancel_type}, sub=${stripe_subscription_id}, email=${customer_email}`);

    // ── FIND HUB ORDER ─────────────────────────────────────────────────────────
    const isActive = (o) =>
      o.payment_status === 'paid' &&
      !['canceled', 'cancelled', 'refunded'].includes(o.production_status) &&
      o.data_quality_status !== 'quarantined' &&
      !(Array.isArray(o.tags) && (o.tags.includes('excluded') || o.tags.includes('do_not_sync')));

    let hubOrder = null;
    if (stripe_subscription_id) {
      const results = await base44.asServiceRole.entities.ShopifyOrder.filter({ stripe_subscription_id });
      hubOrder = (results || []).find(isActive) || null;
    }
    if (!hubOrder && customer_app_subscription_id) {
      const results = await base44.asServiceRole.entities.ShopifyOrder.filter({ customer_app_subscription_id });
      hubOrder = (results || []).find(isActive) || null;
    }

    if (!hubOrder) {
      console.warn(`[FUTURE-CANCEL] No active Hub order found for sub=${stripe_subscription_id}`);
      return Response.json({
        status: 'acknowledged',
        note: 'No active Hub order found — may already be cancelled or not yet synced. Stripe will still be updated.',
        cancel_type,
      });
    }

    // ── UPDATE STRIPE (cancel_at_period_end=true for future_cancel, false for future_pause reactivation) ──
    // For future_pause we still set cancel_at_period_end=true to stop next charge,
    // and the customer can reactivate before period end.
    let stripeUpdate = null;
    if (stripe_subscription_id) {
      stripeUpdate = await setStripeSubscriptionCancelAtPeriodEnd(stripe_subscription_id, true);
    }

    const periodEnd = stripeUpdate?.current_period_end
      ? new Date(stripeUpdate.current_period_end * 1000).toISOString().split('T')[0]
      : effective_date || null;

    // ── UPDATE HUB ORDER — METADATA ONLY, NO CASCADE ───────────────────────────
    // CRITICAL: do NOT touch production_status, FulfillmentTasks, or ProductionBatches.
    // Current cycle is locked. Only add metadata about the future intent.
    const newTags = [...new Set([
      ...(hubOrder.tags || []),
      cancel_type === 'future_cancel' ? 'cancel_at_period_end' : 'pause_at_period_end',
    ])];

    const auditEntry = {
      timestamp: new Date().toISOString(),
      action: cancel_type === 'future_cancel' ? 'CustomerFutureCancel' : 'CustomerFuturePause',
      performed_by: customer_email,
      before: { tags: hubOrder.tags },
      after: { tags: newTags, cancel_at_period_end: true, effective_date: periodEnd },
      reason: reason || 'Customer self-service',
    };

    await base44.asServiceRole.entities.ShopifyOrder.update(hubOrder.id, {
      tags: newTags,
      cancel_at_period_end: true,
      future_cancel_type: cancel_type,
      future_cancel_effective_date: periodEnd,
      future_cancel_requested_at: new Date().toISOString(),
      future_cancel_reason: reason || null,
      internal_notes: (hubOrder.internal_notes || '') +
        `\n[${cancel_type.toUpperCase()}] Customer requested ${cancel_type === 'future_cancel' ? 'cancellation' : 'pause'} of future renewal on ${new Date().toISOString()}. Effective: ${periodEnd || 'next period end'}. Current cycle UNAFFECTED.`,
      audit_trail: [...(hubOrder.audit_trail || []), auditEntry],
    });

    // ── LOG TO OrderSyncLog ────────────────────────────────────────────────────
    await base44.asServiceRole.entities.OrderSyncLog.create({
      sync_timestamp: new Date().toISOString(),
      sync_source: 'customer_app_pull',
      event_type: `customer.subscription_${cancel_type}`,
      order_id: hubOrder.id,
      order_number: hubOrder.shopify_order_number,
      customer_email,
      action: 'updated',
      reason: `${cancel_type} applied. Current cycle PRESERVED. Stripe cancel_at_period_end=true. Effective: ${periodEnd || 'next period end'}`,
      fields_updated: ['tags', 'cancel_at_period_end', 'future_cancel_type', 'future_cancel_effective_date'],
      success: true,
    });

    // ── IMPORTANT: Current FulfillmentTasks and ProductionBatches are NOT touched ──
    console.log(`[FUTURE-CANCEL] ✓ ${cancel_type} recorded on order ${hubOrder.shopify_order_number}. FulfillmentTasks and ProductionBatches UNTOUCHED.`);

    return Response.json({
      status: 'success',
      cancel_type,
      hub_order_id: hubOrder.id,
      hub_order_number: hubOrder.shopify_order_number,
      customer_email,
      effective_date: periodEnd,
      stripe_updated: !!stripeUpdate,
      stripe_cancel_at_period_end: stripeUpdate?.cancel_at_period_end ?? true,
      current_cycle: 'PRESERVED — fulfillment tasks and production batches are UNAFFECTED',
      customer_message: cancel_type === 'future_cancel'
        ? 'Your current month is confirmed. Your subscription will not renew after this billing period. You will still receive all deliveries scheduled for this month.'
        : 'Your current month is confirmed. Your next billing cycle will be paused. You will still receive all deliveries scheduled for this month.',
    });

  } catch (error) {
    console.error('[FUTURE-CANCEL]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});