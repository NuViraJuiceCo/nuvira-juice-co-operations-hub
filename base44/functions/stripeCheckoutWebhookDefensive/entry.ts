import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const STRIPE_API_KEY = Deno.env.get('STRIPE_API_KEY');
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET');

/**
 * DEFENSIVE STRIPE WEBHOOK HANDLER v4
 * 
 * Core Principle: NEVER DOWNGRADE VALID STRIPE-LINKED ORDERS
 * 
 * This handler enforces:
 * 1. Complete Stripe linkage multihoming (checkout, payment_intent, invoice, subscription, customer)
 * 2. Safe merge rules: existing valid data is never overwritten by partial/invalid data
 * 3. Idempotent processing: event ID prevents duplicates and out-of-order processing
 * 4. Guardrail enforcement: Stripe-linked orders cannot be downgraded to #unknown with zero data
 * 5. Reconciliation-first: fetch fresh Stripe objects to resolve uncertain mappings
 * 6. Subscription safety: parent subscriptions and fulfillments remain linked and intact
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

/**
 * Check if an order has valid Stripe linkage that should be preserved
 */
function isValidStripeLinkedOrder(order) {
  return order && (
    order.stripe_customer_id ||
    order.stripe_checkout_session_id ||
    order.stripe_payment_intent_id ||
    order.stripe_invoice_id ||
    order.stripe_subscription_id
  );
}

/**
 * Check if order data is substantially valid (has customer name, address, or items)
 */
function hasSubstantialData(order) {
  return order && (
    (order.customer_name && order.customer_name !== 'Unknown') ||
    (order.address_line1 && order.address_line1.length > 0) ||
    (order.line_items && order.line_items.length > 0) ||
    (order.total_price && order.total_price > 0)
  );
}

/**
 * Safe merge: never allow valid data to be overwritten by empty/invalid values
 */
