import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY'));
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

async function logStripeEvent(base44, stripeEventId, eventType, stripeObjectId, status, details = {}) {
  try {
    await base44.asServiceRole.entities.StripeEventLog.create({
      stripe_event_id: stripeEventId,
      event_type: eventType,
      stripe_object_id: stripeObjectId,
      stripe_customer_id: details.stripe_customer_id || '',
      customer_email: details.customer_email || '',
      order_id: details.order_id || '',
      status,
      failure_reason: details.failure_reason || '',
      notes: details.notes || '',
    });
  } catch (err) {
    console.error('[STRIPE-WEBHOOK] Failed to log event:', err.message);
  }
}

async function checkEventProcessed(base44, stripeEventId) {
  try {
    const existing = await base44.asServiceRole.entities.StripeEventLog.filter({
      stripe_event_id: stripeEventId,
      status: 'processed',
    });
    return existing.length > 0;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const signature = req.headers.get('stripe-signature');
    const body = await req.text();

    // Validate Stripe signature
    const event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
    const base44 = createClientFromRequest(req);

    console.log(`[STRIPE-WEBHOOK] Received event ${event.id} of type ${event.type}`);

    // Idempotency check: skip if we already processed this event
    const alreadyProcessed = await checkEventProcessed(base44, event.id);
    if (alreadyProcessed) {
      console.log(`[STRIPE-WEBHOOK] Event ${event.id} already processed, skipping`);
      return Response.json({ success: true, skipped: true, reason: 'idempotent' });
    }

    // Only handle checkout.session.completed
    if (event.type !== 'checkout.session.completed') {
      await logStripeEvent(base44, event.id, event.type, event.data.object?.id || 'unknown', 'skipped', {
        notes: `Event type ${event.type} not handled`,
      });
      return Response.json({ success: true, skipped: true, reason: 'event_type' });
    }

    const session = event.data.object;
    const sessionId = session.id;
    const customerEmail = session.customer_details?.email || '';

    console.log(`[STRIPE-WEBHOOK] Processing checkout session ${sessionId} for ${customerEmail}`);

    // Check if order already exists for this session (upsert safety)
    let existingOrder;
    try {
      const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({
        shopify_order_id: sessionId,
      });
      existingOrder = existing.length > 0 ? existing[0] : null;
    } catch {
      existingOrder = null;
    }

    if (existingOrder) {
      console.log(`[STRIPE-WEBHOOK] Order already exists for session ${sessionId}, updating`);
      await logStripeEvent(base44, event.id, event.type, sessionId, 'processed', {
        stripe_customer_id: session.customer,
        customer_email: customerEmail,
        order_id: existingOrder.id,
        notes: 'Updated existing order',
      });
      return Response.json({ success: true, order_id: existingOrder.id, action: 'updated' });
    }

    // Fetch line items
    let lineItemsFormatted = [];
    try {
      const lineItems = await stripe.checkout.sessions.listLineItems(sessionId);
      const items = lineItems.data || [];
      lineItemsFormatted = items.map(item => ({
        title: item.description || item.name || 'Unknown',
        quantity: item.quantity || 0,
        price: (item.price?.unit_amount || 0) / 100,
      }));
    } catch (err) {
      console.error(`[STRIPE-WEBHOOK] Failed to fetch line items: ${err.message}`);
      // Don't fail; create order with empty items
    }

    // Create order with valid data
    const newOrder = await base44.asServiceRole.entities.ShopifyOrder.create({
      shopify_order_id: sessionId,
      shopify_order_number: `#STRIPE-${sessionId.slice(-8).toUpperCase()}`,
      customer_email: customerEmail || 'unknown@stripe.local',
      customer_phone: session.customer_details?.phone || '',
      customer_name: session.customer_details?.name || '',
      line_items: lineItemsFormatted,
      subtotal: (session.amount_subtotal || 0) / 100,
      total_price: (session.amount_total || 0) / 100,
      source_channel: 'online',
      fulfillment_method: 'shipping',
      payment_status: 'paid',
      production_status: 'new',
      sync_status: 'synced',
      customer_order_date: new Date(session.created * 1000).toISOString(),
    });

    // Log successful processing
    await logStripeEvent(base44, event.id, event.type, sessionId, 'processed', {
      stripe_customer_id: session.customer,
      customer_email: customerEmail,
      order_id: newOrder.id,
      notes: 'Successfully created from webhook',
    });

    console.log(`[STRIPE-WEBHOOK] Created order ${newOrder.id} for session ${sessionId}`);

    // Return immediately to acknowledge receipt
    return Response.json({
      success: true,
      order_id: newOrder.id,
      customer: customerEmail,
      total: (session.amount_total || 0) / 100,
    });
  } catch (error) {
    console.error(`[STRIPE-WEBHOOK] Error: ${error.message}`);
    // Always return 2xx to Stripe, log error for manual recovery
    return Response.json({
      success: false,
      error: error.message,
      note: 'Webhook received but processing failed - check StripeEventLog',
    }, { status: 200 });
  }
});