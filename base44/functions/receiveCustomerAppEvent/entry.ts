import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * receiveCustomerAppEvent — Hub inbound endpoint for customer app push events
 *
 * Accepts events pushed by the customer app's syncCustomerToHub function.
 * This is the canonical HUB_API_URL target for all customer-side push events.
 *
 * Auth: Authorization: Bearer <CUSTOMER_APP_SYNC_SECRET>
 *
 * Supported event types:
 *   customer.profile_updated      — update customer name/phone on existing orders
 *   customer.bag_return           — create/update BagReturn record
 *   customer.onboarding_complete        — no-op, acknowledged
 *   customer.subscription_created       — trigger order pull for this customer
 *   customer.subscription_future_cancel — customer cancels FUTURE renewal (no cascade, current cycle preserved)
 *   customer.subscription_future_pause  — customer pauses NEXT cycle (no cascade, current cycle preserved)
 *   customer.subscription_cancelled     — admin/Stripe-triggered full cancel with cascade (refund path)
 *   order.created / order.paid          — sync paid order to Hub
 *   order.refunded                      — cascade refund through Hub (cancel order, tasks, batches)
 *   order.status_updated                — acknowledged (hub owns status, not customer app)
 *
 * POLICY: customer.subscription_future_cancel and customer.subscription_future_pause are
 * customer self-service events. They do NOT cascade. Current paid cycle is PRESERVED.
 * Only customer.subscription_cancelled (admin/Stripe refund path) triggers the full cascade.
 */

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const INTERNAL_SECRET = Deno.env.get('INTERNAL_FUNCTION_SECRET');

async function processOrderLoyalty(base44, orderId) {
  if (!orderId) return { processed: false, reason: 'hub_order_id_missing' };
  try {
    const result = await base44.asServiceRole.functions.invoke('awardOrderPoints', {
      order_id: orderId,
      _internalSecret: INTERNAL_SECRET,
    });
    return { processed: true, ...(result?.data || result || {}) };
  } catch (error) {
    return {
      processed: false,
      retry_required: true,
      reason: String(error?.message || 'order_loyalty_processing_failed').slice(0, 160),
    };
  }
}

const ORDER_ADJUSTMENT_CHOICES = new Set(['full_order_saturday', 'oasis_saturday', 'oasis_refund']);
const IMMUTABLE_PRODUCTION_STATES = new Set([
  'in_production', 'bottled', 'labeled', 'qc_checked', 'packed', 'in_cold_storage',
  'assigned_for_pickup', 'assigned_for_delivery', 'fulfilled', 'refunded', 'canceled', 'cancelled',
]);
const IMMUTABLE_ORDER_LOCKS = new Set(['in_production', 'out_for_delivery', 'fulfilled']);
const IMMUTABLE_BATCH_STATES = new Set(['in_production', 'completed_pending_verification', 'verified_logged', 'archived']);

function safeText(value, max = 180) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function stateKey(value) {
  return safeText(value, 80).toLowerCase().replace(/[\s-]+/g, '_');
}

function validDate(value) {
  const date = safeText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? '' : date;
}

function productKey(value) {
  return safeText(value, 120).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeAdjustmentItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 40) return [];
  return items.map((item) => ({
    title: safeText(item?.title || item?.product_name, 120),
    quantity: Number(item?.quantity || 0),
  })).filter((item) => item.title && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 500);
}

function validateAdjustmentPlan(data, { requireRefundConfirmation = true } = {}) {
  const requestId = safeText(data?.request_id, 180);
  const orderNumber = safeText(data?.order_number, 80).replace(/^#/, '');
  const choice = safeText(data?.choice, 80);
  if (!/^[A-Za-z0-9:._-]{8,180}$/.test(requestId) || !orderNumber || !ORDER_ADJUSTMENT_CHOICES.has(choice)) {
    return { error: 'invalid_order_adjustment_identity' };
  }
  const rawFulfillments = Array.isArray(data?.fulfillments) ? data.fulfillments : [];
  const expectedCount = choice === 'oasis_saturday' ? 2 : 1;
  if (rawFulfillments.length !== expectedCount) return { error: 'invalid_order_adjustment_fulfillment_count' };
  const fulfillments = rawFulfillments.map((row, index) => ({
    fulfillment_number: index + 1,
    production_date: validDate(row?.production_date),
    delivery_date: validDate(row?.delivery_date),
    items: normalizeAdjustmentItems(row?.items),
    status: 'pending',
  }));
  if (fulfillments.some((row) => !row.production_date || !row.delivery_date || row.items.length === 0)) {
    return { error: 'invalid_order_adjustment_fulfillment' };
  }

  const firstHasOasis = fulfillments[0].items.some((item) => productKey(item.title) === 'oasis');
  if (choice === 'full_order_saturday' && !firstHasOasis) return { error: 'full_order_plan_missing_oasis' };
  if (choice !== 'full_order_saturday' && firstHasOasis) return { error: 'current_plan_must_exclude_oasis' };
  if (choice === 'oasis_saturday') {
    if (fulfillments[1].items.some((item) => productKey(item.title) !== 'oasis')) return { error: 'split_plan_follow_up_must_be_oasis_only' };
  }
  if (choice === 'oasis_refund') {
    const amount = Number(data?.refund?.amount || 0);
    const confirmationInvalid = requireRefundConfirmation
      && (stateKey(data?.refund?.status) !== 'succeeded' || !safeText(data?.refund?.stripe_refund_id, 180));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 500 || confirmationInvalid) {
      return { error: 'invalid_partial_refund_confirmation' };
    }
  }
  return { requestId, orderNumber, choice, fulfillments };
}

function taskItemsSummary(items) {
  return items.map((item) => `${item.quantity}x ${item.title}`).join(', ');
}

function taskUpdateForFulfillment(fulfillment, choice, requestId) {
  return {
    fulfillment_number: fulfillment.fulfillment_number,
    scheduled_date: fulfillment.delivery_date,
    production_date: fulfillment.production_date,
    status: 'Scheduled',
    delivery_status: 'pending',
    items_summary: taskItemsSummary(fulfillment.items),
    notes: `Customer order adjustment ${requestId}: ${choice}`,
  };
}

async function loadEligibleAdjustmentContext(base44, plan) {
  const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_number: plan.orderNumber });
  if (!orders || orders.length !== 1) {
    return {
      error: orders?.length ? 'order_context_ambiguous' : 'order_not_found',
      status: orders?.length ? 409 : 404,
    };
  }
  const order = orders[0];
  if (stateKey(order.order_type) !== 'one_time' || stateKey(order.payment_status) === 'refunded') {
    return { error: 'order_not_eligible_for_adjustment', status: 409 };
  }
  if (IMMUTABLE_PRODUCTION_STATES.has(stateKey(order.production_status)) || IMMUTABLE_ORDER_LOCKS.has(stateKey(order.order_lock_status))) {
    return { error: 'order_already_in_production_or_fulfillment', status: 409 };
  }

  const tasks = await base44.asServiceRole.entities.FulfillmentTask.filter({ order_id: order.id });
  if ((tasks || []).some((task) => ['packed', 'in_transit', 'out_for_delivery', 'completed'].includes(stateKey(task.status)))) {
    return { error: 'fulfillment_already_in_progress', status: 409 };
  }

  const desired = new Map();
  for (const fulfillment of plan.fulfillments) {
    for (const item of fulfillment.items) {
      desired.set(`${fulfillment.production_date}__${productKey(item.title)}`, item.quantity);
    }
  }
  const batches = await base44.asServiceRole.entities.ProductionBatch.list('-production_date', 500);
  for (const batch of batches || []) {
    const sources = Array.isArray(batch.order_sources) ? batch.order_sources : [];
    const current = sources.filter((source) => source.order_id === order.id);
    if (current.length === 0) continue;
    const wanted = desired.get(`${batch.production_date}__${productKey(batch.product_name)}`);
    const currentQuantity = current.reduce((sum, source) => sum + Number(source.quantity || 0), 0);
    if ((batch.is_locked || IMMUTABLE_BATCH_STATES.has(stateKey(batch.status))) && (wanted === undefined || wanted !== currentQuantity)) {
      return { error: 'locked_production_batch_requires_operator', status: 409 };
    }
  }
  return { order, tasks, batches };
}

