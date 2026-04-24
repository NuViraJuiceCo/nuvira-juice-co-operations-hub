import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const STRIPE_API_KEY = Deno.env.get('STRIPE_API_KEY');

/**
 * STRIPE RECONCILIATION WORKER
 * 
 * Triggered by detector or nightly automation
 * 
 * Purpose:
 * - Fetch latest Stripe objects
 * - Detect missing/broken local orders
 * - Restore linkage by canonical matching
 * - Create missing orders
 * - Mark repaired records
 */

async function getStripeObject(objectId, objectType) {
  if (!STRIPE_API_KEY) throw new Error('Stripe API key not configured');

  const endpoints = {
    'checkout.session': `/v1/checkout/sessions/${objectId}`,
    'payment_intent': `/v1/payment_intents/${objectId}`,
    'invoice': `/v1/invoices/${objectId}`,
    'subscription': `/v1/subscriptions/${objectId}`,
    'customer': `/v1/customers/${objectId}`,
  };

  const endpoint = endpoints[objectType];
  if (!endpoint) return null;

  const res = await fetch(`https://api.stripe.com${endpoint}`, {
    headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` },
  });

  return res.ok ? await res.json() : null;
}

async function reconcileOrderFromStripeObject(base44, stripeObj, objectType) {
  const email = stripeObj.customer_email || stripeObj.billing_details?.email || stripeObj.customer_details?.email;
  if (!email || email === 'unknown@unknown.com') {
    return { repaired: false, reason: 'no_email' };
  }

  const customerId = stripeObj.customer;
  const stripeId = stripeObj.id;

  // Find or create local order
  const existingOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({
    customer_email: email,
  });

  let order = null;
  if (existingOrders && existingOrders.length > 0) {
    // Try exact match by Stripe IDs
    order = existingOrders.find(o =>
      o.stripe_checkout_session_id === stripeId ||
      o.stripe_payment_intent_id === stripeId ||
      o.stripe_invoice_id === stripeId ||
      o.stripe_customer_id === customerId
    );

    if (!order) {
      existingOrders.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
      order = existingOrders[0];
    }
  }

  // Extract line items
  let lineItems = [];
  if (objectType === 'checkout.session' && stripeId.startsWith('cs_')) {
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
      console.warn('[RECONCILE] Failed to fetch line items:', err.message);
    }
  }

  // Build address
  const shippingDetails = stripeObj.shipping_details?.address || stripeObj.billing_details?.address || stripeObj.customer_details?.address || {};
  const shippingName = stripeObj.shipping_details?.name || stripeObj.customer_name || stripeObj.billing_details?.name || stripeObj.customer_details?.name || 'Unknown';

  // Build payload
  const payload = {
    shopify_order_id: stripeId,
    shopify_order_number: order?.shopify_order_number || `#STR${Math.floor(Date.now() / 1000)}`,
    customer_email: email,
    customer_name: shippingName,
    customer_phone: stripeObj.customer_phone || stripeObj.billing_details?.phone || order?.customer_phone || '',
    line_items: lineItems.length > 0 ? lineItems : order?.line_items || [],
    total_price: (stripeObj.amount_total || stripeObj.amount || 0) / 100,
    subtotal: (stripeObj.amount_total || stripeObj.amount || 0) / 100,
    payment_status: stripeObj.payment_status === 'paid' ? 'paid' : 'pending',
    source_channel: stripeObj.subscription ? 'subscription' : 'online',
    fulfillment_method: 'delivery',
    production_status: order?.production_status || 'new',
    sync_status: 'synced',
    stripe_customer_id: customerId || order?.stripe_customer_id || null,
    stripe_checkout_session_id: objectType === 'checkout.session' ? stripeId : order?.stripe_checkout_session_id || null,
    stripe_payment_intent_id: stripeObj.payment_intent || order?.stripe_payment_intent_id || null,
    stripe_invoice_id: objectType === 'invoice' ? stripeId : order?.stripe_invoice_id || null,
    stripe_subscription_id: stripeObj.subscription || order?.stripe_subscription_id || null,
    last_reconciliation_at: new Date().toISOString(),
    address_line1: shippingDetails.line1 || order?.address_line1 || '',
    address_line2: shippingDetails.line2 || order?.address_line2 || '',
    address_city: shippingDetails.city || order?.address_city || '',
    address_state: shippingDetails.state || order?.address_state || '',
    address_postal_code: shippingDetails.postal_code || order?.address_postal_code || '',
    address_country: shippingDetails.country || order?.address_country || 'US',
    address_last_synced_from: shippingDetails.line1 ? 'stripe_' + objectType : 'stripe',
    address_last_synced_at: new Date().toISOString(),
    repair_status: order ? 'reconciled' : 'restored_from_stripe',
    repair_timestamp: new Date().toISOString(),
    repair_method: 'stripe_' + objectType + '_lookup',
  };

  if (order) {
    await base44.asServiceRole.entities.ShopifyOrder.update(order.id, payload);
    return { repaired: true, action: 'updated', order_id: order.id };
  } else {
    const newOrder = await base44.asServiceRole.entities.ShopifyOrder.create(payload);
    return { repaired: true, action: 'created', order_id: newOrder.id };
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { trigger_type = 'detector' } = await req.json();

    const result = {
      timestamp: new Date().toISOString(),
      trigger_type,
      repaired: [],
      failed: [],
      total_checked: 0,
    };

    // Load all local orders
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500);
    const ordersByCheckoutSessionId = {};
    const ordersByPaymentIntentId = {};
    const ordersByInvoiceId = {};
    const ordersBySubscriptionId = {};

    for (const o of allOrders) {
      if (o.stripe_checkout_session_id) ordersByCheckoutSessionId[o.stripe_checkout_session_id] = o;
      if (o.stripe_payment_intent_id) ordersByPaymentIntentId[o.stripe_payment_intent_id] = o;
      if (o.stripe_invoice_id) ordersByInvoiceId[o.stripe_invoice_id] = o;
      if (o.stripe_subscription_id) ordersBySubscriptionId[o.stripe_subscription_id] = o;
    }

    // Load event log to find unprocessed Stripe objects
    const eventLog = await base44.asServiceRole.entities.StripeEventLog.list('-created_date', 200);

    for (const event of eventLog) {
      if (!event.raw_event || event.status === 'failed') continue;

      result.total_checked++;

      try {
        const stripeId = event.raw_event.id;

        // Check if order already exists for this Stripe object
        const existsLocally = 
          ordersByCheckoutSessionId[stripeId] ||
          ordersByPaymentIntentId[stripeId] ||
          ordersByInvoiceId[stripeId];

        if (existsLocally) continue;

        // Reconcile from Stripe object
        const reconcileResult = await reconcileOrderFromStripeObject(base44, event.raw_event, event.event_type.split('.')[0]);

        if (reconcileResult.repaired) {
          result.repaired.push({
            stripe_object_id: stripeId,
            event_type: event.event_type,
            action: reconcileResult.action,
            order_id: reconcileResult.order_id,
          });
        } else {
          result.failed.push({
            stripe_object_id: stripeId,
            event_type: event.event_type,
            reason: reconcileResult.reason,
          });
        }
      } catch (err) {
        console.error('[RECONCILE] Error processing event', event.id, ':', err.message);
        result.failed.push({
          event_id: event.id,
          reason: err.message,
        });
      }
    }

    return Response.json({ success: true, result });
  } catch (error) {
    console.error('[RECONCILE] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});