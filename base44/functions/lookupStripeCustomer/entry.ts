import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY'));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const { email, name } = await req.json();

    // 1) Try exact email match
    const byEmail = email ? await stripe.customers.list({ email: email.trim(), limit: 10 }) : { data: [] };

    // 2) Search by email as text
    const byEmailSearch = email ? await stripe.customers.search({ query: `email:"${email.trim()}"`, limit: 10 }) : { data: [] };

    // 3) Search by name
    const byName = name ? await stripe.customers.search({ query: `name:"${name}"`, limit: 10 }) : { data: [] };

    // 4) Search by partial name (first name)
    const firstName = name ? name.split(' ')[0] : (email ? email.split('@')[0] : '');
    const byFirstName = firstName ? await stripe.customers.search({ query: `name~"${firstName}"`, limit: 10 }) : { data: [] };

    // 5) Search payment intents by metadata or customer email field
    const sessionSearch = email
      ? await stripe.checkout.sessions.list({ limit: 100 }).then(res => ({
          data: res.data.filter(s => s.customer_details?.email?.toLowerCase() === email.trim().toLowerCase())
        }))
      : { data: [] };

    // Merge customers, deduplicate
    const seen = new Set();
    const allCustomers = [];
    for (const c of [...byEmail.data, ...byEmailSearch.data, ...byName.data, ...byFirstName.data]) {
      if (!seen.has(c.id)) { seen.add(c.id); allCustomers.push(c); }
    }

    const customerResults = [];
    for (const customer of allCustomers) {
      const [paymentIntents, charges, subscriptions] = await Promise.all([
        stripe.paymentIntents.list({ customer: customer.id, limit: 10 }),
        stripe.charges.list({ customer: customer.id, limit: 10 }),
        stripe.subscriptions.list({ customer: customer.id, limit: 5 }),
      ]);

      customerResults.push({
        customer_id: customer.id,
        email: customer.email,
        name: customer.name,
        created: new Date(customer.created * 1000).toISOString(),
        payment_intents: paymentIntents.data.map(pi => ({
          id: pi.id,
          amount: pi.amount / 100,
          status: pi.status,
          created: new Date(pi.created * 1000).toISOString(),
          metadata: pi.metadata,
        })),
        charges: charges.data.map(c => ({
          id: c.id,
          amount: c.amount / 100,
          status: c.status,
          created: new Date(c.created * 1000).toISOString(),
        })),
        subscriptions: subscriptions.data.map(s => ({
          id: s.id,
          status: s.status,
          created: new Date(s.created * 1000).toISOString(),
          items: s.items.data.map(i => i.price?.nickname || i.price?.id),
        })),
      });
    }

    return Response.json({
      found_customers: allCustomers.length,
      found_checkout_sessions_by_email: sessionSearch.data.length,
      customers: customerResults,
      checkout_sessions: sessionSearch.data.map(s => ({
        id: s.id,
        amount_total: s.amount_total / 100,
        status: s.status,
        payment_status: s.payment_status,
        customer_email: s.customer_email,
        customer: s.customer,
        created: new Date(s.created * 1000).toISOString(),
        metadata: s.metadata,
      })),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});