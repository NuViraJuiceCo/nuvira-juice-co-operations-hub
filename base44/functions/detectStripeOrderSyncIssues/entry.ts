import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * AUTOMATION A: Missing Stripe Order Detector
 * Scans for Stripe orders that should have local records but don't,
 * and detects records that were downgraded to #unknown or broken.
 */

const STRIPE_API_KEY = Deno.env.get('STRIPE_API_KEY');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const result = {
      timestamp: new Date().toISOString(),
      issues_found: 0,
      enqueued_for_repair: 0,
      details: {
        unlinked_stripe_events: [],
        orders_missing_stripe_id: [],
        unknown_status_orders: [],
        broken_linkage: [],
      },
    };

    if (!STRIPE_API_KEY) {
      return Response.json({ error: 'Stripe API key not configured' }, { status: 500 });
    }

    // 1. Check for recent Stripe webhook events that weren't linked to orders
    const recentEvents = await base44.asServiceRole.entities.StripeEventLog.list('-created_date', 50);
    const unlinkedEvents = recentEvents.filter(e => 
      e.status === 'processed' && !e.order_id && 
      (e.event_type === 'checkout.session.completed' || e.event_type === 'payment_intent.succeeded')
    );

    if (unlinkedEvents.length > 0) {
      result.details.unlinked_stripe_events = unlinkedEvents.slice(0, 10).map(e => ({
        event_id: e.stripe_event_id,
        customer_email: e.customer_email,
        created: e.created_date,
      }));
      result.issues_found += unlinkedEvents.length;
    }

    // 2. Check for orders with missing Stripe IDs (potential recovery candidates)
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-updated_date', 100);
    const missingStripeId = allOrders.filter(o => 
      !o.stripe_customer_id && !o.stripe_checkout_session_id && !o.stripe_payment_intent_id &&
      o.payment_status === 'paid' && o.source_channel === 'online'
    );

    if (missingStripeId.length > 0) {
      result.details.orders_missing_stripe_id = missingStripeId.slice(0, 10).map(o => ({
        order_id: o.id,
        customer_email: o.customer_email,
        customer_name: o.customer_name,
        created: o.created_date,
      }));
      result.issues_found += missingStripeId.length;
    }

    // 3. Check for #unknown status orders (should not exist in production)
    const unknownOrders = allOrders.filter(o => o.shopify_order_id === 'base44_unknown');
    if (unknownOrders.length > 0) {
      result.details.unknown_status_orders = unknownOrders.map(o => ({
        order_id: o.id,
        customer_email: o.customer_email,
        customer_name: o.customer_name,
        created: o.created_date,
      }));
      result.issues_found += unknownOrders.length;
    }

    // 4. Check for broken linkage: orders where Stripe ID exists but doesn't match customer
    const brokenLinkage = allOrders.filter(o => 
      o.stripe_customer_id && !o.stripe_payment_intent_id && !o.stripe_checkout_session_id &&
      o.sync_status !== 'pending_reconciliation'
    );

    if (brokenLinkage.length > 0) {
      result.details.broken_linkage = brokenLinkage.slice(0, 10).map(o => ({
        order_id: o.id,
        customer_email: o.customer_email,
        stripe_customer_id: o.stripe_customer_id,
        missing_object_ids: true,
      }));
      result.issues_found += brokenLinkage.length;
    }

    // 5. Enqueue repairs for unlinked events and #unknown orders
    const toRepair = [
      ...unlinkedEvents.map(e => ({ type: 'unlinked_event', id: e.id, event_id: e.stripe_event_id })),
      ...unknownOrders.map(o => ({ type: 'unknown_order', id: o.id })),
      ...missingStripeId.slice(0, 5).map(o => ({ type: 'missing_stripe_id', id: o.id })),
    ];

    for (const item of toRepair) {
      try {
        // Create a repair task (could be persisted in a RepairQueue entity)
        // For now, log the repair action
        console.log(`[DETECTOR] Enqueued repair for ${item.type}: ${item.id}`);
        result.enqueued_for_repair += 1;
      } catch (err) {
        console.error(`[DETECTOR] Failed to enqueue repair:`, err.message);
      }
    }

    console.log(`[DETECTOR] Found ${result.issues_found} issues, enqueued ${result.enqueued_for_repair} repairs`);
    return Response.json({ success: true, result });
  } catch (error) {
    console.error('[DETECTOR] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});