async function reconcileAdjustmentTasks(base44, order, plan) {
  const tasks = await base44.asServiceRole.entities.FulfillmentTask.filter({ order_id: order.id });
  const activeTasks = (tasks || []).filter((task) => !['completed', 'cancelled'].includes(stateKey(task.status)));
  if (activeTasks.some((task) => ['packed', 'in_transit', 'out_for_delivery'].includes(stateKey(task.status)))) {
    throw new Error('fulfillment_already_in_progress');
  }
  let primary = activeTasks.find((task) => Number(task.fulfillment_number || 1) === 1) || activeTasks[0] || null;
  const primaryPatch = taskUpdateForFulfillment(plan.fulfillments[0], plan.choice, plan.requestId);
  if (primary?.id) {
    primary = await base44.asServiceRole.entities.FulfillmentTask.update(primary.id, primaryPatch);
  } else {
    primary = await base44.asServiceRole.entities.FulfillmentTask.create({
      customer_name: order.customer_name || 'Customer',
      customer_email: order.customer_email || '',
      customer_phone: order.customer_phone || '',
      fulfillment_type: 'Delivery',
      time_window: order.delivery_window_label || '',
      delivery_window_label: order.delivery_window_label || '',
      address_line1: order.address_line1 || '',
      address_line2: order.address_line2 || '',
      address_city: order.address_city || '',
      address_state: order.address_state || '',
      address_postal_code: order.address_postal_code || '',
      order_id: order.id,
      order_number: order.shopify_order_number,
      source_type: 'order_derived',
      payment_status: order.payment_status,
      ...primaryPatch,
    });
  }

  const taskIds = [primary.id];
  if (plan.fulfillments.length === 2) {
    const followUpPatch = taskUpdateForFulfillment(plan.fulfillments[1], plan.choice, plan.requestId);
    const followUp = activeTasks.find((task) => Number(task.fulfillment_number) === 2 && safeText(task.notes).includes(plan.requestId));
    const result = followUp?.id
      ? await base44.asServiceRole.entities.FulfillmentTask.update(followUp.id, followUpPatch)
      : await base44.asServiceRole.entities.FulfillmentTask.create({
        customer_name: order.customer_name || 'Customer',
        customer_email: order.customer_email || '',
        customer_phone: order.customer_phone || '',
        fulfillment_type: 'Delivery',
        time_window: order.delivery_window_label || '',
        delivery_window_label: order.delivery_window_label || '',
        address_line1: order.address_line1 || '',
        address_line2: order.address_line2 || '',
        address_city: order.address_city || '',
        address_state: order.address_state || '',
        address_postal_code: order.address_postal_code || '',
        order_id: order.id,
        order_number: order.shopify_order_number,
        source_type: 'order_derived',
        payment_status: order.payment_status,
        ...followUpPatch,
      });
    taskIds.push(result.id);
  }
  return taskIds;
}

async function reconcileAdjustmentBatchDemand(base44, order, plan) {
  const desired = new Map();
  for (const fulfillment of plan.fulfillments) {
    for (const item of fulfillment.items) {
      const key = `${fulfillment.production_date}__${productKey(item.title)}`;
      desired.set(key, { production_date: fulfillment.production_date, title: item.title, quantity: item.quantity });
    }
  }
  const batches = await base44.asServiceRole.entities.ProductionBatch.list('-production_date', 500);
  for (const batch of batches || []) {
    const sources = Array.isArray(batch.order_sources) ? batch.order_sources : [];
    const current = sources.filter((source) => source.order_id === order.id);
    if (current.length === 0) continue;
    const key = `${batch.production_date}__${productKey(batch.product_name)}`;
    const target = desired.get(key);
    const currentQuantity = current.reduce((sum, source) => sum + Number(source.quantity || 0), 0);
    if ((batch.is_locked || IMMUTABLE_BATCH_STATES.has(stateKey(batch.status))) && (!target || target.quantity !== currentQuantity)) {
      throw new Error(`locked_batch_adjustment_required:${batch.batch_id || batch.id}`);
    }
  }

  for (const batch of batches || []) {
    if (batch.is_locked || IMMUTABLE_BATCH_STATES.has(stateKey(batch.status))) continue;
    const sources = Array.isArray(batch.order_sources) ? batch.order_sources : [];
    const current = sources.filter((source) => source.order_id === order.id);
    if (current.length === 0) continue;
    const key = `${batch.production_date}__${productKey(batch.product_name)}`;
    const target = desired.get(key);
    const remaining = sources.filter((source) => source.order_id !== order.id);
    const nextSources = target ? [...remaining, {
      order_id: order.id,
      order_number: order.shopify_order_number,
      customer_email: order.customer_email || '',
      customer_name: order.customer_name || '',
      quantity: target.quantity,
      source_type: 'customer_order_adjustment',
      source_item: target.title,
    }] : remaining;
    if (nextSources.length === 0) {
      await base44.asServiceRole.entities.ProductionBatch.delete(batch.id);
    } else {
      await base44.asServiceRole.entities.ProductionBatch.update(batch.id, {
        order_sources: nextSources,
        planned_units: nextSources.reduce((sum, source) => sum + Number(source.quantity || 0), 0),
      });
    }
  }

  const result = await base44.asServiceRole.functions.invoke('triggerBatchDemandForDates', {
    _internalSecret: INTERNAL_SECRET,
    production_dates: [...new Set(plan.fulfillments.map((row) => row.production_date))],
    order_id: order.id,
    order_number: order.shopify_order_number,
    customer_email: order.customer_email || '',
    customer_name: order.customer_name || '',
    fulfillments: plan.fulfillments,
  });
  const data = result?.data || result || {};
  if (Number(data.errors || 0) > 0) throw new Error('batch_demand_update_failed');
  return data;
}

