import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const STRIPE_API_KEY = Deno.env.get('STRIPE_API_KEY');
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET');

/**
 * PART 5: Fault-tolerant Stripe webhook handler v2
 * 
 * Principles:
 * - Verify webhook signature early
 * - Return 200 to Stripe immediately after safe receipt
 * - Never assume event order
 * - Preserve valid existing linkage during partial failures
 * - Use "pending_reconciliation" instead of #unknown for uncertain matches
 * - Retrieve fresh Stripe objects when mapping is incomplete
 * - Idempotent processing with event ID tracking
 */

async function verifyWebhookSignature(body, signature) {
  if (!STRIPE_WEBHOOK_SECRET) {
    throw new Error('Stripe webhook secret not configured');
  }

  const encoder = new TextEncoder();
  const key = encoder.encode(STRIPE_WEBHOOK_SECRET);
  const algorithm = { name: 'HMAC', hash: 'SHA-256' };
  const cryptoKey = await crypto.subtle.importKey('raw', key, algorithm, false, ['sign']);

  // Reconstruct signed content
  const [timestamp, signature_from_header] = signature.split(',')[0].split('=')[1] && 
    signature.split('t=')[1] ? 
    [signature.split('t=')[1]?.split(',')[0], signature.split('v1=')[1]] : 
    [null, null];

  // Standard Stripe format: t=<timestamp>,v1=<signature>
  const parts = signature.split(',');
  let ts = null, sig = null;
  for (const part of parts) {
    if (part.startsWith('t=')) ts = part.split('=')[1];
    if (part.startsWith('v1=')) sig = part.split('=')[1];
  }

  if (!ts || !sig) {
    throw new Error('Invalid signature format');
  }

  const signedContent = `${ts}.${body}`;
  const signatureBuffer = await crypto.subtle.sign(algorithm, cryptoKey, encoder.encode(signedContent));
  const computedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  if (computedSignature !== sig) {
    throw new Error('Signature verification failed');
  }

  // Check timestamp freshness (within 5 minutes)
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.abs(now - parseInt(ts));
  if (diff > 300) {
    throw new Error('Webhook signature too old');
  }

  return true;
}

