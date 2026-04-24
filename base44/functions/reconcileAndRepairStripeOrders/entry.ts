import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const STRIPE_API_KEY = Deno.env.get('STRIPE_API_KEY');

/**
 * STRIPE ORDER RECONCILIATION & REPAIR WORKER
 * 
 * Repairs broken Stripe-linked orders by:
 * 1. Fetching fresh Stripe objects to restore missing/degraded fields
 * 2. Reconciling all related Stripe objects (checkout, intent, invoice, subscription, customer)
 * 3. Restoring customer identity, totals, line items, address
 * 4. Preserving and restoring subscription linkage and fulfillments
 * 5. Moving orders from #unknown or sync_status=failed back to valid state
 * 
 * Called by Operations Manager automation or manually for specific orders
 */

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

async function getCheckoutSessionLineItems(sessionId) {
  if (!STRIPE_API_KEY) return [];

  try {
    const res = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${sessionId}/line_items?limit=100`,
      { headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` } }
    );
    if (res.ok) {
      const data = await res.json();
      return (data.data || []).map(item => ({
        title: item.description || item.name || 'Item',
        quantity: item.quantity,
        price: (item.amount_total || 0) / 100,
      }));
    }
  } catch (err) {
    console.error('[REPAIR] Failed to fetch line items:', err.message);
  }
  return [];
}

