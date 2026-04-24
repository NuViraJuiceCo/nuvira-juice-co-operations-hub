import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

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
      created_order_id: null,
      error: null,
    };

    const checkoutSessionId = 'cs_live_a1RDQsOVJyswZQfJ5GsoCmU3PrSgXbBtHcexOdRBocVYVoDzFayMpNgiXw';

    if (!STRIPE_API_KEY) {
      result.error = 'Stripe API key not configured';
      return Response.json(result);
    }

    // Fetch checkout session
    const sessionRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${checkoutSessionId}`,
      { headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` } }
    );

    if (!sessionRes.ok) {
      result.error = `Stripe checkout session error: ${sessionRes.status}`;
      return Response.json(result);
    }

    const sessionData = await sessionRes.json();

    // Fetch line items
    let lineItems = [];
    const itemsRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${checkoutSessionId}/line_items?limit=100`,
      { headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` } }
    );

    if (itemsRes.ok) {
      const itemsData = await itemsRes.json();
      lineItems = (itemsData.data || []).map(item => ({
        title: item.description || item.name || 'Item',
        quantity: item.quantity || 1,
        price: item.amount_total ? (item.amount_total / 100) : 0,
      }));
    }

    // Extract address from Stripe shipping_details
    const shippingDetails = sessionData.shipping_details?.address || sessionData.billing_details?.address || {};
    
    // Create new order
    const orderPayload = {
      shopify_order_id: checkoutSessionId,
      shopify_order_number: `#STR${Math.floor(Date.now() / 1000)}`,
      customer_email: sessionData.customer_email || 'ksukhi2000@yahoo.com',
      customer_name: sessionData.customer_details?.name || 'Sukhwant Kahlon',
      customer_phone: sessionData.customer_details?.phone || '',
      line_items: lineItems,
      total_price: sessionData.amount_total ? (sessionData.amount_total / 100) : 0,
      subtotal: sessionData.amount_total ? (sessionData.amount_total / 100) : 0,
      payment_status: sessionData.payment_status === 'paid' ? 'paid' : 'pending',
      source_channel: 'online',
      fulfillment_method: 'delivery',
      production_status: 'new',
      sync_status: 'synced',
      last_sync_at: new Date().toISOString(),
      customer_order_date: sessionData.created ? new Date(sessionData.created * 1000).toISOString() : new Date().toISOString(),
      // Address fields
      address_line1: shippingDetails.line1 || '',
      address_line2: shippingDetails.line2 || '',
      address_city: shippingDetails.city || '',
      address_state: shippingDetails.state || '',
      address_postal_code: shippingDetails.postal_code || '',
      address_country: shippingDetails.country || 'US',
      address_last_synced_from: shippingDetails.line1 ? 'stripe_checkout' : 'manual',
      address_last_synced_at: new Date().toISOString(),
      stripe_customer_id: sessionData.customer || null,
      stripe_checkout_session_id: checkoutSessionId,
      stripe_payment_intent_id: sessionData.payment_intent || null,
      stripe_event_id_applied: 'recovery_' + checkoutSessionId,
    };

    const createdOrder = await base44.asServiceRole.entities.ShopifyOrder.create(orderPayload);
    result.created_order_id = createdOrder.id;
    result.order_data = {
      customer_name: orderPayload.customer_name,
      customer_email: orderPayload.customer_email,
      total_price: orderPayload.total_price,
      line_items: lineItems.length,
      payment_status: orderPayload.payment_status,
    };

    console.log('[CREATE-SUKHWANT] Order created from Stripe:', createdOrder.id);
    return Response.json({ success: true, result });
  } catch (error) {
    console.error('[CREATE-SUKHWANT] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});