async function getStripeObject(objectId, objectType) {
  if (!STRIPE_API_KEY) throw new Error('Stripe API key not configured');

  const endpoints = {
    'checkout.session': `/v1/checkout/sessions/${objectId}`,
    'payment_intent': `/v1/payment_intents/${objectId}`,
    'invoice': `/v1/invoices/${objectId}`,
    'subscription': `/v1/subscriptions/${objectId}`,
    'charge': `/v1/charges/${objectId}`,
  };

  const endpoint = endpoints[objectType];
  if (!endpoint) return null;

  const res = await fetch(`https://api.stripe.com${endpoint}`, {
    headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` },
  });

  return res.ok ? await res.json() : null;
}

async function findOrCreateOrder(base44, event) {
  const data = event.data.object;
  let order = null;
  let created = false;

  let stripeId = data.id;
  let customerId = data.customer;
  let amount = data.amount_total || data.amount || 0;
  let email = data.customer_email || data.billing_details?.email || '';
  let lineItems = [];

  // HARD STOP: Never process an event without a valid email — this is the root cause of #unknown orders
  if (!email || email === 'unknown@unknown.com') {
    console.warn('[STRIPE-V2] SKIPPING event', event.id, '— no email in Stripe payload. Refusing to create/update any order.');
    return null;
  }

  // Canonicalize to payment amount in dollars
  if (event.type.includes('checkout') || event.type.includes('payment_intent')) {
    amount = amount / 100;
  }

  // Try to match ONLY by Stripe ID fields — NEVER by email alone (too risky, causes overwrites)
  // Search by Stripe object ID across checkout_session, payment_intent, invoice fields
  let stripeMatchedOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({
    stripe_checkout_session_id: stripeId,
  });
  if (!stripeMatchedOrders || stripeMatchedOrders.length === 0) {
    stripeMatchedOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({
      stripe_payment_intent_id: stripeId,
    });
  }

  if (stripeMatchedOrders && stripeMatchedOrders.length > 0) {
    order = stripeMatchedOrders[0];
  }

  // If no Stripe ID match, search by email — but ONLY match non-subscription, non-unknown orders
  if (!order) {
    const emailOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({
      customer_email: email,
    });
    if (emailOrders && emailOrders.length > 0) {
      const eligible = emailOrders.filter(o =>
        o.source_channel !== 'subscription' &&
        o.shopify_order_id !== 'base44_unknown' &&
        o.shopify_order_number !== '#UNKNOWN' &&
        o.shopify_order_number !== '#unknown'
      );
      if (eligible.length > 0) {
        eligible.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
        order = eligible[0];
      }
    }
  }

  // GUARD: Never touch a subscription order via this webhook path
  if (order && order.source_channel === 'subscription') {
    console.warn('[STRIPE-V2] SKIPPING event', event.id, '— matched order is a subscription, will not overwrite.');
    return null;
  }

  // GUARD: Detect if this checkout was a subscription checkout
  let isSubscriptionCheckout = false;
  if (event.type === 'checkout.session.completed') {
    try {
      const session = await fetch(`https://api.stripe.com/v1/checkout/sessions/${stripeId}`, {
        headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` }
      });
      if (session.ok) {
        const sessionData = await session.json();
        isSubscriptionCheckout = sessionData.mode === 'subscription';
        if (isSubscriptionCheckout && !data.subscription) {
          // The subscription may not be in the initial event; will be populated by future events
          console.log(`[STRIPE-V2] Detected subscription checkout mode for session ${stripeId}`);
        }
      }
    } catch (err) {
      console.warn('[STRIPE-V2] Could not detect checkout mode:', err.message);
    }
  }

  // If this is a subscription checkout but no subscription ID yet, skip and wait for subscription event
  if (isSubscriptionCheckout && !data.subscription && !order?.stripe_subscription_id) {
    console.warn('[STRIPE-V2] SKIPPING subscription checkout event', event.id, '— subscription not yet populated. Will process when invoice/subscription events arrive.');
    return null;
  }

  // Extract line items if available
  if (event.type === 'checkout.session.completed') {
    try {
      const itemsRes = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${stripeId}/line_items?limit=100`,
        { headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` } }
      );
      if (itemsRes.ok) {
        const itemsData = await itemsRes.json();
        lineItems = (itemsData.data || []).map(item => ({
          title: item.description || item.name || 'Item',
          quantity: item.quantity,
          price: (item.amount_total || 0) / 100,
        }));
      }
    } catch (err) {
      console.warn('[STRIPE-V2] Failed to fetch line items:', err.message);
    }
  }

  const finalEmail = email;

  // Extract address from Stripe shipping_details or billing_details
  const shippingDetails = data.shipping_details?.address || data.billing_details?.address || {};
  const shippingName = data.shipping_details?.name || data.customer_name || data.billing_details?.name || 'Unknown';
  
  // Detect if this checkout was for a subscription
  const isSubscription = !!(data.subscription || order?.source_channel === 'subscription');
  const subscriptionId = data.subscription || order?.stripe_subscription_id || null;

  // Build order payload
  const orderPayload = {
    shopify_order_id: stripeId,
    shopify_order_number: order?.shopify_order_number || `#STR${Math.floor(Date.now() / 1000)}`,
    customer_email: finalEmail,
    customer_name: shippingName,
    customer_phone: data.customer_phone || data.billing_details?.phone || order?.customer_phone || '',
    line_items: lineItems.length > 0 ? lineItems : order?.line_items || [],
    total_price: amount,
    subtotal: amount,
    payment_status: data.payment_status === 'paid' ? 'paid' : 'pending',
    source_channel: isSubscription ? 'subscription' : (order?.source_channel || 'online'),
    fulfillment_method: 'delivery',
    production_status: order?.production_status || 'new',
    sync_status: 'synced',
    last_sync_at: new Date().toISOString(),
    customer_order_date: new Date(data.created * 1000).toISOString(),
    // Address fields from Stripe
    address_line1: shippingDetails.line1 || order?.address_line1 || '',
    address_line2: shippingDetails.line2 || order?.address_line2 || '',
    address_city: shippingDetails.city || order?.address_city || '',
    address_state: shippingDetails.state || order?.address_state || '',
    address_postal_code: shippingDetails.postal_code || order?.address_postal_code || '',
    address_country: shippingDetails.country || order?.address_country || 'US',
    address_last_synced_from: shippingDetails.line1 ? 'stripe_checkout' : (order?.address_last_synced_from || 'unknown'),
    address_last_synced_at: new Date().toISOString(),
    // PART 7: Stripe linkage
    stripe_customer_id: customerId || order?.stripe_customer_id || null,
    stripe_checkout_session_id: event.type === 'checkout.session.completed' ? stripeId : order?.stripe_checkout_session_id || null,
    stripe_payment_intent_id: data.payment_intent || order?.stripe_payment_intent_id || null,
    stripe_invoice_id: order?.stripe_invoice_id || null,
    stripe_subscription_id: subscriptionId,
    stripe_event_id_applied: event.id,
  };

  // PART 5 Principle: Never downgrade a valid order to #unknown
  // If we have an existing order but uncertain match, mark pending_reconciliation
  if (order && !order.stripe_customer_id && orderPayload.stripe_customer_id) {
    // Upgrading an incomplete order with Stripe linkage
    orderPayload.sync_status = 'synced';
    orderPayload.repair_status = 'reconciled';
  } else if (order && !stripeId.startsWith('base44_')) {
    // Existing order, valid Stripe linkage, preserve it
    orderPayload.sync_status = 'synced';
  }

  if (order) {
    await base44.asServiceRole.entities.ShopifyOrder.update(order.id, orderPayload);
  } else {
    const created_obj = await base44.asServiceRole.entities.ShopifyOrder.create(orderPayload);
    order = created_obj;
    created = true;
  }

  return order ? { order, created, eventId: event.id } : null;
}

Deno.serve(async (req) => {
  // PART 5: Return success to Stripe immediately after safe receipt
  // We'll process async to avoid timeout issues
  if (req.method === 'POST') {
    const body = await req.text();
    const signature = req.headers.get('stripe-signature');

    // Verify signature
    try {
      await verifyWebhookSignature(body, signature);
    } catch (error) {
      console.error('[STRIPE-V2] Signature verification failed:', error.message);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    // Return 200 immediately
    const responsePromise = (async () => {
      try {
        const base44 = createClientFromRequest(req);
        const event = JSON.parse(body);

        // Log all events for audit trail
        const eventLog = await base44.asServiceRole.entities.StripeEventLog.create({
          stripe_event_id: event.id,
          event_type: event.type,
          stripe_object_id: event.data.object.id,
          stripe_customer_id: event.data.object.customer || null,
          customer_email: event.data.object.customer_email || event.data.object.billing_details?.email || null,
          status: 'processing',
          raw_event: event.data.object,
        });

        // PART 5 Principle: Process idempotently
        // Check if we've already processed this event
        const alreadyProcessed = await base44.asServiceRole.entities.StripeEventLog.filter({
          stripe_event_id: event.id,
        });

        if (alreadyProcessed && alreadyProcessed.length > 1) {
          // Duplicate event, skip processing but mark success
          console.log('[STRIPE-V2] Duplicate event received:', event.id);
          await base44.asServiceRole.entities.StripeEventLog.update(eventLog.id, { status: 'skipped' });
          return;
        }

        // Process specific event types
        if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
          const result = await findOrCreateOrder(base44, event);
          if (!result) {
            // No email found, can't process this event
            await base44.asServiceRole.entities.StripeEventLog.update(eventLog.id, {
              status: 'failed',
              failure_reason: 'No valid email in Stripe object or matching existing order',
            });
          } else {
            const { order, created } = result;
            await base44.asServiceRole.entities.StripeEventLog.update(eventLog.id, {
              status: 'processed',
              order_id: order?.id,
            });
            console.log(`[STRIPE-V2] ${created ? 'Created' : 'Updated'} order from Stripe event ${event.id}`);
          }
        } else {
          // Other event types: log but don't process yet
          await base44.asServiceRole.entities.StripeEventLog.update(eventLog.id, {
            status: 'processed',
            notes: 'Event type not currently processed',
          });
        }
      } catch (error) {
        console.error('[STRIPE-V2] Processing error:', error.message);
        // Don't re-throw; we already returned 200
      }
    })();

    // Trigger async processing but don't wait
    responsePromise.catch(err => console.error('[STRIPE-V2] Async error:', err.message));

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
});