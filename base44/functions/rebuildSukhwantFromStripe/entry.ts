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
      order_id: '69ead44f1d34ea892f3b4641',
      updated: false,
      error: null,
    };

    // Get the order from database
    const order = await base44.asServiceRole.entities.ShopifyOrder.filter({
      id: '69ead44f1d34ea892f3b4641',
    });

    if (!order || order.length === 0) {
      result.error = 'Order not found in database';
      return Response.json(result);
    }

    const currentOrder = order[0];
    const checkoutSessionId = 'cs_live_a1RDQsOVJyswZQfJ5GsoCmU3PrSgXbBtHcexOdRBocVYVoDzFayMpNgiXw';

    // Fetch from Stripe
    if (!STRIPE_API_KEY) {
      result.error = 'Stripe API key not configured';
      return Response.json(result);
    }

    const sessionRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${checkoutSessionId}`,
      { headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` } }
    );

    if (!sessionRes.ok) {
      result.error = `Stripe API error: ${sessionRes.status}`;
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

    // Update order with correct data
    const updateData = {
      customer_email: sessionData.customer_email || 'ksukhi2000@yahoo.com',
      customer_name: sessionData.customer_details?.name || 'Sukhwant Kahlon',
      customer_phone: sessionData.customer_details?.phone || '',
      line_items: lineItems.length > 0 ? lineItems : currentOrder.line_items,
      total_price: sessionData.amount_total ? (sessionData.amount_total / 100) : currentOrder.total_price,
      subtotal: sessionData.amount_total ? (sessionData.amount_total / 100) : currentOrder.subtotal,
      payment_status: sessionData.payment_status === 'paid' ? 'paid' : 'pending',
      stripe_checkout_session_id: checkoutSessionId,
      stripe_customer_id: sessionData.customer || null,
      stripe_payment_intent_id: sessionData.payment_intent || null,
      sync_status: 'synced',
      last_sync_at: new Date().toISOString(),
    };

    await base44.asServiceRole.entities.ShopifyOrder.update(currentOrder.id, updateData);
    result.updated = true;
    result.order_data = updateData;

    console.log('[REBUILD-SUKHWANT] Order updated with Stripe data:', currentOrder.id);
    return Response.json({ success: true, result });
  } catch (error) {
    console.error('[REBUILD-SUKHWANT] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});