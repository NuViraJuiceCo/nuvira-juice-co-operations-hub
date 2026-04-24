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
      found_events: [],
      created_order: null,
      error: null,
    };

    // Search for any Stripe events with Sukhwant's email
    const events = await base44.asServiceRole.entities.StripeEventLog.filter({
      customer_email: 'ksukhi2000@yahoo.com',
    });

    if (!events || events.length === 0) {
      result.error = 'No Stripe events found for ksukhi2000@yahoo.com';
      return Response.json(result);
    }

    result.found_events = events.map(e => ({
      id: e.id,
      event_type: e.event_type,
      status: e.status,
      created_date: e.created_date,
    }));

    // Find the most recent checkout.session.completed or payment_intent.succeeded event
    const validEvent = events
      .filter(e => e.status === 'processed' && e.raw_event)
      .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))[0];

    if (!validEvent) {
      result.error = 'No processed events with raw_event data found';
      return Response.json(result);
    }

    // Reconstruct and create the order from raw event
    const rawData = validEvent.raw_event;
    const lineItems = rawData.line_items || [];

    const orderPayload = {
      shopify_order_id: rawData.id,
      shopify_order_number: `#STR${Math.floor(Date.now() / 1000)}`,
      customer_email: rawData.customer_email || 'ksukhi2000@yahoo.com',
      customer_name: rawData.customer_name || rawData.billing_details?.name || 'Sukhwant Kahlon',
      customer_phone: rawData.customer_phone || rawData.billing_details?.phone || '',
      line_items: Array.isArray(lineItems) ? lineItems.map(item => ({
        title: item.description || item.name || 'Item',
        quantity: item.quantity || 1,
        price: item.amount_total ? (item.amount_total / 100) : (item.price_data?.unit_amount ? item.price_data.unit_amount / 100 : 0),
      })) : [],
      total_price: rawData.amount_total ? (rawData.amount_total / 100) : 0,
      subtotal: rawData.amount_total ? (rawData.amount_total / 100) : 0,
      payment_status: rawData.payment_status === 'paid' ? 'paid' : 'pending',
      source_channel: 'online',
      fulfillment_method: 'delivery',
      production_status: 'new',
      sync_status: 'synced',
      last_sync_at: new Date().toISOString(),
      customer_order_date: rawData.created ? new Date(rawData.created * 1000).toISOString() : new Date().toISOString(),
      stripe_customer_id: rawData.customer || null,
      stripe_checkout_session_id: validEvent.event_type.includes('checkout') ? rawData.id : null,
      stripe_payment_intent_id: rawData.payment_intent || null,
      stripe_event_id_applied: validEvent.stripe_event_id,
    };

    // Check if order already exists
    const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({
      customer_email: 'ksukhi2000@yahoo.com',
    });

    let createdOrder;
    if (existing && existing.length > 0) {
      // Update existing
      createdOrder = await base44.asServiceRole.entities.ShopifyOrder.update(existing[0].id, orderPayload);
      result.created_order = { id: existing[0].id, action: 'updated', ...orderPayload };
    } else {
      // Create new
      createdOrder = await base44.asServiceRole.entities.ShopifyOrder.create(orderPayload);
      result.created_order = { id: createdOrder.id, action: 'created', ...orderPayload };
    }

    console.log('[RECOVER-SUKHWANT] Order recovered/created:', createdOrder.id);
    return Response.json({ success: true, result });
  } catch (error) {
    console.error('[RECOVER-SUKHWANT] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});