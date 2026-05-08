import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * manualRecoverLiveSubscription — ONE-TIME RECOVERY for live subscription that never reached Hub
 *
 * Use when Customer App sync has failed and we need Hub operational records now.
 * Pulls subscription details from Stripe directly, creates ShopifyOrder + FulfillmentTask,
 * then triggers batch recalculation.
 *
 * Payload: { stripe_subscription_id, customer_email, first_delivery_date }
 * All three are required. first_delivery_date must be the customer's actual delivery date.
 *
 * Idempotent: safe to run multiple times — dedupes on stripe_subscription_id.
 */

const PRODUCTION_DAYS = [2, 5, 6]; // Tue, Fri, Sat

function deriveProductionDate(deliveryDate) {
  const d = new Date(deliveryDate + 'T00:00:00');
  for (let i = 1; i <= 7; i++) {
    const check = new Date(d);
    check.setDate(d.getDate() - i);
    if (PRODUCTION_DAYS.includes(check.getDay())) {
      return check.toISOString().split('T')[0];
    }
  }
  const fallback = new Date(d);
  fallback.setDate(d.getDate() - 1);
  return fallback.toISOString().split('T')[0];
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const { stripe_subscription_id, customer_email, first_delivery_date } = body;

    if (!stripe_subscription_id || !customer_email || !first_delivery_date) {
      return Response.json({
        error: 'Required: stripe_subscription_id, customer_email, first_delivery_date'
      }, { status: 400 });
    }

    console.log(`[MANUAL-RECOVER] Starting recovery for ${customer_email} sub=${stripe_subscription_id}`);

    const productionDate = deriveProductionDate(first_delivery_date);
    console.log(`[MANUAL-RECOVER] Derived production_date=${productionDate} from delivery=${first_delivery_date}`);

    // ── Step 1: Pull subscription details from Stripe ──────────────────────────
    let stripeData = null;
    let fulfillmentItems = [];
    let customerName = '';
    let customerPhone = '';
    let addressLine1 = '';
    let addressCity = '';
    let addressState = '';
    let addressPostalCode = '';
    let planName = '';
    let cadence = '';

    const stripeApiKey = Deno.env.get('STRIPE_API_KEY');
    if (stripeApiKey) {
      try {
        const subRes = await fetch(`https://api.stripe.com/v1/subscriptions/${stripe_subscription_id}?expand[]=customer&expand[]=latest_invoice`, {
          headers: { Authorization: `Bearer ${stripeApiKey}` },
        });
        if (subRes.ok) {
          stripeData = await subRes.json();
          const customer = stripeData.customer;
          customerName = customer?.name || customer?.metadata?.full_name || '';
          customerPhone = customer?.phone || customer?.metadata?.phone || '';
          addressLine1 = customer?.address?.line1 || customer?.metadata?.address_line1 || '';
          addressCity = customer?.address?.city || customer?.metadata?.address_city || '';
          addressState = customer?.address?.state || customer?.metadata?.address_state || '';
          addressPostalCode = customer?.address?.postal_code || customer?.metadata?.address_postal_code || '';

          // Extract plan/product from subscription items
          const items = stripeData.items?.data || [];
          planName = items[0]?.price?.nickname || items[0]?.price?.product?.name || 'Subscription Plan';
          cadence = stripeData.metadata?.cadence || 'weekly';

          // Try to get products from subscription metadata
          const metaProducts = stripeData.metadata?.products;
          if (metaProducts) {
            try {
              const parsed = JSON.parse(metaProducts);
              fulfillmentItems = Array.isArray(parsed)
                ? parsed.map(p => ({ title: p.product_name || p.name, quantity: p.quantity || 1, price: 0 }))
                : [];
            } catch (_) {}
          }

          console.log(`[MANUAL-RECOVER] Stripe: customer=${customerName}, plan=${planName}`);
        }
      } catch (err) {
        console.warn(`[MANUAL-RECOVER] Stripe fetch failed: ${err.message} — continuing with provided data`);
      }
    }

    // Override with body-provided values if given
    if (body.customer_name) customerName = body.customer_name;
    if (body.customer_phone) customerPhone = body.customer_phone;
    if (body.address_line1) addressLine1 = body.address_line1;
    if (body.address_city) addressCity = body.address_city;
    if (body.address_state) addressState = body.address_state;
    if (body.address_postal_code) addressPostalCode = body.address_postal_code;
    if (body.plan_name) planName = body.plan_name;
    if (body.cadence) cadence = body.cadence;
    if (Array.isArray(body.products) && body.products.length > 0) {
      fulfillmentItems = body.products.map(p => ({ title: p.product_name || p.name, quantity: p.quantity || 1, price: 0 }));
    }

    // Fallback items if still empty
    if (fulfillmentItems.length === 0) {
      fulfillmentItems = [{ title: 'Subscription Fulfillment', quantity: 1, price: 0 }];
      console.warn('[MANUAL-RECOVER] No products found — using placeholder item. Provide body.products for accurate planning.');
    }

    const itemsSummary = fulfillmentItems.map(i => `${i.quantity}x ${i.title}`).join(', ');
    const deliveryAddress = [addressLine1, addressCity, addressState, addressPostalCode].filter(Boolean).join(', ');

    console.log(`[MANUAL-RECOVER] Items: ${itemsSummary}`);

    // ── Step 2: Idempotency — check for existing records ──────────────────────
    const existingOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({
      stripe_subscription_id,
    });

    let operationalOrderId = null;
    let orderAction = 'found';

    if (existingOrders && existingOrders.length > 0) {
      operationalOrderId = existingOrders[0].id;
      console.log(`[MANUAL-RECOVER] ✓ Existing ShopifyOrder found: ${operationalOrderId} — skipping create`);
    } else {
      // ── Step 3: Create subscription operational ShopifyOrder ──────────────
      const operationalOrder = await base44.asServiceRole.entities.ShopifyOrder.create({
        shopify_order_id: `sub_operational_${stripe_subscription_id}`,
        shopify_order_number: `#SUB-${stripe_subscription_id.slice(-10)}`,
        order_type: 'subscription',
        source_type: 'subscription_fulfillment',
        source_channel: 'subscription',
        fulfillment_method: 'delivery',
        fulfillment_mode: 'single_delivery',
        payment_status: 'paid',
        production_status: 'awaiting_production',
        order_lock_status: 'verified',
        data_quality_status: 'complete',
        sync_status: 'synced',
        customer_name: customerName,
        customer_email: customer_email,
        customer_phone: customerPhone,
        address_line1: addressLine1,
        address_city: addressCity,
        address_state: addressState,
        address_postal_code: addressPostalCode,
        address_country: 'US',
        delivery_notes: '',
        customer_notes: `Subscription: ${stripe_subscription_id} | Plan: ${planName} | Cadence: ${cadence} | Manually recovered: ${new Date().toISOString()}`,
        line_items: fulfillmentItems,
        fulfillments: [{
          fulfillment_number: 1,
          production_date: productionDate,
          delivery_date: first_delivery_date,
          items: fulfillmentItems,
          status: 'pending',
          address_line1: addressLine1,
          address_city: addressCity,
          address_state: addressState,
          address_postal_code: addressPostalCode,
          address_country: 'US',
        }],
        assigned_delivery_date: first_delivery_date,
        delivery_window_label: body.delivery_window_label || '5 PM – 8 PM',
        total_price: 0,
        subtotal: 0,
        stripe_subscription_id,
        customer_order_date: new Date().toISOString(),
        repair_status: 'repaired_from_event',
        repair_timestamp: new Date().toISOString(),
        repair_method: 'manualRecoverLiveSubscription',
      });

      operationalOrderId = operationalOrder.id;
      orderAction = 'created';
      console.log(`[MANUAL-RECOVER] ✓ Created ShopifyOrder: ${operationalOrderId}`);
    }

    // ── Step 4: Idempotency — check for existing FulfillmentTask ─────────────
    const existingTasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
      customer_email,
      scheduled_date: first_delivery_date,
    });

    const matchingTask = existingTasks?.find(t =>
      (t.notes && t.notes.includes(stripe_subscription_id)) ||
      t.stripe_subscription_id === stripe_subscription_id ||
      t.order_id === operationalOrderId
    );

    let fulfillmentTaskId = null;
    let taskAction = 'found';

    if (matchingTask) {
      fulfillmentTaskId = matchingTask.id;
      console.log(`[MANUAL-RECOVER] ✓ Existing FulfillmentTask found: ${fulfillmentTaskId} — skipping create`);
    } else {
      // ── Step 5: Create FulfillmentTask ────────────────────────────────────
      const createdTask = await base44.asServiceRole.entities.FulfillmentTask.create({
        customer_name: customerName,
        customer_email,
        customer_phone: customerPhone,
        fulfillment_type: 'Delivery',
        status: 'Scheduled',
        scheduled_date: first_delivery_date,
        delivery_address: deliveryAddress,
        address_line1: addressLine1,
        address_city: addressCity,
        address_state: addressState,
        address_postal_code: addressPostalCode,
        time_window: body.delivery_window_label || '5 PM – 8 PM',
        delivery_window_label: body.delivery_window_label || '5 PM – 8 PM',
        items_summary: itemsSummary,
        order_id: operationalOrderId,
        source_type: 'subscription_fulfillment',
        stripe_subscription_id,
        payment_status: 'paid',
        fulfillment_number: 1,
        plan_name: planName,
        cadence,
        notes: [
          `Subscription: ${stripe_subscription_id}`,
          planName ? `Plan: ${planName}` : null,
          cadence ? `Cadence: ${cadence}` : null,
          'Fulfillment #1',
          'Payment Status: paid',
          `Manually recovered: ${new Date().toISOString()}`
        ].filter(Boolean).join(' | '),
      });

      fulfillmentTaskId = createdTask.id;
      taskAction = 'created';
      console.log(`[MANUAL-RECOVER] ✓ Created FulfillmentTask: ${fulfillmentTaskId}`);
    }

    // ── Step 6: Trigger production batch recalculation ────────────────────────
    console.log('[MANUAL-RECOVER] Triggering batch recalculation...');
    try {
      const recalcResult = await base44.asServiceRole.functions.invoke('recalculateProductionBatches', {});
      console.log('[MANUAL-RECOVER] Batch recalculation:', recalcResult?.data?.message);
    } catch (err) {
      console.warn(`[MANUAL-RECOVER] Batch recalculation warning: ${err.message}`);
    }

    // ── Step 7: Verify ProductionBatch was created/updated ───────────────────
    const batches = await base44.asServiceRole.entities.ProductionBatch.filter({
      production_date: productionDate,
    });

    const batchesWithSub = batches.filter(b =>
      b.order_sources?.some(src =>
        src.source_type === 'subscription_fulfillment' &&
        (src.fulfillment_task_id === fulfillmentTaskId || src.order_id === operationalOrderId)
      )
    );

    // ── Step 8: Duplicate check ───────────────────────────────────────────────
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({ stripe_subscription_id });
    const allTasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
      customer_email,
      scheduled_date: first_delivery_date,
    });
    const subTasks = allTasks.filter(t =>
      t.stripe_subscription_id === stripe_subscription_id || t.order_id === operationalOrderId
    );

    const duplicateCheck = {
      shopify_orders: { count: allOrders.length, ok: allOrders.length === 1 },
      fulfillment_tasks: { count: subTasks.length, ok: subTasks.length === 1 },
    };

    const allGood = orderAction && fulfillmentTaskId && duplicateCheck.shopify_orders.ok && duplicateCheck.fulfillment_tasks.ok;

    console.log(`[MANUAL-RECOVER] ✓✓✓ Recovery complete. Order: ${operationalOrderId} | Task: ${fulfillmentTaskId} | Batches: ${batchesWithSub.length}`);

    return Response.json({
      status: allGood ? 'RECOVERY_COMPLETE' : 'RECOVERY_PARTIAL',
      operational_order: {
        id: operationalOrderId,
        action: orderAction,
        order_type: 'subscription',
        source_type: 'subscription_fulfillment',
        payment_status: 'paid',
        assigned_delivery_date: first_delivery_date,
        production_date: productionDate,
        stripe_subscription_id,
        items_summary: itemsSummary,
      },
      fulfillment_task: {
        id: fulfillmentTaskId,
        action: taskAction,
        customer_email,
        source_type: 'subscription_fulfillment',
        payment_status: 'paid',
        scheduled_date: first_delivery_date,
        items_summary: itemsSummary,
      },
      production_batches: {
        production_date: productionDate,
        batches_found: batchesWithSub.length,
        batch_ids: batchesWithSub.map(b => b.batch_id),
        order_sources: batchesWithSub.flatMap(b =>
          b.order_sources?.filter(s => s.source_type === 'subscription_fulfillment') || []
        ),
      },
      duplicate_check: duplicateCheck,
      note: allGood
        ? 'Hub operational records created. Run monitorLiveSubscriptionPurchaseEndToEnd to verify full chain.'
        : 'Partial recovery — check duplicate_check for issues.',
    });

  } catch (error) {
    console.error('[MANUAL-RECOVER] Unhandled error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});