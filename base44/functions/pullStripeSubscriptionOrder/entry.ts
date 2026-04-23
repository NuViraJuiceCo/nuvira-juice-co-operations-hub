import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY'));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { customer_name } = await req.json();

    if (!customer_name) {
      return Response.json({ error: 'customer_name is required' }, { status: 400 });
    }

    // Search for customer by name
    const customers = await stripe.customers.list({
      limit: 100,
    });

    const customer = customers.data.find(c => 
      c.name?.toLowerCase() === customer_name.toLowerCase()
    );

    if (!customer) {
      return Response.json({ error: `Customer "${customer_name}" not found in Stripe` }, { status: 404 });
    }

    // Fetch subscriptions for this customer
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      limit: 100,
    });

    if (subscriptions.data.length === 0) {
      return Response.json({ error: `No subscriptions found for customer "${customer_name}"` }, { status: 404 });
    }

    // Process each subscription and create order records
    const createdOrders = [];

    for (const subscription of subscriptions.data) {
      // Get invoice for this subscription
      const invoices = await stripe.invoices.list({
        subscription: subscription.id,
        limit: 1,
      });

      const invoice = invoices.data[0];
      if (!invoice) continue;

      // Map subscription items to line items
      const lineItems = subscription.items.data.map(item => ({
        title: item.plan.nickname || item.plan.product || 'Subscription',
        quantity: item.quantity || 1,
        price: (item.plan.amount || 0) / 100,
      }));

      // Create ShopifyOrder record
      const order = await base44.asServiceRole.entities.ShopifyOrder.create({
        shopify_order_id: subscription.id,
        shopify_order_number: `#STRIPE-SUB-${subscription.id.slice(-8).toUpperCase()}`,
        customer_email: customer.email || 'unknown@stripe.local',
        customer_phone: customer.phone || '',
        line_items: lineItems,
        subtotal: (invoice.subtotal || 0) / 100,
        total_price: (invoice.total || 0) / 100,
        source_channel: 'subscription',
        fulfillment_method: 'shipping',
        payment_status: invoice.paid ? 'paid' : 'pending',
        production_status: 'new',
        sync_status: 'synced',
        customer_order_date: new Date(subscription.created * 1000).toISOString(),
      });

      createdOrders.push(order);
    }

    return Response.json({
      success: true,
      customer_name: customer.name,
      customer_email: customer.email,
      subscriptions_processed: subscriptions.data.length,
      orders_created: createdOrders.length,
      orders: createdOrders.map(o => ({ id: o.id, order_number: o.shopify_order_number })),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});