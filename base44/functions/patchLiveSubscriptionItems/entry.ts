import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * patchLiveSubscriptionItems — ONE-TIME PATCH
 * Fetches real product/plan details from Stripe for a live subscription,
 * then updates the Hub ShopifyOrder + FulfillmentTask items_summary.
 * Also triggers batch recalculation.
 *
 * Payload: { stripe_subscription_id, operational_order_id, fulfillment_task_id }
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { stripe_subscription_id, operational_order_id, fulfillment_task_id } = await req.json();
    if (!stripe_subscription_id || !operational_order_id || !fulfillment_task_id) {
      return Response.json({ error: 'Required: stripe_subscription_id, operational_order_id, fulfillment_task_id' }, { status: 400 });
    }

    const stripeApiKey = Deno.env.get('STRIPE_API_KEY');

    // Fetch subscription + expand items and customer
    const subRes = await fetch(
      `https://api.stripe.com/v1/subscriptions/${stripe_subscription_id}?expand[]=items.data.price.product&expand[]=customer`,
      { headers: { Authorization: `Bearer ${stripeApiKey}` } }
    );
    const subData = await subRes.json();

    if (!subRes.ok) {
      return Response.json({ error: 'Stripe fetch failed', details: subData }, { status: 500 });
    }

    // Extract customer info
    const customer = subData.customer || {};
    const customerName = customer.name || customer.metadata?.full_name || '';
    const customerPhone = customer.phone || customer.metadata?.phone || '';
    const addressLine1 = customer.address?.line1 || customer.metadata?.address_line1 || '';
    const addressCity = customer.address?.city || customer.metadata?.address_city || '';
    const addressState = customer.address?.state || customer.metadata?.address_state || '';
    const addressPostalCode = customer.address?.postal_code || customer.metadata?.address_postal_code || '';

    // Extract subscription items / products
    const stripeItems = subData.items?.data || [];
    const planName = stripeItems[0]?.price?.nickname || subData.metadata?.plan_name || 'Monthly Subscription';
    const cadence = subData.metadata?.cadence || 'monthly';
    const amountPaid = subData.items?.data?.[0]?.price?.unit_amount || 0; // cents

    // Try to get products from metadata
    let fulfillmentItems = [];
    const metaProducts = subData.metadata?.products || customer.metadata?.products;
    if (metaProducts) {
      try {
        const parsed = JSON.parse(metaProducts);
        if (Array.isArray(parsed) && parsed.length > 0) {
          fulfillmentItems = parsed.map(p => ({
            title: p.product_name || p.name || p.title,
            quantity: p.quantity || 1,
            price: 0,
          }));
        }
      } catch (_) {}
    }

    // Fall back to subscription line item product name
    if (fulfillmentItems.length === 0) {
      for (const item of stripeItems) {
        const productName = item.price?.product?.name || item.price?.nickname || planName;
        fulfillmentItems.push({ title: productName, quantity: item.quantity || 1, price: 0 });
      }
    }

    const itemsSummary = fulfillmentItems.map(i => `${i.quantity}x ${i.title}`).join(', ');

    console.log(`[PATCH-SUB] Stripe data: customer=${customerName}, plan=${planName}, items=${itemsSummary}`);

    // Fetch current order to preserve fulfillments structure
    const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({ id: operational_order_id });
    const order = orders?.[0];

    if (!order) {
      return Response.json({ error: `ShopifyOrder ${operational_order_id} not found` }, { status: 404 });
    }

    // Update fulfillments items in place
    const updatedFulfillments = (order.fulfillments || []).map(f => ({
      ...f,
      items: fulfillmentItems,
      address_line1: addressLine1 || f.address_line1,
      address_city: addressCity || f.address_city,
      address_state: addressState || f.address_state,
      address_postal_code: addressPostalCode || f.address_postal_code,
    }));

    // Patch ShopifyOrder
    await base44.asServiceRole.entities.ShopifyOrder.update(operational_order_id, {
      customer_name: customerName || order.customer_name,
      customer_phone: customerPhone || order.customer_phone,
      address_line1: addressLine1 || order.address_line1,
      address_city: addressCity || order.address_city,
      address_state: addressState || order.address_state,
      address_postal_code: addressPostalCode || order.address_postal_code,
      line_items: fulfillmentItems,
      fulfillments: updatedFulfillments,
      total_price: amountPaid / 100,
      customer_notes: `Subscription: ${stripe_subscription_id} | Plan: ${planName} | Cadence: ${cadence} | Patched: ${new Date().toISOString()}`,
    });

    // Patch FulfillmentTask
    await base44.asServiceRole.entities.FulfillmentTask.update(fulfillment_task_id, {
      customer_name: customerName,
      customer_phone: customerPhone,
      address_line1: addressLine1,
      address_city: addressCity,
      address_state: addressState,
      address_postal_code: addressPostalCode,
      delivery_address: [addressLine1, addressCity, addressState, addressPostalCode].filter(Boolean).join(', '),
      items_summary: itemsSummary,
      plan_name: planName,
      cadence,
    });

    console.log(`[PATCH-SUB] Patched order ${operational_order_id} and task ${fulfillment_task_id} with real Stripe data`);

    // Trigger recalculation
    try {
      const recalcResult = await base44.asServiceRole.functions.invoke('recalculateProductionBatches', {});
      console.log('[PATCH-SUB] Batch recalculation:', recalcResult?.data?.message);
    } catch (err) {
      console.warn('[PATCH-SUB] Recalculation warning:', err.message);
    }

    return Response.json({
      status: 'PATCH_COMPLETE',
      stripe_data: {
        customer_name: customerName,
        customer_phone: customerPhone,
        address_line1: addressLine1,
        address_city: addressCity,
        address_state: addressState,
        plan_name: planName,
        cadence,
        items_summary: itemsSummary,
        total_price_cents: amountPaid,
      },
      patched: {
        operational_order_id,
        fulfillment_task_id,
        line_items: fulfillmentItems,
      },
      next_step: 'Run monitorLiveSubscriptionPurchaseEndToEnd to verify full chain.',
    });

  } catch (error) {
    console.error('[PATCH-SUB] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});