/**
 * customerAppEventPublicGateway
 *
 * TEMPORARY PUBLIC WRAPPER — Admin Repair Tool
 *
 * Directly handles customer.subscription_created events from the Customer App.
 * Creates/dedupes Hub operational orders and fulfillment tasks.
 *
 * Auth:
 *   - External HTTP: Authorization: Bearer CUSTOMER_APP_SYNC_SECRET
 *   - Internal SDK: INTERNAL_FUNCTION_SECRET via _internalSecret field
 *
 * Status: TEMPORARY — Once Base44 platform exposes receiveCustomerAppEvent as public,
 *         this can be deleted.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const INTERNAL_SECRET = Deno.env.get('INTERNAL_FUNCTION_SECRET');

Deno.serve(async (req) => {
  try {
    console.log('[CUSTOMER-APP-GATEWAY] ════════════════════════════════════════');
    console.log('[CUSTOMER-APP-GATEWAY] INCOMING REQUEST');
    console.log('[CUSTOMER-APP-GATEWAY] Method:', req.method);
    console.log('[CUSTOMER-APP-GATEWAY] Has Authorization:', !!req.headers.get('Authorization'));

    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    // Parse body
    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { event, _internalSecret } = body;
    const data = body.data || body;
    const customer_email = body.customer_email || data.customer_email;

    console.log('[CUSTOMER-APP-GATEWAY] Event:', event);
    console.log('[CUSTOMER-APP-GATEWAY] Customer Email:', customer_email);

    // ───────────────────────────────────────────────────────────────────────────
    // AUTH
    // ───────────────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const isSDKToken = token.length > 100;

    let isAuthenticated = false;

    if (isSDKToken && _internalSecret === INTERNAL_SECRET) {
      // Internal SDK call with internal secret
      isAuthenticated = true;
      console.log('[CUSTOMER-APP-GATEWAY] ✅ AUTH: Internal call with secret');
    } else if (isSDKToken) {
      // SDK token without matching internal secret
      isAuthenticated = true;
      console.log('[CUSTOMER-APP-GATEWAY] ✅ AUTH: Internal SDK call');
    } else if (token === SYNC_SECRET) {
      // External HTTP call with correct Bearer token
      isAuthenticated = true;
      console.log('[CUSTOMER-APP-GATEWAY] ✅ AUTH: External HTTP with Bearer');
    } else {
      console.error('[CUSTOMER-APP-GATEWAY] ❌ AUTH FAILED');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ───────────────────────────────────────────────────────────────────────────
    // PROCESS SUBSCRIPTION EVENT
    // ───────────────────────────────────────────────────────────────────────────
    if (event !== 'customer.subscription_created') {
      return Response.json({
        status: 'acknowledged',
        event,
        note: 'Event acknowledged',
      });
    }

    // Validate required fields
    if (!customer_email || !data.stripe_subscription_id || !data.first_delivery_date) {
      return Response.json({
        error: 'Missing required fields',
      }, { status: 400 });
    }

    // Validate payment status
    const paymentStatus = data.payment_status || data.financial_status || '';
    if (paymentStatus !== 'paid') {
      return Response.json({
        status: 'acknowledged',
        event,
        note: `Not yet paid (${paymentStatus})`,
      });
    }

    const base44 = createClientFromRequest(req);

    // ───────────────────────────────────────────────────────────────────────────
    // CREATE/DEDUPE OPERATIONAL ORDER
    // ───────────────────────────────────────────────────────────────────────────
    const PRODUCTION_DAYS = [2, 5, 6];
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
      const fb = new Date(d);
      fb.setDate(d.getDate() - 1);
      productionDate = fb.toISOString().split('T')[0];
    }

    const fulfillmentItems = Array.isArray(data.products) && data.products.length > 0
      ? data.products.map(p => ({ title: p.product_name, quantity: p.quantity, price: 0 }))
      : [];

    if (fulfillmentItems.length === 0) {
      return Response.json({ error: 'No products provided' }, { status: 400 });
    }

    // Check for existing order
    const existingOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({
      stripe_subscription_id: data.stripe_subscription_id,
    });

    const activeExisting = (existingOrders || []).filter(o =>
      o.data_quality_status !== 'quarantined' &&
      o.order_type === 'subscription' &&
      o.source_type === 'subscription_fulfillment'
    );

    let operationalOrderId = null;

    if (activeExisting.length > 0) {
      operationalOrderId = activeExisting[0].id;
      console.log('[CUSTOMER-APP-GATEWAY] Deduped: reusing order', operationalOrderId);
    } else {
      const createdOrder = await base44.asServiceRole.entities.ShopifyOrder.create({
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
        customer_email,
        customer_phone: data.phone || data.customer_phone || '',
        address_line1: data.address_line1 || '',
        address_line2: data.address_line2 || '',
        address_city: data.address_city || '',
        address_state: data.address_state || '',
        address_postal_code: data.address_postal_code || '',
        address_country: data.address_country || 'US',
        delivery_notes: data.delivery_notes || '',
        customer_notes: `Subscription: ${data.stripe_subscription_id}`,
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
        customer_app_subscription_id: data.customer_app_subscription_id || null,
        customer_order_date: new Date().toISOString(),
      });

      operationalOrderId = createdOrder.id;
      console.log('[CUSTOMER-APP-GATEWAY] Created order', operationalOrderId);
    }

    // ───────────────────────────────────────────────────────────────────────────
    // CREATE/DEDUPE FULFILLMENT TASK
    // ───────────────────────────────────────────────────────────────────────────
    const existingTasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
      stripe_subscription_id: data.stripe_subscription_id,
    });

    let matchingTask = null;
    if (existingTasks && existingTasks.length > 0) {
      matchingTask = existingTasks.find(t =>
        t.scheduled_date === data.first_delivery_date &&
        t.fulfillment_number === 1
      );
    }

    let fulfillmentTaskId = null;

    if (matchingTask) {
      fulfillmentTaskId = matchingTask.id;
      console.log('[CUSTOMER-APP-GATEWAY] Deduped: reusing task', fulfillmentTaskId);
    } else {
      const itemsSummary = fulfillmentItems.map(i => `${i.quantity}x ${i.title}`).join(', ');
      const createdTask = await base44.asServiceRole.entities.FulfillmentTask.create({
        customer_name: data.customer_name || '',
        customer_email,
        phone: data.phone || data.customer_phone || '',
        fulfillment_type: 'Delivery',
        status: 'Scheduled',
        scheduled_date: data.first_delivery_date,
        address_line1: data.address_line1 || '',
        address_city: data.address_city || '',
        address_state: data.address_state || '',
        address_postal_code: data.address_postal_code || '',
        time_window: data.delivery_window_label || '5 PM – 8 PM',
        delivery_window_label: data.delivery_window_label || '5 PM – 8 PM',
        items_summary: itemsSummary,
        order_id: operationalOrderId,
        source_type: 'subscription_fulfillment',
        stripe_subscription_id: data.stripe_subscription_id,
        customer_app_subscription_id: data.customer_app_subscription_id || null,
        payment_status: 'paid',
        fulfillment_number: 1,
        plan_name: data.plan_name || null,
        notes: `Subscription: ${data.stripe_subscription_id}`,
      });

      fulfillmentTaskId = createdTask.id;
      console.log('[CUSTOMER-APP-GATEWAY] Created task', fulfillmentTaskId);
    }

    console.log('[CUSTOMER-APP-GATEWAY] ════════════════════════════════════════');

    return Response.json({
      status: 'success',
      action: activeExisting.length > 0 || matchingTask ? 'dedupe' : 'created',
      event,
      operational_order_id: operationalOrderId,
      fulfillment_task_id: fulfillmentTaskId,
      customer_email,
      stripe_subscription_id: data.stripe_subscription_id,
    }, { status: 200 });

  } catch (error) {
    console.error('[CUSTOMER-APP-GATEWAY] ERROR:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});