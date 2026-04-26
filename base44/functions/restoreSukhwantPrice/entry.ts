import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY'), { apiVersion: '2023-10-16' });

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    // Fetch Sukhwant's order
    const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({ customer_name: 'Sukhwant Kahlon' });
    if (!orders || orders.length === 0) {
      return Response.json({ error: 'Order not found' }, { status: 404 });
    }

    const order = orders[0];
    
    // Fetch from Stripe
    let amount = null;
    let currency = 'usd';

    // Try checkout session first
    if (order.stripe_checkout_session_id) {
      try {
        const session = await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id);
        amount = session.amount_total;
        currency = session.currency;
        console.log(`[RESTORE] Got amount from checkout session: ${amount}`);
      } catch (err) {
        console.log(`[RESTORE] Checkout session lookup failed: ${err.message}`);
      }
    }

    // Try subscription if checkout didn't work
    if (!amount && order.stripe_subscription_id) {
      try {
        const sub = await stripe.subscriptions.retrieve(order.stripe_subscription_id, { expand: ['latest_invoice'] });
        const invoice = sub.latest_invoice;
        if (invoice && invoice.total) {
          amount = invoice.total;
          currency = invoice.currency;
          console.log(`[RESTORE] Got amount from latest invoice: ${amount}`);
        }
      } catch (err) {
        console.log(`[RESTORE] Subscription lookup failed: ${err.message}`);
      }
    }

    if (!amount) {
      return Response.json({ error: 'Could not find price in Stripe', order_id: order.id }, { status: 400 });
    }

    // Convert cents to dollars
    const totalPrice = amount / 100;

    // Update the order directly (bypass safeSyncOrderUpdate for this admin fix)
    await base44.asServiceRole.entities.ShopifyOrder.update(order.id, {
      total_price: totalPrice,
      subtotal: totalPrice,
    });

    return Response.json({
      status: 'success',
      order_id: order.id,
      order_number: order.shopify_order_number,
      restored_price: totalPrice,
      currency: currency,
    });

  } catch (error) {
    console.error('[RESTORE]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});