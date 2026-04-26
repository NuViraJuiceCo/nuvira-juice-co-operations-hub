import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const STRIPE_API_KEY = Deno.env.get('STRIPE_API_KEY');
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET');

/**
 * HARDENED STRIPE WEBHOOK HANDLER v3
 * 
 * Principles:
 * - Verify signature & return 2xx immediately (safe receipt)
 * - Process async without blocking HTTP response
 * - Never assume event arrival order
 * - Never downgrade valid order to #unknown
 * - Idempotent: check event ID before processing
 * - Fetch fresh Stripe objects for reconciliation
 * - Preserve valid Stripe linkage even on temporary mapping failures
 */

async function verifyWebhookSignature(body, signature) {
  if (!STRIPE_WEBHOOK_SECRET) {
    throw new Error('Stripe webhook secret not configured');
  }

  const encoder = new TextEncoder();
  const key = encoder.encode(STRIPE_WEBHOOK_SECRET);
  const algorithm = { name: 'HMAC', hash: 'SHA-256' };
  const cryptoKey = await crypto.subtle.importKey('raw', key, algorithm, false, ['sign']);

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
    'customer': `/v1/customers/${objectId}`,
  };

  const endpoint = endpoints[objectType];
  if (!endpoint) return null;

  const res = await fetch(`https://api.stripe.com${endpoint}`, {
    headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` },
  });

  return res.ok ? await res.json() : null;
}

async function findOrReconcileOrder(base44, event, rawData) {
  const eventType = event.type;
  const eventId = event.id;
  
  // Extract key identifiers from event payload
  let stripeId = rawData.id;
  let customerId = rawData.customer;
  let email = rawData.customer_email || rawData.billing_details?.email || '';
  let amount = rawData.amount_total || rawData.amount || 0;

  // Canonicalize to dollars
  if (eventType.includes('checkout') || eventType.includes('payment_intent')) {
    amount = amount / 100;
  }

  // CRITICAL: Never process without valid email AND customer name
  if (!email || email === 'unknown@unknown.com') {
    console.warn('[STRIPE-HARDENED] Skipping event', eventId, '— no valid email in payload');
    return null;
  }

  if (!shippingName || shippingName === 'Unknown') {
    // Quarantine incomplete orders instead of creating #UNKNOWN
    console.warn('[STRIPE-HARDENED] Quarantining event', eventId, '— missing customer name');
    return { quarantine: true, reason: 'missing_customer_name', eventId, email, amount };
  }

  // PHASE 1: Try to find existing order by all known Stripe IDs
  const existingOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({
    customer_email: email,
  });

  let order = null;
  if (existingOrders && existingOrders.length > 0) {
    // Try exact match by Stripe IDs (priority order)
    order = existingOrders.find(o => 
      o.stripe_checkout_session_id === stripeId ||
      o.stripe_payment_intent_id === stripeId ||
      o.stripe_invoice_id === stripeId ||
      o.stripe_customer_id === customerId ||
      o.stripe_subscription_id === rawData.subscription
    );

    // If no exact match, use most recent (likely the one being updated)
    if (!order && !stripeId.startsWith('base44_')) {
      existingOrders.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
      order = existingOrders[0];
    }
  }

  // PHASE 2: Extract line items if available
  let lineItems = [];
  if (eventType === 'checkout.session.completed' && stripeId.startsWith('cs_')) {
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
      console.warn('[STRIPE-HARDENED] Failed to fetch line items:', err.message);
    }
  }

  // PHASE 3: Build address from Stripe
  const shippingDetails = rawData.shipping_details?.address || rawData.billing_details?.address || rawData.customer_details?.address || {};
  const shippingName = rawData.shipping_details?.name || rawData.customer_name || rawData.billing_details?.name || rawData.customer_details?.name || 'Unknown';

  // PHASE 4: Build order payload with full Stripe linkage
  const orderPayload = {
    shopify_order_id: stripeId,
    shopify_order_number: order?.shopify_order_number || `#STR${Math.floor(Date.now() / 1000)}`,
    customer_email: email,
    customer_name: shippingName,
    customer_phone: rawData.customer_phone || rawData.billing_details?.phone || order?.customer_phone || '',
    line_items: lineItems.length > 0 ? lineItems : order?.line_items || [],
    total_price: amount,
    subtotal: amount,
    payment_status: rawData.payment_status === 'paid' ? 'paid' : 'pending',
    source_channel: rawData.subscription ? 'subscription' : 'online',
    fulfillment_method: 'delivery',
    production_status: order?.production_status || 'new',
    sync_status: 'synced',
    last_sync_at: new Date().toISOString(),
    customer_order_date: new Date((rawData.created || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    
    // CANONICAL STRIPE LINKAGE
    stripe_customer_id: customerId || order?.stripe_customer_id || null,
    stripe_checkout_session_id: eventType.includes('checkout') ? stripeId : order?.stripe_checkout_session_id || null,
    stripe_payment_intent_id: rawData.payment_intent || order?.stripe_payment_intent_id || null,
    stripe_invoice_id: rawData.invoice || order?.stripe_invoice_id || null,
    stripe_subscription_id: rawData.subscription || order?.stripe_subscription_id || null,
    stripe_charge_id: rawData.charges?.data?.[0]?.id || order?.stripe_charge_id || null,
    stripe_event_id_applied: eventId,
    stripe_created_event_type: !order ? eventType : order.stripe_created_event_type,
    last_reconciliation_at: new Date().toISOString(),
    source_type: !order ? (rawData.subscription ? 'stripe_subscription' : 'stripe_checkout') : order.source_type,
    
    // Address
    address_line1: shippingDetails.line1 || order?.address_line1 || '',
    address_line2: shippingDetails.line2 || order?.address_line2 || '',
    address_city: shippingDetails.city || order?.address_city || '',
    address_state: shippingDetails.state || order?.address_state || '',
    address_postal_code: shippingDetails.postal_code || order?.address_postal_code || '',
    address_country: shippingDetails.country || order?.address_country || 'US',
    address_last_synced_from: shippingDetails.line1 ? 'stripe_checkout' : (order?.address_last_synced_from || 'stripe'),
    address_last_synced_at: new Date().toISOString(),
  };

  // PHASE 5: Route through safe gateway — enforces locks, subscription protection, field ownership
  const matchBy = {};
  if (rawData.subscription) matchBy.stripe_subscription_id = rawData.subscription;
  if (eventType.includes('checkout')) matchBy.stripe_checkout_session_id = stripeId;
  if (rawData.payment_intent) matchBy.stripe_payment_intent_id = rawData.payment_intent;
  if (rawData.invoice) matchBy.stripe_invoice_id = rawData.invoice;

  const result = await base44.asServiceRole.functions.invoke('safeSyncOrderUpdate', {
    incomingData: orderPayload,
    source: 'stripe_webhook',
    stripeEventId: eventId,
    matchBy,
  });

  const savedId = result?.data?.order_id;
  const wasCreated = result?.data?.action === 'created';
  return { order: { id: savedId, ...orderPayload }, created: wasCreated, eventId };
}

Deno.serve(async (req) => {
  if (req.method === 'POST') {
    const body = await req.text();
    const signature = req.headers.get('stripe-signature');

    // Verify signature
    try {
      await verifyWebhookSignature(body, signature);
    } catch (error) {
      console.error('[STRIPE-HARDENED] Signature verification failed:', error.message);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    // Return 2xx immediately to Stripe
    const responsePromise = (async () => {
      try {
        const base44 = createClientFromRequest(req);
        const event = JSON.parse(body);

        // Log event immediately
        await base44.asServiceRole.entities.StripeEventLog.create({
          stripe_event_id: event.id,
          event_type: event.type,
          stripe_object_id: event.data.object.id,
          stripe_customer_id: event.data.object.customer || null,
          customer_email: event.data.object.customer_email || event.data.object.billing_details?.email || null,
          status: 'processing',
          raw_event: event.data.object,
        });

        // IDEMPOTENCY: Check if already processed
        const alreadyProcessed = await base44.asServiceRole.entities.StripeEventLog.filter({
          stripe_event_id: event.id,
        });

        if (alreadyProcessed && alreadyProcessed.length > 1) {
          console.log('[STRIPE-HARDENED] Duplicate event, skipping:', event.id);
          await base44.asServiceRole.entities.StripeEventLog.update(alreadyProcessed[0].id, { status: 'skipped' });
          return;
        }

        // Process event
        if (event.type.includes('checkout') || event.type.includes('payment_intent') || event.type.includes('invoice')) {
          const result = await findOrReconcileOrder(base44, event, event.data.object);
          if (!result) {
            await base44.asServiceRole.entities.StripeEventLog.update(alreadyProcessed[0].id, {
              status: 'failed',
              failure_reason: 'No valid email or mapping failed',
            });
          } else if (result.quarantine) {
            // Quarantine incomplete orders for manual recovery
            await base44.asServiceRole.entities.OrderReviewQueue.create({
              incident_type: 'incomplete_payload',
              customer_email: result.email || 'unknown@stripe.local',
              customer_name: 'Stripe Payment (Missing Name)',
              incoming_source: 'stripe_webhook',
              incoming_payload: { event_id: result.eventId, amount: result.amount },
              issue_description: `Stripe ${result.reason}: payment received but customer identity incomplete. Requires manual resolution.`,
              recommended_action: 'manual_review',
              status: 'pending',
            });
            await base44.asServiceRole.entities.StripeEventLog.update(alreadyProcessed[0].id, {
              status: 'failed',
              failure_reason: result.reason,
            });
            console.log(`[STRIPE-HARDENED] Quarantined incomplete order from event ${event.id} — ${result.reason}`);
          } else {
            await base44.asServiceRole.entities.StripeEventLog.update(alreadyProcessed[0].id, {
              status: 'processed',
              order_id: result.order.id,
            });
            console.log(`[STRIPE-HARDENED] ${result.created ? 'Created' : 'Updated'} order from event ${event.id}`);
          }
        } else {
          await base44.asServiceRole.entities.StripeEventLog.update(alreadyProcessed[0].id, {
            status: 'processed',
            notes: 'Event type not currently processed',
          });
        }
      } catch (error) {
        console.error('[STRIPE-HARDENED] Processing error:', error.message);
      }
    })();

    responsePromise.catch(err => console.error('[STRIPE-HARDENED] Async error:', err.message));

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
});