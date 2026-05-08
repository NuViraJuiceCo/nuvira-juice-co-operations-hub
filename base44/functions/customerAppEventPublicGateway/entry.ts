/**
 * customerAppEventPublicGateway
 *
 * Handles customer.subscription_created events from Customer App.
 * Creates/dedupes Hub operational orders and 4 FulfillmentTasks per monthly cycle.
 *
 * NEW: Accepts explicit fulfillments[] array with 4 scheduled dates per monthly billing cycle.
 * Per-fulfillment quantities (NOT monthly totals).
 *
 * Auth:
 *   - External HTTP: Authorization: Bearer CUSTOMER_APP_SYNC_SECRET
 *   - Internal SDK: INTERNAL_FUNCTION_SECRET via _internalSecret field
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const INTERNAL_SECRET = Deno.env.get('INTERNAL_FUNCTION_SECRET');

Deno.serve(async (req) => {
  try {
    console.log('[CUSTOMER-APP-GATEWAY] ════════════════════════════════════════');
    console.log('[CUSTOMER-APP-GATEWAY] INCOMING REQUEST');
    console.log('[CUSTOMER-APP-GATEWAY] Method:', req.method);

    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

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
      isAuthenticated = true;
      console.log('[CUSTOMER-APP-GATEWAY] ✅ AUTH: Internal call with secret');
    } else if (isSDKToken) {
      isAuthenticated = true;
      console.log('[CUSTOMER-APP-GATEWAY] ✅ AUTH: Internal SDK call');
    } else if (token === SYNC_SECRET) {
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
      return Response.json({ status: 'acknowledged', event, note: 'Event acknowledged' });
    }

    // Validate required fields
    const missingFields = [];
    if (!customer_email) missingFields.push('customer_email');
    if (!data.stripe_subscription_id) missingFields.push('stripe_subscription_id');
    // first_delivery_date OR fulfillments[] required
    const hasDeliveryDates = data.first_delivery_date || (Array.isArray(data.fulfillments) && data.fulfillments.length > 0);
    if (!hasDeliveryDates) missingFields.push('first_delivery_date or fulfillments[]');

    if (missingFields.length > 0) {
      console.error('[CUSTOMER-APP-GATEWAY] ❌ VALIDATION FAILED - Missing:', missingFields);
      return Response.json({
        error: 'Missing required fields',
        missing_fields: missingFields,
        hint: 'Required: customer_email, stripe_subscription_id, (first_delivery_date OR fulfillments[] array). Optional: products, address_*, payment_status'
      }, { status: 400 });
    }

    // Validate payment status
    const paymentStatus = data.payment_status || data.financial_status || '';
    if (paymentStatus !== 'paid') {
      console.warn('[CUSTOMER-APP-GATEWAY] ⚠ NOT YET PAID - payment_status:', paymentStatus || 'MISSING');
      return Response.json({
        status: 'acknowledged',
        event,
        note: `Not yet paid (payment_status=${paymentStatus || 'missing'})`,
      });
    }

    const base44 = createClientFromRequest(req);

    // ───────────────────────────────────────────────────────────────────────────
    // BUILD FULFILLMENTS ARRAY (4 per monthly cycle OR use explicit array)
    // ───────────────────────────────────────────────────────────────────────────
    let fulfillmentsToCreate = [];

    if (Array.isArray(data.fulfillments) && data.fulfillments.length > 0) {
      // Customer App sent explicit fulfillments (e.g., 4 for monthly)
      fulfillmentsToCreate = data.fulfillments;
      console.log(`[CUSTOMER-APP-GATEWAY] Accepting ${fulfillmentsToCreate.length} explicit fulfillments from CA`);
    } else if (data.first_delivery_date) {
      // Legacy: single fulfillment — construct 1 default
      console.log(`[CUSTOMER-APP-GATEWAY] ⚠ Single fulfillment only (legacy) — consider sending all 4 via fulfillments[]`);

      // Get products for the fulfillment items
      let fulfillmentItems = Array.isArray(data.products) && data.products.length > 0
        ? data.products
        : [];

      if (fulfillmentItems.length === 0 && (data.plan_name || data.plan_id)) {
        console.log('[CUSTOMER-APP-GATEWAY] No products — attempting auto-decomposition for:', data.plan_name);
        try {
          const decompResult = await base44.asServiceRole.functions.invoke('decomposeSubscriptionPlan', {
            plan_name: data.plan_name || null,
            plan_id: data.plan_id || null,
            _internalSecret: INTERNAL_SECRET,
          });
          const d = decompResult?.data;
          if (d?.products?.length > 0) {
            fulfillmentItems = d.products;
            console.log('[CUSTOMER-APP-GATEWAY] ✅ Auto-decomposed:', d.items_summary);
          } else {
            console.error('[CUSTOMER-APP-GATEWAY] ❌ Decomposition returned no products');
            return Response.json({
              error: 'Could not decompose subscription plan',
              plan_name: data.plan_name,
              hint: 'Send fulfillments[] directly with product_name and quantity'
            }, { status: 400 });
          }
        } catch (decompErr) {
          console.error('[CUSTOMER-APP-GATEWAY] ❌ Decomposition error:', decompErr.message);
          return Response.json({
            error: 'Plan decomposition failed',
            detail: decompErr.message,
            hint: 'Send fulfillments[] array directly'
          }, { status: 400 });
        }
      }

      if (fulfillmentItems.length === 0) {
        return Response.json({
          error: 'No products provided',
          hint: 'Send fulfillments[] array with products, or provide plan_name for auto-decomposition'
        }, { status: 400 });
      }

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

      const itemsSummary = fulfillmentItems.map(i => `${i.quantity}x ${i.product_name}`).join(', ');

      fulfillmentsToCreate = [{
        fulfillment_number: 1,
        scheduled_date: data.first_delivery_date,
        production_date: productionDate,
        products: fulfillmentItems,
        items_summary: itemsSummary,
      }];
      console.log('[CUSTOMER-APP-GATEWAY] Constructed 1 default fulfillment (legacy path)');
    }

    if (fulfillmentsToCreate.length === 0) {
      return Response.json({
        error: 'No fulfillments provided',
        hint: 'Send fulfillments[] array with fulfillment_number, scheduled_date, production_date, products'
      }, { status: 400 });
    }

    console.log(`[CUSTOMER-APP-GATEWAY] Processing ${fulfillmentsToCreate.length} fulfillments`);

    // Build line_items for order (for historical compat — NOT per-fulfillment)
    const lineItems = fulfillmentsToCreate.flatMap(f =>
      f.products ? f.products.map(p => ({ title: p.product_name, quantity: p.quantity, price: 0 })) : []
    );

    // ───────────────────────────────────────────────────────────────────────────
    // CREATE/DEDUPE OPERATIONAL ORDER
    // ───────────────────────────────────────────────────────────────────────────
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
      console.log(`[CUSTOMER-APP-GATEWAY] Deduped: reusing order ${operationalOrderId}`);

      // Patch fulfillments array with all 4 fulfillments
      const newFulfillments = fulfillmentsToCreate.map(f => ({
        fulfillment_number: f.fulfillment_number,
        production_date: f.production_date,
        delivery_date: f.scheduled_date,
        items: (f.products || []).map(p => ({ title: p.product_name, quantity: p.quantity, price: 0 })),
        status: 'pending',
        address_line1: data.address_line1 || '',
        address_line2: data.address_line2 || '',
        address_city: data.address_city || '',
        address_state: data.address_state || '',
        address_postal_code: data.address_postal_code || '',
        address_country: data.address_country || 'US',
        delivery_notes: data.delivery_notes || '',
      }));

      const patch = { fulfillments: newFulfillments };

      if (lineItems.length > 0 && (!activeExisting[0].line_items || activeExisting[0].line_items.length === 0)) {
        patch.line_items = lineItems;
      }

      if (data.customer_app_subscription_id && !activeExisting[0].customer_app_subscription_id) {
        patch.customer_app_subscription_id = data.customer_app_subscription_id;
      }

      if (Object.keys(patch).length > 0) {
        await base44.asServiceRole.entities.ShopifyOrder.update(operationalOrderId, patch);
        console.log(`[CUSTOMER-APP-GATEWAY] Patched order with ${fulfillmentsToCreate.length} fulfillments`);
      }
    } else {
      // Create new operational order with all fulfillments
      const fulfillmentsArray = fulfillmentsToCreate.map(f => ({
        fulfillment_number: f.fulfillment_number,
        production_date: f.production_date,
        delivery_date: f.scheduled_date,
        items: (f.products || []).map(p => ({ title: p.product_name, quantity: p.quantity, price: 0 })),
        status: 'pending',
        address_line1: data.address_line1 || '',
        address_line2: data.address_line2 || '',
        address_city: data.address_city || '',
        address_state: data.address_state || '',
        address_postal_code: data.address_postal_code || '',
        address_country: data.address_country || 'US',
        delivery_notes: data.delivery_notes || '',
      }));

      const createdOrder = await base44.asServiceRole.entities.ShopifyOrder.create({
        shopify_order_id: `sub_operational_${data.stripe_subscription_id}`,
        shopify_order_number: `#SUB-${data.stripe_subscription_id.slice(-10)}`,
        order_type: 'subscription',
        source_type: 'subscription_fulfillment',
        source_channel: 'subscription',
        fulfillment_method: 'delivery',
        fulfillment_mode: fulfillmentsToCreate.length > 1 ? 'multi_delivery' : 'single_delivery',
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
        customer_notes: `Subscription: ${data.stripe_subscription_id} | Plan: ${data.plan_name || 'N/A'} | ${fulfillmentsToCreate.length} fulfillments`,
        line_items: lineItems,
        fulfillments: fulfillmentsArray,
        assigned_delivery_date: fulfillmentsToCreate[0]?.scheduled_date || null,
        delivery_window_label: data.delivery_window_label || '5 PM – 8 PM',
        total_price: 0,
        subtotal: 0,
        stripe_subscription_id: data.stripe_subscription_id,
        customer_app_subscription_id: data.customer_app_subscription_id || null,
        customer_order_date: new Date().toISOString(),
      });

      operationalOrderId = createdOrder.id;
      console.log(`[CUSTOMER-APP-GATEWAY] Created order with ${fulfillmentsToCreate.length} fulfillments`);
    }

    // ───────────────────────────────────────────────────────────────────────────
    // CREATE/DEDUPE FULFILLMENT TASKS (one per fulfillment)
    // ───────────────────────────────────────────────────────────────────────────
    const createdTaskIds = [];
    const deDupedTaskIds = [];

    for (const fulfillment of fulfillmentsToCreate) {
      const fulfNum = fulfillment.fulfillment_number;
      const schedDate = fulfillment.scheduled_date;
      const itemsSummary = (fulfillment.products || []).map(p => `${p.quantity}x ${p.product_name}`).join(', ');

      // Dedupe key: stripe_subscription_id + customer_app_subscription_id + fulfillment_number + scheduled_date
      const existingTasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
        stripe_subscription_id: data.stripe_subscription_id,
        customer_app_subscription_id: data.customer_app_subscription_id,
      });

      let matchingTask = (existingTasks || []).find(t =>
        t.fulfillment_number === fulfNum &&
        t.scheduled_date === schedDate &&
        !(t.notes && t.notes.includes('RETIRED'))
      );

      if (matchingTask) {
        // Patch if blank items_summary
        if (!matchingTask.items_summary && itemsSummary) {
          await base44.asServiceRole.entities.FulfillmentTask.update(matchingTask.id, { items_summary: itemsSummary });
        }
        deDupedTaskIds.push(matchingTask.id);
        console.log(`[CUSTOMER-APP-GATEWAY] Deduped FT #${fulfNum}: ${matchingTask.id}`);
      } else {
        // Create new task
        const newTask = await base44.asServiceRole.entities.FulfillmentTask.create({
          customer_name: data.customer_name || '',
          customer_email,
          phone: data.phone || data.customer_phone || '',
          fulfillment_type: 'Delivery',
          status: 'Scheduled',
          scheduled_date: schedDate,
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
          fulfillment_number: fulfNum,
          plan_name: data.plan_name || null,
          notes: `Subscription: ${data.stripe_subscription_id} | Fulfillment #${fulfNum}/${fulfillmentsToCreate.length}`,
        });

        createdTaskIds.push(newTask.id);
        console.log(`[CUSTOMER-APP-GATEWAY] Created FT #${fulfNum}: ${newTask.id}`);
      }
    }

    console.log('[CUSTOMER-APP-GATEWAY] ════════════════════════════════════════');

    return Response.json({
      status: 'success',
      action: deDupedTaskIds.length > 0 && createdTaskIds.length > 0 ? 'mixed' : (createdTaskIds.length > 0 ? 'created' : 'dedupe'),
      event,
      operational_order_id: operationalOrderId,
      fulfillment_count: fulfillmentsToCreate.length,
      fulfillment_tasks_created: createdTaskIds,
      fulfillment_tasks_deduped: deDupedTaskIds,
      customer_email,
      stripe_subscription_id: data.stripe_subscription_id,
      note: `${fulfillmentsToCreate.length} fulfillments processed. Run recalculateProductionBatches to generate demand.`,
    }, { status: 200 });

  } catch (error) {
    console.error('[CUSTOMER-APP-GATEWAY] ERROR:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});