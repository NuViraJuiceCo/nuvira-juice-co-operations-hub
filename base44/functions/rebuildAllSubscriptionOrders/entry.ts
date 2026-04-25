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

    const results = { created: [], updated: [], skipped: [], failed: [] };

    // Fetch all active + past_due subscriptions from Stripe
    let subscriptions = [];
    let hasMore = true;
    let startingAfter = null;

    while (hasMore) {
      const params = { limit: 100, expand: ['data.customer', 'data.latest_invoice'] };
      if (startingAfter) params.starting_after = startingAfter;

      const page = await stripe.subscriptions.list(params);
      subscriptions = [...subscriptions, ...page.data];
      hasMore = page.has_more;
      if (page.data.length > 0) startingAfter = page.data[page.data.length - 1].id;
    }

    console.log(`[REBUILD-SUBS] Found ${subscriptions.length} subscriptions in Stripe`);

    for (const sub of subscriptions) {
      try {
        const customer = typeof sub.customer === 'object' ? sub.customer : await stripe.customers.retrieve(sub.customer);
        const email = customer.email;
        const name = customer.name || '';

        if (!email) {
          results.failed.push({ sub_id: sub.id, reason: 'no_email' });
          continue;
        }

        // Check if a subscription order already exists for this customer
        const existingOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({
          customer_email: email,
          source_channel: 'subscription',
        });

        // Get line items from the latest invoice
        let lineItems = [];
        try {
          const invoice = typeof sub.latest_invoice === 'object'
            ? sub.latest_invoice
            : await stripe.invoices.retrieve(sub.latest_invoice);

          if (invoice?.lines?.data) {
            lineItems = invoice.lines.data.map(item => ({
              title: item.description || item.plan?.nickname || 'Subscription',
              quantity: item.quantity || 1,
              price: (item.amount || 0) / 100,
            }));
          }
        } catch (err) {
          console.warn(`[REBUILD-SUBS] Could not fetch invoice for ${sub.id}: ${err.message}`);
        }

        // Try to get address from customer or latest invoice
        let addressFields = {};
        try {
          const addr = customer.address || customer.shipping?.address || {};
          addressFields = {
            address_line1: addr.line1 || '',
            address_line2: addr.line2 || '',
            address_city: addr.city || '',
            address_state: addr.state || '',
            address_postal_code: addr.postal_code || '',
            address_country: addr.country || 'US',
          };
        } catch (_) {}

        const totalPrice = (sub.latest_invoice?.amount_paid || 0) / 100;
        const orderNumber = `#SUB-${sub.id.replace('sub_', '').slice(0, 8).toUpperCase()}`;

        const orderData = {
          shopify_order_id: sub.id,
          shopify_order_number: orderNumber,
          customer_email: email,
          customer_name: name,
          source_channel: 'subscription',
          stripe_subscription_id: sub.id,
          stripe_customer_id: customer.id,
          line_items: lineItems,
          total_price: totalPrice,
          subtotal: totalPrice,
          payment_status: sub.status === 'active' ? 'paid' : 'pending',
          production_status: 'new',
          fulfillment_method: 'delivery',
          sync_status: 'synced',
          source_type: 'stripe_subscription',
          last_sync_at: new Date().toISOString(),
          customer_order_date: new Date(sub.created * 1000).toISOString(),
          ...addressFields,
        };

        if (existingOrders && existingOrders.length > 0) {
          // Update existing — but preserve production_status and fulfillments
          const existing = existingOrders[0];
          const meaningfulStatuses = ['awaiting_production','in_production','bottled','labeled','qc_checked','packed','in_cold_storage','assigned_for_pickup','assigned_for_delivery','fulfilled','canceled','refunded'];
          if (meaningfulStatuses.includes(existing.production_status)) {
            orderData.production_status = existing.production_status;
          }
          if (existing.fulfillments?.length > 0) {
            orderData.fulfillments = existing.fulfillments;
          }
          if (existing.internal_notes) {
            orderData.internal_notes = existing.internal_notes;
          }

          await base44.asServiceRole.entities.ShopifyOrder.update(existing.id, orderData);
          results.updated.push({ email, sub_id: sub.id, order_number: orderNumber });
        } else {
          await base44.asServiceRole.entities.ShopifyOrder.create(orderData);
          results.created.push({ email, sub_id: sub.id, order_number: orderNumber });
        }
      } catch (err) {
        console.error(`[REBUILD-SUBS] Failed for ${sub.id}: ${err.message}`);
        results.failed.push({ sub_id: sub.id, reason: err.message });
      }
    }

    const summary = `Created ${results.created.length}, updated ${results.updated.length}, failed ${results.failed.length} subscription orders.`;
    console.log(`[REBUILD-SUBS] Done: ${summary}`);
    return Response.json({ status: 'success', message: summary, results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});