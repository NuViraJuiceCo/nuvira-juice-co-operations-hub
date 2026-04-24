import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * MISSING STRIPE ORDER DETECTOR
 * 
 * Run every 5-15 minutes
 * 
 * Detects:
 * - Event log entries without linked local orders
 * - #unknown orders that have Stripe metadata
 * - Orders missing critical Stripe IDs
 * - Subscriptions without fulfillment instances
 * - Pending reconciliation orders
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const result = {
      timestamp: new Date().toISOString(),
      issues: [],
      total_checked: 0,
      ready_for_reconciliation: [],
    };

    // DETECTOR CHECK 1: Event log entries without linked orders
    const eventLog = await base44.asServiceRole.entities.StripeEventLog.list('-created_date', 300);
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500);

    const ordersByEventId = {};
    for (const o of allOrders) {
      if (o.stripe_event_id_applied) {
        ordersByEventId[o.stripe_event_id_applied] = o;
      }
    }

    for (const event of eventLog) {
      result.total_checked++;

      // Skip already-processed events
      if (event.status === 'processed' && event.order_id) continue;

      // Check if this event has a linked order
      const hasLinkedOrder = !!ordersByEventId[event.stripe_event_id];

      if (!hasLinkedOrder && event.status !== 'skipped') {
        result.issues.push({
          type: 'missing_order_for_event',
          event_id: event.stripe_event_id,
          event_type: event.event_type,
          stripe_object_id: event.stripe_object_id,
          customer_email: event.customer_email,
          status: event.status,
        });

        result.ready_for_reconciliation.push({
          event_id: event.stripe_event_id,
          stripe_object_id: event.stripe_object_id,
        });
      }
    }

    // DETECTOR CHECK 2: Orders with #unknown but valid Stripe metadata
    for (const order of allOrders) {
      if (!order.shopify_order_number?.includes('unknown') && !order.shopify_order_number?.includes('STR')) continue;

      // Check if has actual Stripe linkage
      if (order.stripe_customer_id || order.stripe_checkout_session_id || order.stripe_payment_intent_id) {
        result.issues.push({
          type: 'unknown_order_with_stripe_metadata',
          order_id: order.id,
          order_number: order.shopify_order_number,
          customer_email: order.customer_email,
          stripe_customer_id: order.stripe_customer_id,
        });

        result.ready_for_reconciliation.push({
          order_id: order.id,
          type: 'reconcile_unknown',
        });
      }
    }

    // DETECTOR CHECK 3: Orders in pending_reconciliation state
    for (const order of allOrders) {
      if (order.sync_status === 'pending_reconciliation') {
        result.issues.push({
          type: 'pending_reconciliation_order',
          order_id: order.id,
          customer_email: order.customer_email,
          pending_since: order.last_sync_at,
        });

        result.ready_for_reconciliation.push({
          order_id: order.id,
          type: 'reconcile_pending',
        });
      }
    }

    // DETECTOR CHECK 4: Subscription orders without fulfillments
    for (const order of allOrders) {
      if (order.source_channel !== 'subscription') continue;
      if (!order.stripe_subscription_id) continue;

      if (!order.fulfillments || order.fulfillments.length === 0) {
        result.issues.push({
          type: 'subscription_missing_fulfillments',
          order_id: order.id,
          customer_email: order.customer_email,
          stripe_subscription_id: order.stripe_subscription_id,
        });

        result.ready_for_reconciliation.push({
          order_id: order.id,
          type: 'regenerate_fulfillments',
        });
      }
    }

    // DETECTOR CHECK 5: Orders with incomplete Stripe linkage
    for (const order of allOrders) {
      if (order.source_type === 'stripe_checkout' && !order.stripe_checkout_session_id) {
        result.issues.push({
          type: 'incomplete_stripe_linkage',
          order_id: order.id,
          customer_email: order.customer_email,
          source_type: order.source_type,
          missing_field: 'stripe_checkout_session_id',
        });

        result.ready_for_reconciliation.push({
          order_id: order.id,
          type: 'repair_linkage',
        });
      }

      if (order.source_type === 'stripe_subscription' && !order.stripe_subscription_id) {
        result.issues.push({
          type: 'incomplete_stripe_linkage',
          order_id: order.id,
          customer_email: order.customer_email,
          source_type: order.source_type,
          missing_field: 'stripe_subscription_id',
        });

        result.ready_for_reconciliation.push({
          order_id: order.id,
          type: 'repair_linkage',
        });
      }
    }

    // AUTO-TRIGGER RECONCILIATION if significant issues found
    if (result.ready_for_reconciliation.length > 0) {
      try {
        const reconcileRes = await base44.asServiceRole.functions.invoke('stripeReconciliationWorker', {
          trigger_type: 'detector',
        });
        result.reconciliation_triggered = true;
        result.reconciliation_result = reconcileRes.data;
      } catch (err) {
        console.error('[DETECTOR] Reconciliation trigger failed:', err.message);
        result.reconciliation_error = err.message;
      }
    }

    return Response.json({ success: true, result });
  } catch (error) {
    console.error('[DETECTOR] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});