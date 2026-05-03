import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY'), { apiVersion: '2023-10-16' });

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { payment_intent_id } = await req.json();
    if (!payment_intent_id) {
      return Response.json({ error: 'payment_intent_id required' }, { status: 400 });
    }

    // Fetch the PaymentIntent with latest_charge expanded
    const pi = await stripe.paymentIntents.retrieve(payment_intent_id, {
      expand: ['latest_charge', 'latest_charge.refunds'],
    });

    const charge = pi.latest_charge;
    const refunds = charge?.refunds?.data || [];

    return Response.json({
      payment_intent_id: pi.id,
      pi_status: pi.status,
      pi_amount: pi.amount / 100,
      pi_amount_received: pi.amount_received / 100,
      pi_refunded: pi.amount_received > 0 && (pi.amount - pi.amount_received) > 0 ? 'partial' : undefined,
      charge_id: charge?.id || null,
      charge_status: charge?.status || null,
      charge_amount: charge ? charge.amount / 100 : null,
      charge_amount_refunded: charge ? charge.amount_refunded / 100 : null,
      charge_refunded: charge?.refunded ?? null,
      charge_balance_transaction: charge?.balance_transaction || null,
      refunds: refunds.map(r => ({
        refund_id: r.id,
        amount: r.amount / 100,
        status: r.status,
        reason: r.reason,
        created: new Date(r.created * 1000).toISOString(),
        balance_transaction: r.balance_transaction || null,
        currency: r.currency,
      })),
      total_refunded: charge ? charge.amount_refunded / 100 : 0,
      fully_refunded: charge?.refunded ?? false,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});