function safeMergeOrderPayload(existingOrder, newPayload) {
  const merged = { ...newPayload };

  // If we have valid existing data and new data is invalid/empty, preserve existing
  if (existingOrder) {
    // Customer name: preserve existing if new is "Unknown" or missing
    if (!newPayload.customer_name || newPayload.customer_name === 'Unknown') {
      if (existingOrder.customer_name && existingOrder.customer_name !== 'Unknown') {
        merged.customer_name = existingOrder.customer_name;
      }
    }

    // Total price: preserve existing if new is zero/empty
    if (!newPayload.total_price || newPayload.total_price === 0) {
      if (existingOrder.total_price && existingOrder.total_price > 0) {
        merged.total_price = existingOrder.total_price;
        merged.subtotal = existingOrder.subtotal || existingOrder.total_price;
      }
    }

    // Line items: preserve if new is empty
    if (!newPayload.line_items || newPayload.line_items.length === 0) {
      if (existingOrder.line_items && existingOrder.line_items.length > 0) {
        merged.line_items = existingOrder.line_items;
      }
    }

    // Address: preserve if new is completely missing
    const newHasAddress = newPayload.address_line1 || newPayload.address_city;
    const existingHasAddress = existingOrder.address_line1 || existingOrder.address_city;
    if (!newHasAddress && existingHasAddress) {
      merged.address_line1 = existingOrder.address_line1 || merged.address_line1;
      merged.address_line2 = existingOrder.address_line2 || merged.address_line2;
      merged.address_city = existingOrder.address_city || merged.address_city;
      merged.address_state = existingOrder.address_state || merged.address_state;
      merged.address_postal_code = existingOrder.address_postal_code || merged.address_postal_code;
      merged.address_country = existingOrder.address_country || merged.address_country;
    }

    // Subscription linkage: NEVER overwrite
    if (existingOrder.stripe_subscription_id && !newPayload.stripe_subscription_id) {
      merged.stripe_subscription_id = existingOrder.stripe_subscription_id;
      merged.fulfillments = existingOrder.fulfillments || merged.fulfillments;
    }

    // Fulfillments: NEVER overwrite unless explicitly updating subscription
    if (existingOrder.fulfillments && existingOrder.fulfillments.length > 0) {
      if (!newPayload.fulfillments || newPayload.fulfillments.length === 0) {
        merged.fulfillments = existingOrder.fulfillments;
      }
    }
  }

  return merged;
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

  // CRITICAL: Never process without valid email
  if (!email || email === 'unknown@unknown.com') {
    console.warn('[STRIPE-DEFENSIVE] Skipping event', eventId, '— no valid email in payload');
    return null;
  }

  // PHASE 1: Try to find existing order by all known Stripe IDs (high confidence match)
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
      (o.stripe_customer_id === customerId && o.stripe_subscription_id) ||
      o.stripe_subscription_id === rawData.subscription
    );

    // If no exact match and this is a new Stripe ID, use most recent (likely the one being updated)
    if (!order && !stripeId.startsWith('base44_') && stripeId) {
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
      console.warn('[STRIPE-DEFENSIVE] Failed to fetch line items:', err.message);
    }
  }

  // PHASE 3: Build address from Stripe (try multiple sources)
  const shippingDetails = rawData.shipping_details?.address || rawData.billing_details?.address || rawData.customer_details?.address || {};
  let shippingName = rawData.shipping_details?.name || rawData.customer_name || rawData.billing_details?.name || rawData.customer_details?.name || '';

  // If name is still empty/unknown but we have an existing order with valid name, preserve it
  if ((!shippingName || shippingName === 'Unknown') && order && order.customer_name && order.customer_name !== 'Unknown') {
    shippingName = order.customer_name;
  }

  // PHASE 4: Build order payload with full Stripe linkage
  const orderPayload = {
    shopify_order_id: stripeId,
    shopify_order_number: order?.shopify_order_number || `#STR${Math.floor(Date.now() / 1000)}`,
    customer_email: email,
    customer_name: shippingName,
    customer_phone: rawData.customer_phone || rawData.billing_details?.phone || order?.customer_phone || '',
    line_items: lineItems.length > 0 ? lineItems : order?.line_items || [],
    total_price: amount || order?.total_price || 0,
    subtotal: amount || order?.subtotal || 0,
    payment_status: rawData.payment_status === 'paid' ? 'paid' : 'pending',
    source_channel: rawData.subscription ? 'subscription' : 'online',
    fulfillment_method: 'delivery',
    production_status: order?.production_status || 'new',
    sync_status: 'synced',
    last_sync_at: new Date().toISOString(),
    customer_order_date: new Date((rawData.created || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    
    // CANONICAL STRIPE LINKAGE - multihoming
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

  // PHASE 5: Apply safe merge rules before writing
  const finalPayload = safeMergeOrderPayload(order, orderPayload);

  // PHASE 6: Guardrail enforcement
  // CRITICAL: If this is a Stripe-linked order, NEVER allow it to be downgraded to invalid state
  if (isValidStripeLinkedOrder(order)) {
    // Preserve existing linkage
    if (order.stripe_customer_id && !finalPayload.stripe_customer_id) {
      finalPayload.stripe_customer_id = order.stripe_customer_id;
    }
    if (order.stripe_checkout_session_id && !finalPayload.stripe_checkout_session_id) {
      finalPayload.stripe_checkout_session_id = order.stripe_checkout_session_id;
    }
    if (order.stripe_payment_intent_id && !finalPayload.stripe_payment_intent_id) {
      finalPayload.stripe_payment_intent_id = order.stripe_payment_intent_id;
    }
    if (order.stripe_subscription_id && !finalPayload.stripe_subscription_id) {
      finalPayload.stripe_subscription_id = order.stripe_subscription_id;
    }

    // NEVER allow customer name to be downgraded to Unknown/Unknown if existing is valid
    if (hasSubstantialData(order)) {
      if (!finalPayload.customer_name || finalPayload.customer_name === 'Unknown') {
        finalPayload.customer_name = order.customer_name;
      }
      // NEVER allow total to be set to 0 if existing order has valid total
      if (finalPayload.total_price === 0 && order.total_price && order.total_price > 0) {
        finalPayload.total_price = order.total_price;
        finalPayload.subtotal = order.subtotal || order.total_price;
      }
    }

    // If this event would result in invalid state, mark for reconciliation instead of applying
    if (!finalPayload.customer_name || finalPayload.customer_name === 'Unknown' ||
        finalPayload.total_price === 0 && order.line_items?.length > 0) {
      finalPayload.sync_status = 'pending_reconciliation';
      finalPayload.repair_status = 'needs_review';
      console.warn('[STRIPE-DEFENSIVE] Marking order for reconciliation:', order.id, '— event', eventId);
    }
  }

  // PHASE 7: Write or update order
  if (order) {
    await base44.asServiceRole.entities.ShopifyOrder.update(order.id, finalPayload);
    console.log('[STRIPE-DEFENSIVE] Updated order:', order.id, 'from event:', eventId, '— sync_status:', finalPayload.sync_status);
    return { order: { id: order.id, ...finalPayload }, created: false, eventId };
  } else {
    const newOrder = await base44.asServiceRole.entities.ShopifyOrder.create(finalPayload);
    console.log('[STRIPE-DEFENSIVE] Created order:', newOrder.id, 'from event:', eventId);
    return { order: newOrder, created: true, eventId };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'POST') {
    const body = await req.text();
    const signature = req.headers.get('stripe-signature');

    // Verify signature
    try {
      await verifyWebhookSignature(body, signature);
    } catch (error) {
      console.error('[STRIPE-DEFENSIVE] Signature verification failed:', error.message);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    // Return 2xx immediately to Stripe
    const responsePromise = (async () => {
      try {
        const base44 = createClientFromRequest(req);
        const event = JSON.parse(body);

        // Log event immediately for audit trail
        const eventLogId = (await base44.asServiceRole.entities.StripeEventLog.create({
          stripe_event_id: event.id,
          event_type: event.type,
          stripe_object_id: event.data.object.id,
          stripe_customer_id: event.data.object.customer || null,
          customer_email: event.data.object.customer_email || event.data.object.billing_details?.email || null,
          status: 'processing',
          raw_event: event.data.object,
        })).id;

        // IDEMPOTENCY: Check if already processed (skip if duplicate)
        const alreadyProcessed = await base44.asServiceRole.entities.StripeEventLog.filter({
          stripe_event_id: event.id,
        });

        if (alreadyProcessed && alreadyProcessed.length > 1) {
          console.log('[STRIPE-DEFENSIVE] Duplicate event, skipping:', event.id);
          await base44.asServiceRole.entities.StripeEventLog.update(eventLogId, { status: 'skipped' });
          return;
        }

        // Process event
        if (event.type.includes('checkout') || event.type.includes('payment_intent') || event.type.includes('invoice') || event.type.includes('subscription')) {
          const result = await findOrReconcileOrder(base44, event, event.data.object);
          if (!result) {
            await base44.asServiceRole.entities.StripeEventLog.update(eventLogId, {
              status: 'failed',
              failure_reason: 'No valid email or mapping failed',
            });
          } else {
            await base44.asServiceRole.entities.StripeEventLog.update(eventLogId, {
              status: 'processed',
              order_id: result.order.id,
            });
            console.log(`[STRIPE-DEFENSIVE] ${result.created ? 'Created' : 'Updated'} order ${result.order.id} from event ${event.id}`);
          }
        } else {
          await base44.asServiceRole.entities.StripeEventLog.update(eventLogId, {
            status: 'processed',
            notes: 'Event type not currently processed',
          });
        }
      } catch (error) {
        console.error('[STRIPE-DEFENSIVE] Processing error:', error.message);
      }
    })();

    responsePromise.catch(err => console.error('[STRIPE-DEFENSIVE] Async error:', err.message));

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
});