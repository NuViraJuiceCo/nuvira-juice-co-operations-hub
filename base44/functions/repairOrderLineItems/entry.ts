import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const STRIPE_API_KEY = Deno.env.get('STRIPE_API_KEY');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    let body = {};
    try { body = await req.json(); } catch {}
    const { order_id } = body;

    if (!order_id) {
      return Response.json({ error: 'order_id required' }, { status: 400 });
    }

    const order = await base44.asServiceRole.entities.ShopifyOrder.list();
    const targetOrder = order.find(o => o.id === order_id || o.shopify_order_number === order_id);

    if (!targetOrder) {
      return Response.json({ error: 'Order not found' }, { status: 404 });
    }

    const checkoutSessionId = targetOrder.stripe_checkout_session_id;
    if (!checkoutSessionId) {
      return Response.json({ error: 'No checkout session ID on order' }, { status: 400 });
    }

    // Fetch line items from Stripe
    let lineItems = [];
    try {
      const itemsRes = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${checkoutSessionId}/line_items?limit=100`,
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
      console.error('Error fetching line items:', err.message);
    }

    // Fetch session to get total
    let totalPrice = 0;
    try {
      const sessionRes = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${checkoutSessionId}`,
        { headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` } }
      );
      if (sessionRes.ok) {
        const session = await sessionRes.json();
        totalPrice = (session.amount_total || 0) / 100;
      }
    } catch (err) {
      console.error('Error fetching session:', err.message);
    }

    // Update order
    await base44.asServiceRole.entities.ShopifyOrder.update(targetOrder.id, {
      line_items: lineItems,
      total_price: totalPrice,
      subtotal: totalPrice,
    });

    return Response.json({
      success: true,
      order_id: targetOrder.id,
      line_items_count: lineItems.length,
      total_price: totalPrice,
    });
  } catch (error) {
    console.error('[REPAIR_LINE_ITEMS]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});