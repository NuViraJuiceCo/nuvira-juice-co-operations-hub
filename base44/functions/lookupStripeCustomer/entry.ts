import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY'));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const { email } = await req.json();

    // Look up customer in Stripe
    const customers = await stripe.customers.list({ email, limit: 5 });

    const results = [];
    for (const customer of customers.data) {
      // Get their payment intents / charges
      const paymentIntents = await stripe.paymentIntents.list({ customer: customer.id, limit: 10 });
      const charges = await stripe.charges.list({ customer: customer.id, limit: 10 });
      const subscriptions = await stripe.subscriptions.list({ customer: customer.id, limit: 5 });

      results.push({
        customer_id: customer.id,
        email: customer.email,
        name: customer.name,
        created: new Date(customer.created * 1000).toISOString(),
        payment_intents: paymentIntents.data.map(pi => ({
          id: pi.id,
          amount: pi.amount / 100,
          status: pi.status,
          created: new Date(pi.created * 1000).toISOString(),
          description: pi.description,
          metadata: pi.metadata,
        })),
        charges: charges.data.map(c => ({
          id: c.id,
          amount: c.amount / 100,
          status: c.status,
          created: new Date(c.created * 1000).toISOString(),
          description: c.description,
        })),
        subscriptions: subscriptions.data.map(s => ({
          id: s.id,
          status: s.status,
          created: new Date(s.created * 1000).toISOString(),
          items: s.items.data.map(i => i.price?.nickname || i.price?.id),
        })),
      });
    }

    return Response.json({ found: customers.data.length, results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});