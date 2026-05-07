import Stripe from 'npm:stripe@14.21.0';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * DAMAGE CHECK: Verify if a Stripe charge was actually refunded or only marked refunded in Hub
 */

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY'), { apiVersion: '2023-10-16' });

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const { stripe_payment_intent_id, stripe_charge_id } = await req.json();

    if (!stripe_payment_intent_id && !stripe_charge_id) {
      return Response.json({ error: 'Provide stripe_payment_intent_id or stripe_charge_id' }, { status: 400 });
    }

    let chargeId = stripe_charge_id;

    // If only payment_intent_id provided, fetch the charge
    if (!chargeId && stripe_payment_intent_id) {
      console.log(`[VERIFY] Looking up charge for payment_intent ${stripe_payment_intent_id}`);
      const intent = await stripe.paymentIntents.retrieve(stripe_payment_intent_id);
      chargeId = intent.charges?.data?.[0]?.id;
      
      if (!chargeId) {
        return Response.json({
          status: 'no_charge_found',
          payment_intent_id: stripe_payment_intent_id,
          intent_status: intent.status,
          charges_count: intent.charges?.data?.length || 0,
        });
      }
    }

    // Fetch the charge with refunds
    const charge = await stripe.charges.retrieve(chargeId, { expand: ['refunds'] });

    console.log(`[VERIFY] Charge ${chargeId}:`, {
      status: charge.status,
      amount: charge.amount / 100,
      refunded: charge.refunded,
      refunds_count: charge.refunds?.data?.length || 0,
      paid: charge.paid,
    });

    return Response.json({
      status: 'charge_verified',
      charge_id: chargeId,
      stripe_payment_intent_id: stripe_payment_intent_id,
      charge_amount: charge.amount / 100,
      charge_status: charge.status,
      charge_paid: charge.paid,
      charge_refunded: charge.refunded,
      refund_count: charge.refunds?.data?.length || 0,
      refunds: (charge.refunds?.data || []).map(r => ({
        id: r.id,
        amount: r.amount / 100,
        status: r.status,
        created: r.created,
        reason: r.reason,
      })),
      is_actually_refunded_in_stripe: charge.refunded === true,
    });

  } catch (error) {
    console.error('[VERIFY] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});