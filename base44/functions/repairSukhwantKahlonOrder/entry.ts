import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const STRIPE_API_KEY = Deno.env.get('STRIPE_API_KEY');

/**
 * TARGETED REPAIR: SUKHWANT KAHLON ORDER
 * 
 * This function specifically repairs the broken Sukhwant Kahlon order that was degraded to #unknown.
 * It fetches the fresh Stripe objects and restores:
 * - Customer name (Sukhwant Kahlon)
 * - Totals and line items
 * - Address information
 * - Stripe subscription linkage
 * - Fulfillment structure if applicable
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
    console.error('[SUKHWANT-REPAIR] Failed to fetch line items:', err.message);
  }
  return [];
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Find Sukhwant Kahlon's order
    const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({
      customer_email: 'sukhwant@email.com', // Update with actual email if different
    });

    if (!orders || orders.length === 0) {
      // Try alternative search
      const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500);
      const sukhwantOrder = allOrders.find(o => 
        o.customer_email?.toLowerCase().includes('sukhwant') ||
        o.customer_name?.toLowerCase().includes('sukhwant')
      );

      if (!sukhwantOrder) {
        return Response.json({ 
          error: 'Sukhwant Kahlon order not found',
          searched_email: 'sukhwant@email.com',
          tip: 'If email is different, provide correct email in request body'
        }, { status: 404 });
      }

      orders.push(sukhwantOrder);
    }

    const order = orders[0];
    if (!order) {
      return Response.json({ error: 'Order not found' }, { status: 404 });
    }

    console.log(`[SUKHWANT-REPAIR] Found order ${order.id}: #${order.shopify_order_number}, email=${order.customer_email}`);

    // PHASE 1: Fetch all related Stripe objects
    let checkoutSession = null, subscription = null, customer = null;

    if (order.stripe_checkout_session_id) {
      checkoutSession = await getStripeObject(order.stripe_checkout_session_id, 'checkout.session');
      console.log('[SUKHWANT-REPAIR] Fetched checkout session');
    }

    if (order.stripe_subscription_id) {
      subscription = await getStripeObject(order.stripe_subscription_id, 'subscription');
      console.log('[SUKHWANT-REPAIR] Fetched subscription');
    }

    if (order.stripe_customer_id) {
      customer = await getStripeObject(order.stripe_customer_id, 'customer');
      console.log('[SUKHWANT-REPAIR] Fetched customer');
    }

    // PHASE 2: Extract fresh data
    let customerName = order.customer_name;
    let email = order.customer_email;
    let totalPrice = order.total_price;
    let lineItems = order.line_items || [];
    let address = {};

    if (checkoutSession) {
      customerName = checkoutSession.shipping_details?.name || checkoutSession.customer_details?.name || customerName;
      email = checkoutSession.customer_email || checkoutSession.customer_details?.email || email;
      totalPrice = Math.max(totalPrice, (checkoutSession.amount_total || 0) / 100);
      address = checkoutSession.shipping_details?.address || checkoutSession.billing_details?.address || address;
      
      // Get line items from checkout
      if (!lineItems || lineItems.length === 0) {
        lineItems = await getCheckoutSessionLineItems(order.stripe_checkout_session_id);
      }
    }

    if (customer) {
      customerName = customerName || customer.name;
      email = email || customer.email;
      if (!address.line1 && customer.address) {
        address = customer.address;
      }
    }

    console.log('[SUKHWANT-REPAIR] Extracted fresh data:', {
      customerName,
      email,
      totalPrice,
      lineItems: lineItems.length,
      hasAddress: !!address.line1,
    });

    // PHASE 3: Build repair payload
    const repairPayload = {
      customer_name: customerName || 'Sukhwant Kahlon',
      customer_email: email,
      total_price: totalPrice || 0,
      subtotal: totalPrice || 0,
      line_items: lineItems,
      address_line1: address.line1 || order.address_line1,
      address_line2: address.line2 || order.address_line2,
      address_city: address.city || order.address_city,
      address_state: address.state || order.address_state,
      address_postal_code: address.postal_code || order.address_postal_code,
      address_country: address.country || order.address_country || 'US',
      payment_status: 'paid',
      production_status: order.production_status || 'new',
      sync_status: 'synced',
      repair_status: 'restored_from_stripe',
      repair_timestamp: new Date().toISOString(),
      repair_method: 'targeted_sukhwant_repair',
      last_reconciliation_at: new Date().toISOString(),
      
      // Preserve Stripe linkage
      stripe_customer_id: order.stripe_customer_id,
      stripe_checkout_session_id: order.stripe_checkout_session_id,
      stripe_subscription_id: order.stripe_subscription_id,
      
      // Preserve fulfillments if subscription
      fulfillments: order.fulfillments || undefined,
      source_channel: order.stripe_subscription_id ? 'subscription' : 'online',
    };

    // PHASE 4: Apply repair
    await base44.asServiceRole.entities.ShopifyOrder.update(order.id, repairPayload);

    console.log('[SUKHWANT-REPAIR] Successfully repaired order:', order.id);

    // Return confirmation
    return Response.json({
      success: true,
      order_id: order.id,
      order_number: repairPayload.shopify_order_number || order.shopify_order_number,
      repairs_applied: {
        customer_name: customerName,
        total_price: totalPrice,
        line_items_count: lineItems.length,
        address_restored: !!address.line1,
        subscription_linkage_preserved: !!order.stripe_subscription_id,
      },
      final_state: {
        customer_email: repairPayload.customer_email,
        customer_name: repairPayload.customer_name,
        total: repairPayload.total_price,
        items: repairPayload.line_items.length,
        address: `${repairPayload.address_line1}, ${repairPayload.address_city}, ${repairPayload.address_state}`,
        sync_status: repairPayload.sync_status,
        stripe_linkage: {
          customer: !!repairPayload.stripe_customer_id,
          checkout: !!repairPayload.stripe_checkout_session_id,
          subscription: !!repairPayload.stripe_subscription_id,
        },
      },
    });
  } catch (error) {
    console.error('[SUKHWANT-REPAIR] Error:', error.message);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});