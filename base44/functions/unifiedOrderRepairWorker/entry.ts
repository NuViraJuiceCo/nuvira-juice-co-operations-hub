import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * UNIFIED ORDER REPAIR WORKER - Master Consolidation
 * 
 * Single source of truth for order repair across Stripe, Shopify, and Customer App sources.
 * CRITICAL RULE: Never destructive. Only enriches, never overwrites verified/locked fields.
 * 
 * Responsibilities:
 * - Detect broken orders (missing customer names, zero totals, #unknown)
 * - Repair only missing fields (external IDs, customer names if missing)
 * - Quarantine conflicts and risky payloads
 * - Respect order lock status
 * - Route dangerous repairs through Order Review Queue
 * - Preserve verified production records
 */

const STRIPE_API_KEY = Deno.env.get('STRIPE_API_KEY');

async function getStripeObject(objectId, objectType) {
  if (!STRIPE_API_KEY) throw new Error('Stripe API key not configured');

  const endpoints = {
    'checkout.session': `/v1/checkout/sessions/${objectId}`,
    'payment_intent': `/v1/payment_intents/${objectId}`,
    'invoice': `/v1/invoices/${objectId}`,
    'subscription': `/v1/subscriptions/${objectId}`,
  };

  const endpoint = endpoints[objectType];
  if (!endpoint) return null;

  const res = await fetch(`https://api.stripe.com${endpoint}`, {
    headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` },
  });

  return res.ok ? await res.json() : null;
}

async function repairOrderFromStripe(base44, order) {
  // Find best Stripe object to reconcile from
  const stripeObjects = [];
  
  if (order.stripe_subscription_id) {
    const sub = await getStripeObject(order.stripe_subscription_id, 'subscription');
    if (sub) stripeObjects.push({ type: 'subscription', data: sub, priority: 1 });
  }
  
  if (order.stripe_invoice_id) {
    const inv = await getStripeObject(order.stripe_invoice_id, 'invoice');
    if (inv) stripeObjects.push({ type: 'invoice', data: inv, priority: 2 });
  }
  
  if (order.stripe_payment_intent_id) {
    const intent = await getStripeObject(order.stripe_payment_intent_id, 'payment_intent');
    if (intent) stripeObjects.push({ type: 'payment_intent', data: intent, priority: 3 });
  }
  
  if (order.stripe_checkout_session_id) {
    const session = await getStripeObject(order.stripe_checkout_session_id, 'checkout.session');
    if (session) stripeObjects.push({ type: 'checkout.session', data: session, priority: 4 });
  }

  if (stripeObjects.length === 0) {
    return { repaired: false, reason: 'no_stripe_objects_found' };
  }

  // Sort by priority and use best object
  stripeObjects.sort((a, b) => a.priority - b.priority);
  const stripeData = stripeObjects[0].data;

  // Build repair payload — only enrich missing fields
  const repairPayload = {};
  let repairedFields = [];

  // Repair customer name only if missing
  if ((!order.customer_name || order.customer_name === 'Unknown') && stripeData.customer_name) {
    repairPayload.customer_name = stripeData.customer_name;
    repairedFields.push('customer_name');
  }

  // Repair email only if missing
  if ((!order.customer_email || order.customer_email === 'unknown@unknown.com') && stripeData.customer_email) {
    repairPayload.customer_email = stripeData.customer_email;
    repairedFields.push('customer_email');
  }

  // Repair total only if zero and we have amount
  if ((!order.total_price || order.total_price === 0) && stripeData.amount_total) {
    repairPayload.total_price = stripeData.amount_total / 100;
    repairPayload.subtotal = stripeData.amount_total / 100;
    repairedFields.push('total_price');
  }

  // Repair subscription linkage if missing
  if (!order.stripe_subscription_id && stripeData.subscription) {
    repairPayload.stripe_subscription_id = stripeData.subscription;
    repairedFields.push('stripe_subscription_id');
  }

  // Repair customer ID if missing
  if (!order.stripe_customer_id && stripeData.customer) {
    repairPayload.stripe_customer_id = stripeData.customer;
    repairedFields.push('stripe_customer_id');
  }

  // If no fields to repair, order is already complete
  if (repairedFields.length === 0) {
    return { repaired: false, reason: 'no_fields_to_repair' };
  }

  // CRITICAL: Check lock status — if production_scheduled or higher, quarantine
  if (['production_scheduled', 'in_production', 'out_for_delivery', 'fulfilled'].includes(order.order_lock_status)) {
    return {
      repaired: false,
      reason: 'order_is_locked',
      quarantine: true,
      quarantine_reason: `Order is locked at ${order.order_lock_status} — cannot repair`,
    };
  }

  // Safe to repair via safeSyncOrderUpdate
  try {
    const result = await base44.asServiceRole.functions.invoke('safeSyncOrderUpdate', {
      incomingData: repairPayload,
      source: 'unified_repair_worker',
      matchBy: { id: order.id },
    });

    return {
      repaired: true,
      fields_repaired: repairedFields,
      order_id: order.id,
      stripe_source_type: stripeObjects[0].type,
    };
  } catch (error) {
    return {
      repaired: false,
      reason: 'safe_sync_failed',
      error: error.message,
      quarantine: true,
    };
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Find broken orders: missing customer name, zero total, #unknown degradation
    const brokenOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({});
    
    const results = {
      scanned: 0,
      repaired: 0,
      quarantined: 0,
      already_valid: 0,
      locked: 0,
      repairs: [],
      quarantines: [],
    };

    for (const order of brokenOrders || []) {
      results.scanned++;

      // Skip if already locked at production or higher
      if (['production_scheduled', 'in_production', 'out_for_delivery', 'fulfilled'].includes(order.order_lock_status)) {
        results.locked++;
        continue;
      }

      // Check if broken
      const isBroken = 
        !order.customer_name || 
        order.customer_name === 'Unknown' ||
        !order.customer_email || 
        order.customer_email === 'unknown@unknown.com' ||
        !order.total_price || 
        order.total_price === 0;

      if (!isBroken) {
        results.already_valid++;
        continue;
      }

      // Attempt repair from Stripe
      const repairResult = await repairOrderFromStripe(base44, order);

      if (repairResult.repaired) {
        results.repaired++;
        results.repairs.push(repairResult);
        console.log(`[UNIFIED-REPAIR] Repaired order ${order.id}:`, repairResult.fields_repaired);
      } else if (repairResult.quarantine) {
        results.quarantined++;
        results.quarantines.push({
          order_id: order.id,
          order_number: order.shopify_order_number,
          reason: repairResult.quarantine_reason || repairResult.reason,
        });
        
        // Send to review queue
        await base44.asServiceRole.entities.OrderReviewQueue.create({
          incident_type: 'recovery_needs_review',
          customer_email: order.customer_email || 'unknown@local',
          customer_name: order.customer_name || 'Unknown',
          existing_order_id: order.id,
          existing_order_number: order.shopify_order_number,
          incoming_source: 'unified_repair_worker',
          issue_description: repairResult.quarantine_reason || `Repair blocked: ${repairResult.reason}`,
          recommended_action: 'manual_review',
          status: 'pending',
        });
        console.log(`[UNIFIED-REPAIR] Quarantined order ${order.id}: ${repairResult.quarantine_reason}`);
      }
    }

    return Response.json({
      success: true,
      scan_date: new Date().toISOString(),
      results,
    });
  } catch (error) {
    console.error('[UNIFIED-REPAIR]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});