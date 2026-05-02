import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY'));

/**
 * debugStripeSession — ONE-TIME diagnostic
 * Fetches a Stripe checkout session in full and returns the raw data so we can 
 * see exactly what shipping/address fields Stripe has.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const { session_id, payment_intent_id } = await req.json();

    if (session_id) {
      const session = await stripe.checkout.sessions.retrieve(session_id, {
        expand: ['customer', 'line_items', 'payment_intent'],
      });

      return Response.json({
        id: session.id,
        status: session.status,
        payment_status: session.payment_status,
        customer_email: session.customer_email,
        customer_details: session.customer_details,
        shipping_details: session.shipping_details,
        billing_details: session.payment_intent?.charges?.data?.[0]?.billing_details,
        shipping_address_collection: session.shipping_address_collection,
        line_items: session.line_items?.data?.map(i => ({
          description: i.description,
          quantity: i.quantity,
          amount_total: i.amount_total / 100,
        })),
        metadata: session.metadata,
        amount_total: session.amount_total / 100,
        created: new Date(session.created * 1000).toISOString(),
        payment_intent_id: session.payment_intent?.id || session.payment_intent,
      });
    }

    if (payment_intent_id) {
      const pi = await stripe.paymentIntents.retrieve(payment_intent_id, {
        expand: ['customer', 'charges'],
      });
      const charge = pi.charges?.data?.[0];
      return Response.json({
        id: pi.id,
        status: pi.status,
        amount: pi.amount / 100,
        customer_email: pi.receipt_email || charge?.billing_details?.email,
        billing_details: charge?.billing_details,
        shipping: charge?.shipping,
        metadata: pi.metadata,
        created: new Date(pi.created * 1000).toISOString(),
      });
    }

    return Response.json({ error: 'session_id or payment_intent_id required' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});