import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const STRIPE_API_KEY = Deno.env.get('STRIPE_API_KEY');

/**
 * Enhanced refund detection that searches by checkout session and payment intent.
 */

async function getRefundsForCustomer(customerEmail) {
  if (!STRIPE_API_KEY) throw new Error('Stripe API key not configured');

  // Strategy: Get all refunds and check payment intent metadata
  const refundsUrl = 'https://api.stripe.com/v1/refunds?limit=100';
  const refundsRes = await fetch(refundsUrl, {
    headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` },
  });

  if (!refundsRes.ok) {
    throw new Error(`Stripe refunds API error: ${refundsRes.statusText}`);
  }

  const refundsData = await refundsRes.json();
  const refunds = refundsData.data || [];

  const customerRefunds = [];

  for (const refund of refunds) {
    // Refunds can have a charge OR a payment_intent directly
    let paymentIntentId = null;

    if (refund.payment_intent) {
      // Direct payment_intent refund
      paymentIntentId = refund.payment_intent;
    } else if (refund.charge) {
      // Charge refund - need to look up the charge to find the payment_intent
      try {
        const chargeRes = await fetch(`https://api.stripe.com/v1/charges/${refund.charge}`, {
          headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` },
        });
        if (chargeRes.ok) {
          const charge = await chargeRes.json();
          paymentIntentId = charge.payment_intent;
        }
      } catch (err) {
        console.warn(`Failed to fetch charge ${refund.charge}:`, err.message);
        continue;
      }
    }

    if (!paymentIntentId) continue;

    // Fetch the payment intent to get its metadata
    try {
      const piRes = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}`, {
        headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` },
      });

      if (piRes.ok) {
        const pi = await piRes.json();
        if (pi.metadata?.customer_email === customerEmail) {
          customerRefunds.push({
            refund_id: refund.id,
            amount: refund.amount,
            payment_intent: paymentIntentId,
            order_number: pi.metadata?.order_number,
            created: refund.created,
            reason: refund.reason,
          });
        }
      }
    } catch (err) {
      console.warn(`Failed to fetch payment intent ${paymentIntentId}:`, err.message);
    }
  }

  return customerRefunds;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { customer_email } = await req.json();

    if (!customer_email) {
      return Response.json({ error: 'customer_email required' }, { status: 400 });
    }

    // Get refunds for this customer from Stripe
    const refunds = await getRefundsForCustomer(customer_email);

    if (refunds.length === 0) {
      return Response.json({
        status: 'success',
        customer_email,
        refunds: [],
        message: 'No refunds found for this customer',
      });
    }

    // Get the orders from our database for this customer
    const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({
      customer_email,
    });

    // Match refunds to orders
    const ordersWithRefunds = [];
    for (const refund of refunds) {
      const matchedOrder = orders.find(
        o => o.shopify_order_number === refund.order_number ||
             o.stripe_payment_intent_id === refund.payment_intent
      );

      if (matchedOrder) {
        ordersWithRefunds.push({
          order_id: matchedOrder.id,
          order_number: matchedOrder.shopify_order_number,
          refund_id: refund.refund_id,
          refund_amount: refund.amount / 100,
          current_payment_status: matchedOrder.payment_status,
          refund_created: new Date(refund.created * 1000).toISOString(),
          refund_reason: refund.reason || 'manual',
        });
      } else {
        console.warn(`[DETECT-REFUNDS] No matched order for refund on PI ${refund.payment_intent}, order_number ${refund.order_number}`);
      }
    }

    return Response.json({
      status: 'success',
      customer_email,
      total_refunds_found: refunds.length,
      refunds_matched_to_orders: ordersWithRefunds.length,
      refunds: ordersWithRefunds,
    });

  } catch (error) {
    console.error('[DETECT-REFUNDS-IMPROVED] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});