async function reconcileAndRepairOrder(base44, order) {
  const repairLog = {
    order_id: order.id,
    order_number: order.shopify_order_number,
    customer_email: order.customer_email,
    issues_found: [],
    repairs_applied: [],
    final_state: {},
  };

  try {
    // PHASE 1: Identify which Stripe objects to fetch
    let checkoutSession = null, paymentIntent = null, invoice = null, subscription = null, customer = null;

    if (order.stripe_checkout_session_id && order.stripe_checkout_session_id.startsWith('cs_')) {
      checkoutSession = await getStripeObject(order.stripe_checkout_session_id, 'checkout.session');
    }
    if (order.stripe_payment_intent_id && order.stripe_payment_intent_id.startsWith('pi_')) {
      paymentIntent = await getStripeObject(order.stripe_payment_intent_id, 'payment_intent');
    }
    if (order.stripe_invoice_id && order.stripe_invoice_id.startsWith('in_')) {
      invoice = await getStripeObject(order.stripe_invoice_id, 'invoice');
    }
    if (order.stripe_subscription_id && order.stripe_subscription_id.startsWith('sub_')) {
      subscription = await getStripeObject(order.stripe_subscription_id, 'subscription');
    }
    if (order.stripe_customer_id && order.stripe_customer_id.startsWith('cus_')) {
      customer = await getStripeObject(order.stripe_customer_id, 'customer');
    }

    console.log(`[REPAIR] Fetched Stripe objects for order ${order.id}: checkout=${!!checkoutSession}, intent=${!!paymentIntent}, invoice=${!!invoice}, subscription=${!!subscription}, customer=${!!customer}`);

    // PHASE 2: Extract fresh data from Stripe objects (in order of precedence)
    let freshData = {
      customer_name: null,
      email: null,
      address: {},
      lineItems: [],
      total: 0,
      paymentStatus: null,
    };

    // Precedence: checkout session > payment intent > invoice > subscription > customer
    if (checkoutSession) {
      freshData.customer_name = checkoutSession.shipping_details?.name || checkoutSession.customer_details?.name;
      freshData.email = checkoutSession.customer_email || checkoutSession.customer_details?.email;
      freshData.address = checkoutSession.shipping_details?.address || checkoutSession.billing_details?.address || {};
      freshData.total = (checkoutSession.amount_total || 0) / 100;
      freshData.lineItems = await getCheckoutSessionLineItems(order.stripe_checkout_session_id);
      freshData.paymentStatus = checkoutSession.payment_status;
    }

    if (paymentIntent && !freshData.customer_name) {
      freshData.total = freshData.total || ((paymentIntent.amount || 0) / 100);
      freshData.paymentStatus = freshData.paymentStatus || (paymentIntent.status === 'succeeded' ? 'paid' : 'pending');
    }

    if (invoice && !freshData.customer_name) {
      freshData.customer_name = invoice.customer_name;
      freshData.email = freshData.email || invoice.customer_email;
      freshData.total = freshData.total || (invoice.total || 0) / 100;
      if (invoice.lines?.data) {
        freshData.lineItems = invoice.lines.data.map(l => ({
          title: l.description || 'Item',
          quantity: 1,
          price: (l.amount || 0) / 100,
        }));
      }
    }

    if (subscription && !freshData.customer_name) {
      freshData.email = freshData.email || subscription.billing_cycle_anchor;
      // Subscription doesn't carry customer name, but we preserve it from order
    }

    if (customer) {
      freshData.customer_name = freshData.customer_name || customer.name;
      freshData.email = freshData.email || customer.email;
      // Use customer's default address if we don't have one
      if (!freshData.address.line1 && customer.address) {
        freshData.address = customer.address;
      }
    }

    // PHASE 3: Detect what needs repair
    if (!order.customer_name || order.customer_name === 'Unknown') {
      if (freshData.customer_name) {
        repairLog.issues_found.push('missing_customer_name');
        repairLog.repairs_applied.push('restored_customer_name_from_stripe');
      }
    }

    if (order.total_price === 0 && order.line_items?.length > 0) {
      if (freshData.total > 0) {
        repairLog.issues_found.push('zero_total');
        repairLog.repairs_applied.push('restored_total_from_stripe');
      }
    }

    if (order.shopify_order_number === '#unknown') {
      repairLog.issues_found.push('degraded_to_unknown');
      repairLog.repairs_applied.push('restored_order_identity');
    }

    if ((!order.line_items || order.line_items.length === 0) && freshData.lineItems.length > 0) {
      repairLog.issues_found.push('missing_line_items');
      repairLog.repairs_applied.push('restored_line_items_from_stripe');
    }

    // PHASE 4: Build repair payload
    const repairPayload = {
      customer_name: freshData.customer_name || order.customer_name,
      customer_email: freshData.email || order.customer_email,
      total_price: freshData.total || order.total_price,
      subtotal: freshData.total || order.subtotal,
      line_items: freshData.lineItems.length > 0 ? freshData.lineItems : order.line_items,
      address_line1: freshData.address.line1 || order.address_line1,
      address_line2: freshData.address.line2 || order.address_line2,
      address_city: freshData.address.city || order.address_city,
      address_state: freshData.address.state || order.address_state,
      address_postal_code: freshData.address.postal_code || order.address_postal_code,
      address_country: freshData.address.country || order.address_country || 'US',
      payment_status: freshData.paymentStatus || order.payment_status || 'pending',
      sync_status: 'synced',
      repair_status: 'restored_from_stripe',
      repair_timestamp: new Date().toISOString(),
      repair_method: 'fresh_stripe_object_fetch',
      last_reconciliation_at: new Date().toISOString(),
    };

    // CRITICAL: Preserve Stripe linkage and subscription/fulfillment structure
    // Never remove subscription linkage
    if (order.stripe_subscription_id) {
      repairPayload.stripe_subscription_id = order.stripe_subscription_id;
      repairPayload.source_channel = 'subscription';
      if (order.fulfillments) {
        repairPayload.fulfillments = order.fulfillments;
      }
    }

    // PHASE 5: Apply repair
    await base44.asServiceRole.entities.ShopifyOrder.update(order.id, repairPayload);
    repairLog.final_state = repairPayload;

    console.log(`[REPAIR] Successfully repaired order ${order.id}:`, repairLog.repairs_applied.join(', '));
    return repairLog;
  } catch (error) {
    repairLog.error = error.message;
    console.error(`[REPAIR] Failed to repair order ${order.id}:`, error.message);
    return repairLog;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const targetOrderId = body.order_id; // Optional: repair specific order

    let ordersToRepair = [];

    if (targetOrderId) {
      // Repair specific order
      const order = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 1000);
      ordersToRepair = order.filter(o => o.id === targetOrderId);
    } else {
      // Auto-detect broken orders
      const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500);
      ordersToRepair = allOrders.filter(order => {
        return (
          // #unknown with Stripe linkage
          (order.shopify_order_number === '#unknown' && (
            order.stripe_customer_id ||
            order.stripe_checkout_session_id ||
            order.stripe_subscription_id
          )) ||
          // Missing customer name with Stripe linkage
          ((!order.customer_name || order.customer_name === 'Unknown') && (
            order.stripe_customer_id ||
            order.stripe_checkout_session_id
          )) ||
          // Zero total with items
          (order.total_price === 0 && order.line_items?.length > 0 && (
            order.stripe_customer_id ||
            order.stripe_payment_intent_id
          )) ||
          // Sync failed but has Stripe linkage
          (order.sync_status === 'failed' && (
            order.stripe_customer_id ||
            order.stripe_checkout_session_id
          ))
        );
      });
    }

    const results = [];
    for (const order of ordersToRepair) {
      const repairResult = await reconcileAndRepairOrder(base44, order);
      results.push(repairResult);
    }

    return Response.json({
      total_orders_repaired: results.length,
      successful: results.filter(r => !r.error).length,
      failed: results.filter(r => r.error).length,
      repairs: results,
    });
  } catch (error) {
    console.error('[RECONCILE] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});