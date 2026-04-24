import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const STRIPE_API_KEY = Deno.env.get('STRIPE_API_KEY');

/**
 * Debug: Check what address Stripe has for Sukhwant's checkout session
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const checkoutSessionId = 'cs_live_a1RDQsOVJyswZQfJ5GsoCmU3PrSgXbBtHcexOdRBocVYVoDzFayMpNgiXw';

    const sessionRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${checkoutSessionId}`,
      { headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` } }
    );

    const sessionData = await sessionRes.json();

    const result = {
      session_id: checkoutSessionId,
      has_shipping_details: !!sessionData.shipping_details,
      shipping_address: sessionData.shipping_details?.address || null,
      billing_address: sessionData.billing_details?.address || null,
      customer_details: sessionData.customer_details || null,
      payment_status: sessionData.payment_status,
    };

    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});