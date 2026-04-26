import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY'), { apiVersion: '2023-10-16' });

function normalizeTitle(title) {
  if (!title) return title;
  let t = title.replace(/^\d+\s*×\s*/, '').trim();
  t = t.replace(/\s*\(at\s+\$[\d.]+\s*\/\s*\w+\)/i, '').trim();
  t = t.replace(/\s*\(\$[\d.,]+.*?\)/i, '').trim();
  return t;
}

function getNextProductionDate(fromDate) {
  const PRODUCTION_DAYS = [2, 5, 6];
  const FIRST_PRODUCTION_DATE = '2026-05-01';
  const d = new Date(fromDate);
  d.setHours(0, 0, 0, 0);
  const firstProd = new Date(FIRST_PRODUCTION_DATE + 'T00:00:00');
  if (d < firstProd) return FIRST_PRODUCTION_DATE;
  for (let i = 1; i <= 14; i++) {
    const next = new Date(d);
    next.setDate(d.getDate() + i);
    if (PRODUCTION_DAYS.includes(next.getDay())) {
      const result = next.toISOString().split('T')[0];
      return result < FIRST_PRODUCTION_DATE ? FIRST_PRODUCTION_DATE : result;
    }
  }
  return FIRST_PRODUCTION_DATE;
}

function buildFulfillments(lineItems, bundles, addressFields) {
  // Build bundle lookup
  const bundleMap = {};
  for (const b of bundles) {
    if (b.is_active === false) continue;
    bundleMap[b.bundle_name.toLowerCase()] = b;
  }

  // Find fulfillment count from matching bundle
  let fulfillmentCount = 1;
  for (const item of lineItems) {
    const bundle = bundleMap[item.title.toLowerCase()];
    if (bundle && bundle.fulfillment_count > 1) {
      fulfillmentCount = bundle.fulfillment_count;
      break;
    }
  }

  const baseDate = getNextProductionDate(new Date());
  const fulfillments = [];

  for (let i = 0; i < fulfillmentCount; i++) {
    const prodDate = new Date(baseDate + 'T00:00:00');
    prodDate.setDate(prodDate.getDate() + 7 * i);
    const delivDate = new Date(prodDate);
    delivDate.setDate(delivDate.getDate() + 3);

    const items = [];
    for (const lineItem of lineItems) {
      const bundle = bundleMap[lineItem.title.toLowerCase()];
      if (bundle && bundle.components) {
        for (const comp of bundle.components) {
          items.push({
            title: comp.product_name,
            quantity: Math.max(1, Math.round((comp.quantity || 1) / fulfillmentCount)),
            price: 0,
          });
        }
      } else {
        items.push({
          title: lineItem.title,
          quantity: Math.max(1, Math.round((lineItem.quantity || 1) / fulfillmentCount)),
          price: lineItem.price || 0,
        });
      }
    }

    fulfillments.push({
      fulfillment_number: i + 1,
      production_date: prodDate.toISOString().split('T')[0],
      delivery_date: delivDate.toISOString().split('T')[0],
      items,
      status: 'pending',
      ...addressFields,
      delivery_notes: '',
    });
  }

  return fulfillments;
}

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
              title: normalizeTitle(item.description || item.plan?.nickname || 'Subscription'),
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

        // Load bundles to build fulfillments
        const bundles = await base44.asServiceRole.entities.Bundle.list('-updated_date', 100);
        const fulfillments = buildFulfillments(lineItems, bundles, {
          address_line1: addressFields.address_line1 || '',
          address_line2: addressFields.address_line2 || '',
          address_city: addressFields.address_city || '',
          address_state: addressFields.address_state || '',
          address_postal_code: addressFields.address_postal_code || '',
          address_country: addressFields.address_country || 'US',
        });

        const orderData = {
          shopify_order_id: sub.id,
          shopify_order_number: orderNumber,
          customer_email: email,
          customer_name: name,
          source_channel: 'subscription',
          stripe_subscription_id: sub.id,
          stripe_customer_id: customer.id,
          line_items: lineItems,
          fulfillments,
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

        // Route ALL writes through safeSyncOrderUpdate — enforces locks, subscription protection, field ownership
        const safeResult = await base44.asServiceRole.functions.invoke('safeSyncOrderUpdate', {
          incomingData: orderData,
          source: 'rebuild_subscriptions',
          matchBy: { stripe_subscription_id: sub.id },
        });

        const action = safeResult?.data?.action || safeResult?.data?.status;
        if (action === 'created') {
          results.created.push({ email, sub_id: sub.id, order_number: orderNumber, fulfillments: fulfillments.length });
        } else if (action === 'updated') {
          results.updated.push({ email, sub_id: sub.id, order_number: orderNumber, fulfillments: fulfillments.length });
        } else {
          results.skipped.push({ email, sub_id: sub.id, reason: safeResult?.data?.reason || 'gateway_rejected' });
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