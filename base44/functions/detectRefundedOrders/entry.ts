import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const STRIPE_API_KEY = Deno.env.get('STRIPE_API_KEY');

/**
 * Detect refunded orders by checking Stripe's refund records.
 * Searches by customer email and returns which orders have partial/full refunds.
 */

async function getRefundsForCustomer(customerEmail) {
  if (!STRIPE_API_KEY) throw new Error('Stripe API key not configured');

  // First, find all charges for this email by searching refunds
  // Stripe refund API doesn't filter by email directly, so we query refunds
  // and match against the metadata
  const refundsUrl = 'https://api.stripe.com/v1/refunds?limit=100';
  const refundsRes = await fetch(refundsUrl, {
    headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` },
  });

  if (!refundsRes.ok) {
    throw new Error(`Stripe refunds API error: ${refundsRes.statusText}`);
  }

  const refundsData = await refundsRes.json();
  const refunds = refundsData.data || [];

  // Filter refunds by charge metadata (which includes customer email from checkout metadata)
  const customerRefunds = [];
  for (const refund of refunds) {
    if (!refund.charge) continue;

    // Fetch the charge to get its metadata
    const chargeRes = await fetch(`https://api.stripe.com/v1/charges/${refund.charge}`, {
      headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` },
    });

    if (!chargeRes.ok) continue;

    const charge = await chargeRes.json();

    // Check if this charge's payment intent metadata matches the customer email
    if (charge.payment_intent) {
      const piRes = await fetch(`https://api.stripe.com/v1/payment_intents/${charge.payment_intent}`, {
        headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` },
      });

      if (piRes.ok) {
        const pi = await piRes.json();
        if (pi.metadata?.customer_email === customerEmail) {
          customerRefunds.push({
            refund_id: refund.id,
            amount: refund.amount,
            charge_id: refund.charge,
            payment_intent: charge.payment_intent,
            order_number: pi.metadata?.order_number,
            created: refund.created,
            reason: refund.reason,
          });
        }
      }
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

    // Now get the orders from our database for this customer
    const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({
      customer_email,
    });

    // Match refunds to orders by order_number or payment_intent
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
          refund_amount: refund.amount / 100, // Convert cents to dollars
          current_payment_status: matchedOrder.payment_status,
          refund_created: new Date(refund.created * 1000).toISOString(),
          refund_reason: refund.reason || 'manual',
        });
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
    console.error('[DETECT-REFUNDS] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});