Deno.serve(async (req) => {
  // ───────────────────────────────────────────────────────────────────────────
  // CHECK FOR GATEWAY AUTH FLAG EARLY (before body parsing)
  // ───────────────────────────────────────────────────────────────────────────
  let isFromGateway = false;
  let internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');

  // ───────────────────────────────────────────────────────────────────────────
  // DIAGNOSTIC LOGGING: Log all incoming request details (no secrets)
  // ───────────────────────────────────────────────────────────────────────────
  const requestPath = new URL(req.url).pathname;
  const hasAuthHeader = !!req.headers.get('Authorization');
  const authHeaderValue = req.headers.get('Authorization') || 'NOT_PROVIDED';
  const authHeaderLength = hasAuthHeader ? authHeaderValue.split(' ').pop()?.length || 0 : 0;

  console.log('[RECEIVE-CUSTOMER-EVENT] ════════════════════════════════════════');
  console.log('[RECEIVE-CUSTOMER-EVENT] INCOMING REQUEST DIAGNOSTICS');
  console.log('[RECEIVE-CUSTOMER-EVENT] Timestamp:', new Date().toISOString());
  console.log('[RECEIVE-CUSTOMER-EVENT] HTTP Method:', req.method);
  console.log('[RECEIVE-CUSTOMER-EVENT] Path:', requestPath);
  console.log('[RECEIVE-CUSTOMER-EVENT] URL:', req.url);
  console.log('[RECEIVE-CUSTOMER-EVENT] Authorization Header Present:', hasAuthHeader);
  console.log('[RECEIVE-CUSTOMER-EVENT] Auth Header Format:', authHeaderValue.split(' ')[0] || 'MISSING');
  console.log('[RECEIVE-CUSTOMER-EVENT] Token Length:', authHeaderLength, 'chars');
  console.log('[RECEIVE-CUSTOMER-EVENT] SYNC_SECRET Loaded:', !!SYNC_SECRET, 'length:', SYNC_SECRET?.length || 0);
  console.log('[RECEIVE-CUSTOMER-EVENT] ════════════════════════════════════════');

  if (req.method !== 'POST') {
    console.error('[RECEIVE-CUSTOMER-EVENT] REJECT: Method not allowed. Expected POST, got', req.method);
    return Response.json({ error: 'Method not allowed. Expected POST.' }, { status: 405 });
  }

  // NOTE: Auth check will happen after body parsing so we can check for gateway flag

  try {
    const base44 = createClientFromRequest(req);
    let body;
    try {
      body = await req.json();
    } catch (jsonErr) {
      console.error('[RECEIVE-CUSTOMER-EVENT] REJECT: Failed to parse JSON body:', jsonErr.message);
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { event, _gatewayAuth, _internalSecret } = body;
    // Customer App sends order data under body.order OR body.data — support both
    const data = body.order || body.data || {};

    // GATEWAY BYPASS: If called via customerAppEventPublicGateway, skip Bearer token validation
    // Gateway already validated the token, so we trust it
    if (_gatewayAuth === 'trusted' && _internalSecret === internalSecret) {
      isFromGateway = true;
      console.log('[RECEIVE-CUSTOMER-EVENT] ✅ GATEWAY AUTH FLAG DETECTED — skipping Bearer validation');
    } else {
      // Direct HTTP call — validate Bearer token
      const authHeader = req.headers.get('Authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      
      if (!token) {
        console.error('[RECEIVE-CUSTOMER-EVENT] REJECT: Missing Authorization header or Bearer token');
        return Response.json({ 
          error: 'Unauthorized: Missing Authorization header',
          detail: 'Expected: Authorization: Bearer <CUSTOMER_APP_SYNC_SECRET>',
        }, { status: 401 });
      }
      
      if (token !== SYNC_SECRET) {
        console.error('[RECEIVE-CUSTOMER-EVENT] REJECT: Invalid Bearer token');
        return Response.json({ 
          error: 'Unauthorized: Invalid token',
        }, { status: 401 });
      }
      
      console.log('[RECEIVE-CUSTOMER-EVENT] ✅ AUTHORIZATION SUCCESSFUL (Direct HTTP)');
    }

    console.log('[RECEIVE-CUSTOMER-EVENT] PARSED EVENT:');
    console.log('[RECEIVE-CUSTOMER-EVENT]  - event:', event);
    console.log('[RECEIVE-CUSTOMER-EVENT]  - customer_email:', body.customer_email || data.customer_email || 'NOT_PROVIDED');
    console.log('[RECEIVE-CUSTOMER-EVENT]  - stripe_subscription_id:', body.stripe_subscription_id || data.stripe_subscription_id || 'NOT_PROVIDED');
    console.log('[RECEIVE-CUSTOMER-EVENT]  - from_gateway:', isFromGateway);
    console.log('[RECEIVE-CUSTOMER-EVENT]  - payload_keys:', Object.keys(body).join(', '));

    if (!event) {
      return Response.json({ error: 'Missing event type' }, { status: 400 });
    }

    console.log(`[RECEIVE-CUSTOMER-EVENT] event=${event}, email=${data?.customer_email || 'unknown'}`);

    // ── customer.profile_updated ──────────────────────────────────────────────
    if (event === 'customer.profile_updated') {
      if (!data?.customer_email) {
        return Response.json({ error: 'Missing customer_email' }, { status: 400 });
      }
      // Update customer name/phone on any existing orders for this email
      const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({ customer_email: data.customer_email });
      let updated = 0;
      for (const order of (orders || [])) {
        const patch = {};
        if (data.customer_name && !order.customer_name) patch.customer_name = data.customer_name;
        if (data.customer_phone && !order.customer_phone) patch.customer_phone = data.customer_phone;
        if (Object.keys(patch).length > 0) {
          await base44.asServiceRole.entities.ShopifyOrder.update(order.id, patch);
          updated++;
        }
      }
      return Response.json({ status: 'success', event, updated_orders: updated });
    }

    // ── customer.bag_return ───────────────────────────────────────────────────
    if (event === 'customer.bag_return') {
      if (!data?.customer_email || !data?.order_id) {
        return Response.json({ error: 'Missing customer_email or order_id' }, { status: 400 });
      }
      const existing = await base44.asServiceRole.entities.BagReturn.filter({
        order_id: data.order_id,
        customer_email: data.customer_email,
      });
      const returnData = {
        order_id: data.order_id,
        customer_email: data.customer_email,
        small_bags_requested: data.small_bags_requested || 0,
        tote_bags_requested: data.tote_bags_requested || 0,
        verification_status: 'requested',
        sync_status: 'synced',
      };
      if (existing && existing.length > 0) {
        // Only update if still in requested state — don't overwrite driver verifications
        if (existing[0].verification_status === 'requested') {
          await base44.asServiceRole.entities.BagReturn.update(existing[0].id, returnData);
        }
        return Response.json({ status: 'success', event, action: 'updated' });
      } else {
        await base44.asServiceRole.entities.BagReturn.create(returnData);
        return Response.json({ status: 'success', event, action: 'created' });
      }
    }

    // ── customer.subscription_created ────────────────────────────────────────
    // For PAID subscriptions: create subscription operational ShopifyOrder + FulfillmentTask
    if (event === 'customer.subscription_created') {
      if (!data?.customer_email || !data?.stripe_subscription_id || !data?.first_delivery_date) {
        return Response.json({
          error: 'Missing required fields: customer_email, stripe_subscription_id, first_delivery_date',
          status: 400
        }, { status: 400 });
      }

      // GUARDRAIL: Validate and auto-decompose products if CA sent only plan name
      // Products must be per-weekly-fulfillment quantities, NOT total monthly quantities
      if (!Array.isArray(data.products) || data.products.length === 0) {
        if (data.plan_name || data.plan_id) {
          console.log(`[RECEIVE-CUSTOMER-EVENT] No products in payload — auto-decomposing plan: ${data.plan_name}`);
          try {
            const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');
            const decompResult = await base44.asServiceRole.functions.invoke('decomposeSubscriptionPlan', {
              plan_name: data.plan_name || null,
              plan_id: data.plan_id || null,
              _internalSecret: internalSecret,
            });
            const d = decompResult?.data;
            if (d?.products?.length > 0) {
              data.products = d.products;
              data.items_summary = d.items_summary;
              data.fulfillment_cadence = d.fulfillment_cadence;
              data.billing_cadence = d.billing_cadence;
              console.log(`[RECEIVE-CUSTOMER-EVENT] Auto-decomposed: ${d.items_summary}`);
            } else {
              return Response.json({ error: 'Could not decompose subscription plan — no products resolved' }, { status: 400 });
            }
          } catch (decompErr) {
            return Response.json({ error: `Decomposition failed: ${decompErr.message}` }, { status: 400 });
          }
        } else {
          return Response.json({
            error: 'Missing products array. Send decomposed per-fulfillment products (e.g. 1x Aura, 1x Oasis, 1x Re-Nu for Monthly Ritual) or include plan_name for auto-decomposition.',
            status: 400
          }, { status: 400 });
        }
      }

      // GUARDRAIL: Only process paid subscriptions
      const paymentStatus = data.payment_status || data.financial_status || '';
      if (paymentStatus !== 'paid') {
        console.log(`[RECEIVE-CUSTOMER-EVENT] Subscription for ${data.customer_email} payment_status=${paymentStatus} (not paid) — acknowledged but no fulfillment created`);
        return Response.json({
          status: 'acknowledged',
          event,
          note: `Subscription acknowledged but not yet paid (payment_status=${paymentStatus}). Will process when payment succeeds.`
        }, { status: 200 });
      }

      try {
        const PRODUCTION_DAYS = [2, 5, 6]; // 0=Sun, 2=Tue, 5=Fri, 6=Sat

        // Derive production_date from first_delivery_date (1 day before on valid production day)
        const d = new Date(data.first_delivery_date + 'T00:00:00');
        let productionDate = null;
        for (let i = 1; i <= 7; i++) {
          const check = new Date(d);
          check.setDate(d.getDate() - i);
          if (PRODUCTION_DAYS.includes(check.getDay())) {
            productionDate = check.toISOString().split('T')[0];
            break;
          }
        }
        if (!productionDate) {
          const fallback = new Date(d);
          fallback.setDate(d.getDate() - 1);
          productionDate = fallback.toISOString().split('T')[0];
        }

        // Build fulfillment items from products array
        const fulfillmentItems = Array.isArray(data.products) && data.products.length > 0
          ? data.products.map(p => ({ title: p.product_name, quantity: p.quantity, price: 0 }))
          : [];

        // Build full address
        const addr = data.address || {};
        const deliveryAddress = [
          addr.street || data.address_line1 || '',
          addr.city || data.address_city || '',
          addr.state || data.address_state || '',
          addr.postal_code || data.address_postal_code || ''
        ].filter(Boolean).join(', ');

        const itemsSummary = fulfillmentItems.map(i => `${i.quantity}x ${i.title}`).join(', ');

        // Idempotency check: dedupe on stripe_subscription_id + customer_app_subscription_id + fulfillment_number=1 + first_delivery_date
        // This prevents duplicate operational orders when CA retries the same subscription sync.
        const existingOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({
          stripe_subscription_id: data.stripe_subscription_id,
        });

        // Filter out quarantined/archived duplicates — only match active subscription orders
        const activeExisting = (existingOrders || []).filter(o =>
          o.data_quality_status !== 'quarantined' &&
          o.order_type === 'subscription' &&
          o.source_type === 'subscription_fulfillment'
        );

        let operationalOrderId = null;

        if (activeExisting.length > 0) {
          // Reuse existing canonical subscription operational order — patch in any new data from CA
          operationalOrderId = activeExisting[0].id;
          console.log(`[RECEIVE-CUSTOMER-EVENT] Deduped: using existing subscription operational order ${operationalOrderId} for sub=${data.stripe_subscription_id}`);

          // Patch address + items if CA now provides them and they were previously blank
          const existing = activeExisting[0];
          const patch = {};
          if (!existing.address_line1 && (data.address_line1 || addr.street)) {
            patch.address_line1 = data.address_line1 || addr.street || '';
            patch.address_line2 = data.address_line2 || addr.apt || '';
            patch.address_city = data.address_city || addr.city || '';
            patch.address_state = data.address_state || addr.state || '';
            patch.address_postal_code = data.address_postal_code || addr.postal_code || '';
          }
          if (fulfillmentItems.length > 0 && (!existing.line_items || existing.line_items.length === 0)) {
            patch.line_items = fulfillmentItems;
          }
          if (data.customer_app_subscription_id && !existing.customer_app_subscription_id) {
            patch.customer_app_subscription_id = data.customer_app_subscription_id;
          }
          if (Object.keys(patch).length > 0) {
            await base44.asServiceRole.entities.ShopifyOrder.update(operationalOrderId, patch);
            console.log(`[RECEIVE-CUSTOMER-EVENT] Patched existing order ${operationalOrderId} with:`, Object.keys(patch));
          }
        } else {
          // Create subscription operational ShopifyOrder (not a customer-facing one-time order)
          const operationalOrder = await base44.asServiceRole.entities.ShopifyOrder.create({
            shopify_order_id: `sub_operational_${data.stripe_subscription_id}`,
            shopify_order_number: `#SUB-${data.stripe_subscription_id.slice(-10)}`,
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
            customer_name: data.customer_name || '',
            customer_email: data.customer_email,
            customer_phone: data.phone || data.customer_phone || '',
            address_line1: data.address_line1 || '',
            address_line2: data.address_line2 || '',
            address_city: data.address_city || '',
            address_state: data.address_state || '',
            address_postal_code: data.address_postal_code || '',
            address_country: data.address_country || 'US',
            delivery_notes: data.delivery_notes || '',
            customer_notes: `Subscription: ${data.stripe_subscription_id} | Plan: ${data.plan_name || 'N/A'} | Cadence: ${data.cadence || 'N/A'}`,
            line_items: fulfillmentItems,
            fulfillments: [
              {
                fulfillment_number: 1,
                production_date: productionDate,
                delivery_date: data.first_delivery_date,
                items: fulfillmentItems,
                status: 'pending',
                address_line1: data.address_line1 || '',
                address_line2: data.address_line2 || '',
                address_city: data.address_city || '',
                address_state: data.address_state || '',
                address_postal_code: data.address_postal_code || '',
                address_country: data.address_country || 'US',
                delivery_notes: data.delivery_notes || '',
              },
            ],
            assigned_delivery_date: data.first_delivery_date,
            delivery_window_label: data.delivery_window_label || '5 PM – 8 PM',
            total_price: 0,
            subtotal: 0,
            stripe_subscription_id: data.stripe_subscription_id,
            customer_order_date: new Date().toISOString(),
          });

          operationalOrderId = operationalOrder.id;
          console.log(`[RECEIVE-CUSTOMER-EVENT] Created subscription operational order ${operationalOrderId}`);
        }

        // ── FULFILLMENT TASK DEDUPE ──────────────────────────────────────────────
        // Dedupe on: stripe_subscription_id + fulfillment_number=1 + scheduled_date (+ optional customer_app_subscription_id)
        const existingTasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
          stripe_subscription_id: data.stripe_subscription_id,
        });

        let matchingTask = null;
        if (existingTasks && existingTasks.length > 0) {
          matchingTask = existingTasks.find(t => {
            const sameDate = t.scheduled_date === data.first_delivery_date;
            const sameFulfillment = (t.fulfillment_number === 1 || t.fulfillment_number === 1.0);
            const sameCASubId = !data.customer_app_subscription_id ||
              !t.customer_app_subscription_id ||
              t.customer_app_subscription_id === data.customer_app_subscription_id;
            const notRetired = !(t.notes && t.notes.includes('RETIRED'));
            return sameDate && sameFulfillment && sameCASubId && notRetired;
          });
        }

        if (matchingTask) {
          // Patch items_summary if it was blank
          if (!matchingTask.items_summary && itemsSummary) {
            await base44.asServiceRole.entities.FulfillmentTask.update(matchingTask.id, { items_summary: itemsSummary });
            console.log(`[RECEIVE-CUSTOMER-EVENT] Patched blank items_summary on existing task ${matchingTask.id}`);
          }
          console.log(`[RECEIVE-CUSTOMER-EVENT] FulfillmentTask already exists for ${data.stripe_subscription_id} — deduping on task ${matchingTask.id}`);
          return Response.json({
            status: 'success',
            action: 'dedupe_existing',
            fulfillment_task_id: matchingTask.id,
            operational_order_id: operationalOrderId,
            note: 'Subscription operational order and FulfillmentTask already exist — idempotent dedupe'
          }, { status: 200 });
        }

        // Create FulfillmentTask linked to the operational order
        const createdTask = await base44.asServiceRole.entities.FulfillmentTask.create({
          customer_name: data.customer_name || '',
          customer_email: data.customer_email,
          phone: data.phone || data.customer_phone || '',
          fulfillment_type: 'Delivery',
          status: 'Scheduled',
          scheduled_date: data.first_delivery_date,
          delivery_address: deliveryAddress,
          address_line1: data.address_line1 || '',
          address_city: data.address_city || '',
          address_state: data.address_state || '',
          address_postal_code: data.address_postal_code || '',
          time_window: data.delivery_window_label || '5 PM – 8 PM',
          delivery_window_label: data.delivery_window_label || '5 PM – 8 PM',
          items_summary: itemsSummary,
          order_id: operationalOrderId, // Link to the subscription operational order
          source_type: 'subscription_fulfillment',
          stripe_subscription_id: data.stripe_subscription_id,
          customer_app_subscription_id: data.customer_app_subscription_id || null,
          payment_status: 'paid',
          fulfillment_number: 1,
          plan_id: data.plan_id || null,
          plan_name: data.plan_name || null,
          cadence: data.cadence || null,
          notes: [
            `Subscription: ${data.stripe_subscription_id}`,
            data.customer_app_subscription_id ? `CA Sub ID: ${data.customer_app_subscription_id}` : null,
            data.plan_name ? `Plan: ${data.plan_name}` : null,
            data.cadence ? `Cadence: ${data.cadence}` : null,
            `Fulfillment #1`,
            `Payment Status: paid`
          ].filter(Boolean).join(' | '),
        });

        console.log(`[RECEIVE-CUSTOMER-EVENT] Created subscription FulfillmentTask ${createdTask.id} linked to order ${operationalOrderId}`);

        return Response.json({
          status: 'success',
          action: 'created',
          event,
          operational_order_id: operationalOrderId,
          fulfillment_task_id: createdTask.id,
          fulfillment_details: {
            customer_name: data.customer_name,
            customer_email: data.customer_email,
            scheduled_date: data.first_delivery_date,
            production_date: productionDate,
            items: itemsSummary,
            stripe_subscription_id: data.stripe_subscription_id,
            fulfillment_number: 1,
            payment_status: 'paid',
          },
        }, { status: 200 });

      } catch (err) {
        console.error(`[RECEIVE-CUSTOMER-EVENT] Failed to create subscription fulfillment: ${err.message}`);
        return Response.json({
          status: 'error',
          event,
          error: err.message,
          customer_email: data.customer_email,
        }, { status: 500 });
      }
    }

    // ── order.adjustment_preflight ───────────────────────────────────────────
    // Read-only eligibility check immediately before the customer workflow moves
    // money or records schedule changes. The selected event repeats every check.
    if (event === 'order.adjustment_preflight') {
      const plan = validateAdjustmentPlan(data, { requireRefundConfirmation: false });
      if (plan.error) return Response.json({ error: plan.error }, { status: 400 });
      const context = await loadEligibleAdjustmentContext(base44, plan);
      if (context.error) return Response.json({ error: context.error }, { status: context.status });
      return Response.json({
        status: 'success',
        action: 'preflight_passed',
        order_id: context.order.id,
      });
    }

    // ── order.adjustment_selected ────────────────────────────────────────────
    // Customer-confirmed, order-specific schedule/split/refund adjustment.
    // This event is idempotent by request_id and never changes original line_items.
    if (event === 'order.adjustment_selected') {
      const plan = validateAdjustmentPlan(data);
      if (plan.error) return Response.json({ error: plan.error }, { status: 400 });

      const priorLogs = await base44.asServiceRole.entities.OrderSyncLog.filter({
        sync_source: 'customer_app',
        event_type: 'order.adjustment_selected',
        stripe_event_id: plan.requestId,
        success: true,
      });
      if (priorLogs?.length > 0) {
        return Response.json({ status: 'success', action: 'skipped', reason: 'duplicate_adjustment_request' });
      }

      const context = await loadEligibleAdjustmentContext(base44, plan);
      if (context.error) return Response.json({ error: context.error }, { status: context.status });
      const order = context.order;

      const fulfillments = plan.fulfillments.map((fulfillment) => ({
        ...fulfillment,
        address_line1: order.address_line1 || '',
        address_line2: order.address_line2 || '',
        address_city: order.address_city || '',
        address_state: order.address_state || '',
        address_postal_code: order.address_postal_code || '',
        address_country: order.address_country || 'US',
        delivery_notes: order.delivery_notes || '',
      }));
      plan.fulfillments = fulfillments;
      const first = fulfillments[0];
      const refundPatch = plan.choice === 'oasis_refund' ? {
        refund_status: 'partially_refunded',
        refund_type: 'partial',
        refund_amount: Number(data.refund.amount),
        refund_currency: safeText(data.refund.currency, 10).toUpperCase() || 'USD',
        refunded_at: new Date().toISOString(),
        refund_source: 'customer_app_adjustment',
        refund_event_id: plan.requestId,
        stripe_refund_id: safeText(data.refund.stripe_refund_id, 180),
        refund_reason: 'Customer requested refund for the OASIS portion only.',
      } : {};
      const internalNotes = [
        safeText(order.internal_notes, 1000),
        `Customer adjustment ${plan.requestId}: ${plan.choice}`,
      ].filter(Boolean).join('\n').slice(0, 2000);
      const safeResult = await base44.asServiceRole.functions.invoke('safeSyncOrderUpdate', {
        incomingData: {
          assigned_delivery_date: first.delivery_date,
          selected_delivery_date: first.delivery_date,
          production_date: first.production_date,
          fulfillment_mode: fulfillments.length > 1 ? 'multi_delivery' : 'single_delivery',
          fulfillments,
          schedule_source: 'customer_order_adjustment',
          internal_notes: internalNotes,
          sync_status: 'synced',
          last_sync_at: new Date().toISOString(),
          ...refundPatch,
        },
        source: 'customer_app_adjustment',
        stripeEventId: plan.requestId,
        matchBy: { internal_id: order.id },
        _internalSecret: internalSecret,
      });
      const safeData = safeResult?.data || safeResult || {};
      if (!['success', 'skipped'].includes(safeData.status)) {
        return Response.json({ error: 'safe_order_update_failed' }, { status: 503 });
      }

      let taskIds;
      let batchResult;
      try {
        taskIds = await reconcileAdjustmentTasks(base44, { ...order, ...refundPatch }, plan);
        batchResult = await reconcileAdjustmentBatchDemand(base44, order, plan);
      } catch (error) {
        await base44.asServiceRole.entities.OrderSyncLog.create({
          sync_timestamp: new Date().toISOString(),
          sync_source: 'customer_app',
          event_type: 'order.adjustment_selected',
          stripe_event_id: plan.requestId,
          order_id: order.id,
          order_number: order.shopify_order_number,
          action: 'error',
          reason: safeText(error?.message || 'adjustment_reconciliation_failed', 180),
          fields_updated: ['ShopifyOrder'],
          success: false,
          error: 'Operational task or batch reconciliation requires retry.',
        });
        return Response.json({ error: 'adjustment_reconciliation_failed', retryable: true }, { status: 503 });
      }

      await base44.asServiceRole.entities.OrderSyncLog.create({
        sync_timestamp: new Date().toISOString(),
        sync_source: 'customer_app',
        event_type: 'order.adjustment_selected',
        stripe_event_id: plan.requestId,
        order_id: order.id,
        order_number: order.shopify_order_number,
        action: 'updated',
        reason: `Applied customer-confirmed ${plan.choice} fulfillment plan.`,
        fields_updated: ['assigned_delivery_date', 'selected_delivery_date', 'production_date', 'fulfillment_mode', 'fulfillments', 'FulfillmentTask', 'ProductionBatch'],
        success: true,
      });
      return Response.json({
        status: 'success',
        action: 'updated',
        order_id: order.id,
        task_count: taskIds.length,
        batch_result: {
          created: Number(batchResult.created || 0),
          updated: Number(batchResult.updated || 0),
          deduped: Number(batchResult.deduped || 0),
          errors: Number(batchResult.errors || 0),
        },
      });
    }

    // ── order.created / order.paid ───────────────────────────────────────────
    // Customer App pushes paid orders via syncOrderToHub using event=order.created
    // Route directly into safeSyncOrderUpdate — same logic as ingestCustomerAppOrder
    if (event === 'order.created' || event === 'order.paid') {
      // Support both body.order and body.data as the order payload container
      const orderData = body.order || body.data || {};

      // Validate minimum required fields
      const errors = [];
      if (!orderData.order_number) errors.push('order_number required');
      if (!orderData.customer_email) errors.push('customer_email required');
      // Accept line_items OR items (CA sends either field name)
      const resolvedLineItems = (orderData.line_items && orderData.line_items.length > 0)
        ? orderData.line_items
        : (orderData.items && orderData.items.length > 0 ? orderData.items : []);
      if (resolvedLineItems.length === 0) errors.push('line_items required (non-empty array)');
      const resolvedTotal = orderData.total_price || orderData.total || 0;
      if (!resolvedTotal || resolvedTotal <= 0) errors.push('total_price required (> 0)');
      if (orderData.payment_status !== 'paid') errors.push('payment_status must be "paid"');
      const hasStripeId = orderData.stripe_checkout_session_id || orderData.stripe_payment_intent_id || orderData.order_intent_id;
      if (!hasStripeId) errors.push('At least one of stripe_checkout_session_id, stripe_payment_intent_id, or order_intent_id required');

      if (errors.length > 0) {
        console.warn('[RECEIVE-CUSTOMER-EVENT] order.created validation failed:', errors);
        return Response.json({ status: 'rejected', reason: 'validation_failed', errors }, { status: 400 });
      }

      // Resolve delivery/production dates from multiple possible field names
      const resolvedDeliveryDate = orderData.assigned_delivery_date || orderData.selected_delivery_date || orderData.delivery_date || null;
      const resolvedProductionDate = orderData.production_date || orderData.assigned_production_day || null;

      // Build fulfillments array so production_date is available to FulfillmentTask auto-create
      // and to recalculateProductionBatches. Items are decomposed items if provided, else line_items.
      const resolvedFulfillmentItems = (orderData.fulfillment_items && orderData.fulfillment_items.length > 0)
        ? orderData.fulfillment_items
        : resolvedLineItems.map(i => ({ title: i.title || i.product_name, quantity: i.quantity, price: i.price || 0 }));

      const incomingFulfillments = (resolvedDeliveryDate && resolvedProductionDate) ? [{
        fulfillment_number: 1,
        production_date: resolvedProductionDate,
        delivery_date: resolvedDeliveryDate,
        items: resolvedFulfillmentItems,
        status: 'pending',
        address_line1: orderData.address_line1 || '',
        address_line2: orderData.address_line2 || '',
        address_city: orderData.address_city || '',
        address_state: orderData.address_state || '',
        address_postal_code: orderData.address_postal_code || '',
        address_country: orderData.address_country || 'US',
        delivery_notes: orderData.delivery_notes || '',
      }] : [];

      const incomingData = {
        shopify_order_number: orderData.order_number,
        customer_name: orderData.customer_name || '',
        customer_email: orderData.customer_email,
        customer_phone: orderData.customer_phone || '',
        address_line1: orderData.address_line1 || '',
        address_line2: orderData.address_line2 || '',
        address_city: orderData.address_city || '',
        address_state: orderData.address_state || '',
        address_postal_code: orderData.address_postal_code || '',
        address_country: orderData.address_country || 'US',
        line_items: resolvedLineItems,
        total_price: resolvedTotal,
        subtotal: orderData.subtotal || resolvedTotal,
        delivery_fee: orderData.delivery_fee || 0,
        payment_status: 'paid',
        fulfillment_method: orderData.fulfillment_method || 'delivery',
        fulfillment_mode: 'single_delivery',
        order_type: 'one_time',
        delivery_notes: orderData.delivery_notes || '',
        customer_notes: orderData.customer_notes || '',
        requested_delivery_date: orderData.requested_delivery_date || resolvedDeliveryDate || '',
        selected_delivery_date: orderData.selected_delivery_date || resolvedDeliveryDate || null,
        assigned_delivery_date: resolvedDeliveryDate,
        delivery_window_label: orderData.delivery_window_label || '5:00 PM – 8:00 PM',
        // ── Phase 5 schedule fields ──────────────────────────────────────
        production_date: resolvedProductionDate,
        schedule_source: orderData.final_schedule_source || orderData.schedule_source || null,
        schedule_reason: orderData.schedule_reason || null,
        schedule_timezone: orderData.schedule_timezone || null,
        cutoff_window_label: orderData.cutoff_window_label || null,
        // ── Fulfillments array (ensures production_date available for auto-task) ──
        ...(incomingFulfillments.length > 0 ? { fulfillments: incomingFulfillments } : {}),
        stripe_checkout_session_id: orderData.stripe_checkout_session_id || null,
        stripe_payment_intent_id: orderData.stripe_payment_intent_id || null,
        stripe_customer_id: orderData.stripe_customer_id || null,
        source_channel: 'online',
        source_type: orderData.stripe_checkout_session_id ? 'stripe_checkout' : orderData.stripe_payment_intent_id ? 'stripe_payment_intent' : 'customer_app',
        sync_status: 'synced',
        last_sync_at: new Date().toISOString(),
        customer_order_date: orderData.created_at || new Date().toISOString(),
        production_status: 'awaiting_production',
        order_lock_status: 'verified',
        data_quality_status: 'complete',
      };

      // Auto-generate shopify_order_id
      if (orderData.stripe_checkout_session_id) {
        incomingData.shopify_order_id = `stripe_checkout:${orderData.stripe_checkout_session_id}`;
      } else if (orderData.stripe_payment_intent_id) {
        incomingData.shopify_order_id = `stripe_payment_intent:${orderData.stripe_payment_intent_id}`;
      } else {
        incomingData.shopify_order_id = `customer_app:${orderData.order_number}`;
      }

      const matchBy = {};
      if (orderData.stripe_checkout_session_id) matchBy.stripe_checkout_session_id = orderData.stripe_checkout_session_id;
      if (orderData.stripe_payment_intent_id) matchBy.stripe_payment_intent_id = orderData.stripe_payment_intent_id;
      if (orderData.order_intent_id) matchBy.order_intent_id = orderData.order_intent_id;
      matchBy.shopify_order_number = orderData.order_number;

      console.log('[RECEIVE-CUSTOMER-EVENT] Routing order.created to safeSyncOrderUpdate:', {
        order_number: orderData.order_number,
        stripe_payment_intent_id: orderData.stripe_payment_intent_id,
        stripe_checkout_session_id: orderData.stripe_checkout_session_id,
        customer_email: orderData.customer_email,
      });

      const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');
      const safeResult = await base44.asServiceRole.functions.invoke('safeSyncOrderUpdate', {
        incomingData,
        source: 'customer_app',
        stripeEventId: orderData.stripe_checkout_session_id || orderData.stripe_payment_intent_id || null,
        matchBy,
        _internalSecret: internalSecret,
      });

      const { status: safeStatus, action, order_id } = safeResult?.data || {};
      console.log('[RECEIVE-CUSTOMER-EVENT] safeSyncOrderUpdate result:', { status: safeStatus, action, order_id });

      if (safeStatus === 'success') {
        const loyaltyResult = await processOrderLoyalty(base44, order_id);
        // ── CREATE FULFILLMENT TASK FOR ONE-TIME ORDERS ──────────────────────
        // After ShopifyOrder is created, immediately create a FulfillmentTask so
        // the delivery appears in Driver Portal. Prevents the gap seen in NV-MOYUAVYB.
        let taskCreated = false;
        if (order_id) {
          try {
            // Fetch the newly created order to get all schedule details
            const createdOrder = await base44.asServiceRole.entities.ShopifyOrder.filter({ id: order_id });
            const order = createdOrder?.[0];
            if (order && order.order_type === 'one_time' && !order.stripe_subscription_id) {
              // Resolve delivery date priority: assigned_delivery_date > selected_delivery_date > fulfillments[0].delivery_date
              const scheduledDate = order.assigned_delivery_date ||
                order.selected_delivery_date ||
                (order.fulfillments?.[0]?.delivery_date) ||
                null;
              const productionDate = order.fulfillments?.[0]?.production_date || null;
              const windowLabel = order.delivery_window_label || '5:00 PM – 8:00 PM';

              // Only create FulfillmentTask if we have a valid delivery date and it's a valid day (Wed/Sat)
              if (scheduledDate) {
                const dow = new Date(scheduledDate + 'T00:00:00').getDay();
                const isValidDeliveryDay = [3, 6].includes(dow); // Wed=3, Sat=6

                // Guard: don't create for cancelled, refunded, or quarantined orders
                const isExcluded = order.payment_status === 'refunded' ||
                  order.production_status === 'canceled' ||
                  order.production_status === 'cancelled' ||
                  order.data_quality_status === 'quarantined' ||
                  (Array.isArray(order.tags) && order.tags.includes('do_not_sync'));

                if (isValidDeliveryDay && !isExcluded) {
                  // Check for existing FulfillmentTask to avoid duplicates
                  const existingTasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
                    order_id: order_id,
                  });
                  if (!existingTasks || existingTasks.length === 0) {
                    // Create the FulfillmentTask
                    await base44.asServiceRole.entities.FulfillmentTask.create({
                      customer_name: order.customer_name || '',
                      customer_email: order.customer_email,
                      phone: order.customer_phone || '',
                      fulfillment_type: 'Delivery',
                      status: 'Scheduled',
                      scheduled_date: scheduledDate,
                      delivery_address: [
                        order.address_line1,
                        order.address_line2,
                        order.address_city,
                        order.address_state,
                        order.address_postal_code
                      ].filter(Boolean).join(', ') || '',
                      address_line1: order.address_line1 || '',
                      address_city: order.address_city || '',
                      address_state: order.address_state || '',
                      address_postal_code: order.address_postal_code || '',
                      time_window: windowLabel,
                      delivery_window_label: windowLabel,
                      items_summary: (order.fulfillments?.[0]?.items || [])
                        .map(i => `${i.quantity}x ${i.title}`)
                        .join(', ') || '',
                      order_id: order_id,
                      order_number: order.shopify_order_number,
                      source_type: 'order_derived',
                      production_date: productionDate,
                      notes: `One-time order auto-fulfillment task created from ${order.source_type || 'stripe'} checkout`,
                    });
                    taskCreated = true;
                    console.log(`[RECEIVE-CUSTOMER-EVENT] Created FulfillmentTask for one-time order ${order.shopify_order_number}`);

                    // ── AUTO-GENERATE PRODUCTION BATCH DEMAND (non-blocking, idempotent) ──
                    if (productionDate) {
                      try {
                        const internalSecretVal = Deno.env.get('INTERNAL_FUNCTION_SECRET');
                        const batchRes = await base44.asServiceRole.functions.invoke('triggerBatchDemandForDates', {
                          _internalSecret: internalSecretVal,
                          production_dates: [productionDate],
                          order_id: order_id,
                          order_number: order.shopify_order_number || '',
                          customer_email: order.customer_email || '',
                          customer_name: order.customer_name || '',
                          fulfillments: [{
                            production_date: productionDate,
                            items: (order.fulfillments?.[0]?.items || order.line_items || [])
                              .map(i => ({ title: i.title || i.product_name, quantity: i.quantity })),
                          }],
                        });
                        console.log(`[RECEIVE-CUSTOMER-EVENT] Batch demand for ${order.shopify_order_number}: created=${batchRes?.data?.created} updated=${batchRes?.data?.updated}`);
                      } catch (batchErr) {
                        console.error(`[RECEIVE-CUSTOMER-EVENT] ⚠ OPERATIONAL WARNING: Batch demand failed (non-critical): ${batchErr.message}`);
                      }
                    }
                  }
                }
              }
            }
          } catch (err) {
            console.warn(`[RECEIVE-CUSTOMER-EVENT] FulfillmentTask creation failed (non-critical): ${err.message}`);
            // Don't fail the order creation if task creation fails — order is already in DB
          }
        }

        return Response.json({
          status: 'success',
          action: action || 'created',
          hub_order_id: order_id,
          order_id,
          order_number: orderData.order_number,
          fulfillment_task_created: taskCreated,
          loyalty: loyaltyResult,
        }, { status: 200 });
      } else if (safeStatus === 'skipped') {
        // Dedupe — order already exists, find its hub_order_id
        let existingId = order_id;
        if (!existingId) {
          const found = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_number: orderData.order_number });
          existingId = found?.[0]?.id || null;
        }
        const loyaltyResult = await processOrderLoyalty(base44, existingId);
        return Response.json({
          status: 'success',
          action: 'dedupe_exact_match',
          hub_order_id: existingId,
          order_id: existingId,
          order_number: orderData.order_number,
          reason: 'Idempotent duplicate — order already exists in Hub',
          loyalty: loyaltyResult,
        }, { status: 200 });
      } else if (safeStatus === 'rejected') {
        return Response.json({
          status: 'rejected',
          action: 'rejected',
          reason: safeResult?.data?.reason || 'unknown_rejection',
          order_number: orderData.order_number,
        }, { status: 422 });
      } else {
        return Response.json({
          status: 'error',
          action: 'error',
          reason: 'gateway_error',
          order_number: orderData.order_number,
        }, { status: 500 });
      }
    }

    // ── customer.subscription_future_cancel / customer.subscription_future_pause ──
    // POLICY: Customer self-service future cancel or pause.
    // Current paid cycle is LOCKED and PRESERVED. No FulfillmentTask cancellation.
    // No ProductionBatch removal. No loyalty reversal.
    // Routes to handleSubscriptionFutureCancel which sets cancel_at_period_end on Stripe + Hub metadata only.
    if (event === 'customer.subscription_future_cancel' || event === 'customer.subscription_future_pause') {
      const cancel_type = event === 'customer.subscription_future_cancel' ? 'future_cancel' : 'future_pause';

      if (!data?.customer_email) {
        return Response.json({ error: 'Missing customer_email' }, { status: 400 });
      }
      const subId = data.stripe_subscription_id || body.stripe_subscription_id;
      const caSubId = data.customer_app_subscription_id || body.customer_app_subscription_id;
      if (!subId && !caSubId) {
        return Response.json({ error: 'stripe_subscription_id or customer_app_subscription_id required' }, { status: 400 });
      }

      console.log(`[RECEIVE-CUSTOMER-EVENT] Routing ${event} to handleSubscriptionFutureCancel (NO CASCADE — current cycle preserved)`);

      const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');
      // Call handleSubscriptionFutureCancel internally via service role
      const futureCancelResult = await base44.asServiceRole.functions.invoke('handleSubscriptionFutureCancel', {
        stripe_subscription_id: subId || null,
        customer_app_subscription_id: caSubId || null,
        customer_email: data.customer_email,
        cancel_type,
        effective_date: data.effective_date || null,
        reason: data.reason || null,
        _internalSecret: internalSecret,
      });

      return Response.json({
        status: 'success',
        event,
        cancel_type,
        ...(futureCancelResult?.data || {}),
      }, { status: 200 });
    }

    // ── customer.subscription_cancelled ──────────────────────────────────────────
    // Customer App sends this when a subscription is refunded/cancelled in Stripe.
    // Triggers the same full cancellation cascade as order.refunded.
    // Accepts identifiers at top level OR inside data{} — both are checked.
    // Lookup priority: stripe_subscription_id → customer_app_subscription_id → stripe_payment_intent_id → order_number
    // Idempotent: processStripeRefund checks OrderSyncLog for stripe_event_id.
    if (event === 'customer.subscription_cancelled') {
      // Accept fields from both top-level body AND nested data{}
      // Normalize payment_intent_id → stripe_payment_intent_id (CA sends either name)
      const subId = data?.stripe_subscription_id || body.stripe_subscription_id;
      const caSubId = data?.customer_app_subscription_id || body.customer_app_subscription_id || data?.subscription_id || body.subscription_id;
      const piId = data?.stripe_payment_intent_id || body.stripe_payment_intent_id || data?.payment_intent_id || body.payment_intent_id;
      const orderNum = data?.order_number || body.order_number;

      console.log(`[RECEIVE-CUSTOMER-EVENT] customer.subscription_cancelled: stripe_sub=${subId} ca_sub=${caSubId} pi=${piId} order_num=${orderNum}`);

      if (!subId && !caSubId && !piId && !orderNum) {
        return Response.json({ error: 'Missing at least one identifier: stripe_subscription_id, customer_app_subscription_id, stripe_payment_intent_id, or order_number' }, { status: 400 });
      }

      const isActive = (o) =>
        o.payment_status !== 'refunded' &&
        o.production_status !== 'canceled' &&
        o.production_status !== 'cancelled';

      // Priority 1: stripe_subscription_id
      let cancelOrder = null;
      if (subId) {
        const results = await base44.asServiceRole.entities.ShopifyOrder.filter({ stripe_subscription_id: subId });
        cancelOrder = (results || []).find(isActive) || null;
        console.log(`[RECEIVE-CUSTOMER-EVENT] Lookup by stripe_subscription_id=${subId}: found ${results?.length || 0}, active=${!!cancelOrder}`);
      }

      // Priority 2: customer_app_subscription_id
      if (!cancelOrder && caSubId) {
        const results = await base44.asServiceRole.entities.ShopifyOrder.filter({ customer_app_subscription_id: caSubId });
        cancelOrder = (results || []).find(isActive) || null;
        console.log(`[RECEIVE-CUSTOMER-EVENT] Lookup by customer_app_subscription_id=${caSubId}: found ${results?.length || 0}, active=${!!cancelOrder}`);
      }

      // Priority 3: stripe_payment_intent_id
      if (!cancelOrder && piId) {
        const results = await base44.asServiceRole.entities.ShopifyOrder.filter({ stripe_payment_intent_id: piId });
        cancelOrder = (results || []).find(isActive) || null;
        console.log(`[RECEIVE-CUSTOMER-EVENT] Lookup by stripe_payment_intent_id=${piId}: found ${results?.length || 0}, active=${!!cancelOrder}`);
      }

      // Priority 4: order_number
      if (!cancelOrder && orderNum) {
        const results = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_number: orderNum });
        cancelOrder = (results || []).find(isActive) || null;
        console.log(`[RECEIVE-CUSTOMER-EVENT] Lookup by order_number=${orderNum}: found ${results?.length || 0}, active=${!!cancelOrder}`);
      }

      if (!cancelOrder) {
        console.warn(`[RECEIVE-CUSTOMER-EVENT] customer.subscription_cancelled: no active Hub order found — may already be cancelled`);
        return Response.json({ status: 'acknowledged', event, note: 'No active Hub order found — may already be cancelled or never created' });
      }

      console.log(`[RECEIVE-CUSTOMER-EVENT] Found Hub order ${cancelOrder.shopify_order_number} (${cancelOrder.id}) — routing to processStripeRefund cascade`);

      const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');
      const refundResult = await base44.asServiceRole.functions.invoke('processStripeRefund', {
        stripe_charge_id: data.stripe_charge_id || body.stripe_charge_id || null,
        stripe_payment_intent_id: piId || cancelOrder.stripe_payment_intent_id || null,
        stripe_refund_id: data.stripe_refund_id || body.stripe_refund_id || null,
        stripe_event_id: data.stripe_event_id || body.stripe_event_id || `ca_sub_cancel_${subId || caSubId || piId}_${Date.now()}`,
        refund_amount: data.refund_amount || body.refund_amount || cancelOrder.total_price || 0,
        charge_amount: data.charge_amount || body.charge_amount || cancelOrder.total_price || 0,
        is_full_refund: data.is_full_refund !== undefined ? data.is_full_refund : body.is_full_refund !== undefined ? body.is_full_refund : true,
        manual_order_number: cancelOrder.shopify_order_number,
        _internalSecret: internalSecret,
      });

      const refundPayload = refundResult?.data || refundResult || {};
      const { status: refundStatus } = refundPayload;
      console.log(`[RECEIVE-CUSTOMER-EVENT] customer.subscription_cancelled cascade result: ${refundStatus}`);

      return Response.json({
        status: 'success',
        event,
        cascade: 'triggered',
        action: refundStatus === 'refund_processed' ? 'refund_processed' : refundStatus,
        refund_status: refundStatus,
        hub_order_id: refundPayload.order_id || cancelOrder.id,
        hub_order_number: cancelOrder.shopify_order_number,
        matched_by: subId ? 'stripe_subscription_id' : caSubId ? 'customer_app_subscription_id' : piId ? 'stripe_payment_intent_id' : 'order_number',
      }, { status: 200 });
    }

    // ── order.refunded ──────────────────────────────────────────────────────────
    // Customer App notifies Hub of full or partial refund
    if (event === 'order.refunded') {
      if (!data?.order_number && !data?.stripe_payment_intent_id) {
        return Response.json({ error: 'Missing order_number or stripe_payment_intent_id' }, { status: 400 });
      }

      console.log(`[RECEIVE-CUSTOMER-EVENT] Processing order.refunded: ${data.order_number}, refund_amount=$${data.refund_amount}`);

      // Route to processStripeRefund with CA-provided context
      const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');
      const refundResult = await base44.asServiceRole.functions.invoke('processStripeRefund', {
        stripe_charge_id: data.stripe_charge_id || data.refund_id || null,
        stripe_payment_intent_id: data.stripe_payment_intent_id || null,
        stripe_refund_id: data.stripe_refund_id || null,
        stripe_event_id: data.stripe_event_id || `ca_refund_${data.order_number}_${Date.now()}`,
        refund_amount: data.refund_amount || 0,
        charge_amount: data.charge_amount || data.total_price || 0,
        is_full_refund: data.is_full_refund === true || data.is_partial_refund === false,
        manual_order_number: data.order_number,
        _internalSecret: internalSecret,
      });

      const refundPayload = refundResult?.data || refundResult || {};
      const { status: refundStatus } = refundPayload;
      console.log(`[RECEIVE-CUSTOMER-EVENT] Refund cascade result: ${refundStatus}`);

      return Response.json({
        status: 'success',
        event,
        action: refundStatus === 'refund_processed' ? 'refund_processed' : refundStatus,
        refund_status: refundStatus,
        order_number: data.order_number,
        hub_order_id: refundPayload.order_id || null,
      }, { status: 200 });
    }

    // ── customer.onboarding_complete / order.status_updated / others ──────────
    // Acknowledge but no action — hub owns these states
    return Response.json({ status: 'acknowledged', event, note: 'Event received, no action required' });

  } catch (error) {
    console.error('[RECEIVE-CUSTOMER-EVENT] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
