import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY'));
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const signature = req.headers.get('stripe-signature');
    const body = await req.text();

    // Validate Stripe signature
    const event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);

    if (event.type !== 'checkout.session.completed') {
      return Response.json({ success: true, skipped: true });
    }

    const session = event.data.object;
    const base44 = createClientFromRequest(req);

    // Get line items for this session
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
    const items = lineItems.data || [];

    // Map Stripe items to line_items format
    const lineItemsFormatted = items.map(item => ({
      title: item.description || item.name || 'Unknown',
      quantity: item.quantity || 0,
      price: (item.price?.unit_amount || 0) / 100, // Convert cents to dollars
    }));

    // Create ShopifyOrder record
    const order = await base44.asServiceRole.entities.ShopifyOrder.create({
      shopify_order_id: session.id,
      shopify_order_number: `#STRIPE-${session.id.slice(-8).toUpperCase()}`,
      customer_email: session.customer_details?.email || 'unknown@stripe.local',
      customer_phone: session.customer_details?.phone || '',
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

    return Response.json({
      success: true,
      order_id: order.id,
      customer: session.customer_details?.email,
      total: (session.amount_total || 0) / 100,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});