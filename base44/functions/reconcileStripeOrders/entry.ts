import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * AUTOMATION B: Stripe Record Reconciliation Job
 * Attempts to relink broken Stripe orders by fetching canonical Stripe objects
 */

const STRIPE_API_KEY = Deno.env.get('STRIPE_API_KEY');

async function getStripeCustomer(customerId) {
  if (!STRIPE_API_KEY || !customerId) return null;
  const res = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
    headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` },
  });
  return res.ok ? await res.json() : null;
}

async function getStripeObject(objectId, type) {
  if (!STRIPE_API_KEY || !objectId) return null;
  const endpoints = {
    'session': `/v1/checkout/sessions/${objectId}`,
    'intent': `/v1/payment_intents/${objectId}`,
    'invoice': `/v1/invoices/${objectId}`,
    'subscription': `/v1/subscriptions/${objectId}`,
  };
  const endpoint = endpoints[type];
  if (!endpoint) return null;
  const res = await fetch(`https://api.stripe.com${endpoint}`, {
    headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` },
  });
  return res.ok ? await res.json() : null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const result = {
      timestamp: new Date().toISOString(),
      reconciled_count: 0,
      needs_review_count: 0,
      actions: [],
    };

    // 1. Find orders in pending_reconciliation state or with broken linkage
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-updated_date', 100);
    const toReconcile = allOrders.filter(o => 
      o.sync_status === 'pending_reconciliation' ||
      (o.sync_status === 'synced' && o.shopify_order_id === 'base44_unknown') ||
      (o.stripe_customer_id && !o.stripe_payment_intent_id && !o.stripe_checkout_session_id)
    );

    // 2. For each order, try canonical repair
    for (const order of toReconcile.slice(0, 20)) {
      try {
        let repaired = false;
        let repairMethod = null;

        // Strategy 1: Try exact Stripe ID match
        if (order.stripe_payment_intent_id) {
          const intent = await getStripeObject(order.stripe_payment_intent_id, 'intent');
          if (intent && intent.status === 'succeeded') {
            const customer = await getStripeCustomer(intent.customer);
            await base44.asServiceRole.entities.ShopifyOrder.update(order.id, {
              stripe_customer_id: intent.customer,
              stripe_payment_intent_id: intent.id,
              customer_email: customer?.email || order.customer_email,
              customer_name: customer?.name || order.customer_name,
              sync_status: 'synced',
              repair_status: 'reconciled',
              repair_timestamp: new Date().toISOString(),
              repair_method: 'matched_payment_intent',
            });
            repaired = true;
            repairMethod = 'matched_payment_intent';
          }
        }

        // Strategy 2: Try related object lookup (customer -> sessions/intents)
        if (!repaired && order.stripe_customer_id) {
          const customersRes = await fetch(
            `https://api.stripe.com/v1/checkout/sessions?customer=${order.stripe_customer_id}&limit=5`,
            { headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` } }
          );
          if (customersRes.ok) {
            const sessionsData = await customersRes.json();
            const paidSessions = (sessionsData.data || []).filter(s => s.payment_status === 'paid');
            if (paidSessions.length > 0) {
              // Match by amount if possible
              const amountMatch = paidSessions.find(s => 
                Math.abs((s.amount_total || 0) / 100 - (order.total_price || 0)) < 0.5
              ) || paidSessions[0];

              await base44.asServiceRole.entities.ShopifyOrder.update(order.id, {
                stripe_checkout_session_id: amountMatch.id,
                stripe_payment_intent_id: amountMatch.payment_intent || order.stripe_payment_intent_id,
                sync_status: 'synced',
                repair_status: 'reconciled',
                repair_timestamp: new Date().toISOString(),
                repair_method: 'matched_related_session',
              });
              repaired = true;
              repairMethod = 'matched_related_session';
            }
          }
        }

        // Strategy 3: Try metadata-based match
        if (!repaired && order.customer_email) {
          const customersRes = await fetch(
            `https://api.stripe.com/v1/customers?email=${encodeURIComponent(order.customer_email)}&limit=5`,
            { headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` } }
          );
          if (customersRes.ok) {
            const customersData = await customersRes.json();
            if (customersData.data && customersData.data.length > 0) {
              const stripeCustomer = customersData.data[0];
              await base44.asServiceRole.entities.ShopifyOrder.update(order.id, {
                stripe_customer_id: stripeCustomer.id,
                customer_name: stripeCustomer.name || order.customer_name,
                sync_status: 'pending_reconciliation',
                repair_status: 'needs_review',
                repair_timestamp: new Date().toISOString(),
                repair_method: 'matched_by_email',
              });
              repaired = true;
              repairMethod = 'matched_by_email';
              result.needs_review_count += 1;
            }
          }
        }

        if (repaired) {
          result.reconciled_count += 1;
          result.actions.push({
            order_id: order.id,
            customer: order.customer_email,
            method: repairMethod,
            status: repairMethod === 'matched_by_email' ? 'pending_review' : 'reconciled',
          });
        } else {
          // Could not repair, keep in needs_review
          result.needs_review_count += 1;
          result.actions.push({
            order_id: order.id,
            customer: order.customer_email,
            method: 'failed_all_strategies',
            status: 'needs_manual_review',
          });
        }
      } catch (err) {
        console.error(`[RECONCILE] Failed to reconcile order ${order.id}:`, err.message);
        result.actions.push({
          order_id: order.id,
          error: err.message,
        });
      }
    }

    console.log(`[RECONCILE] Reconciled ${result.reconciled_count}, needs review: ${result.needs_review_count}`);
    return Response.json({ success: true, result });
  } catch (error) {
    console.error('[RECONCILE] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});