/**
 * customerAppEventPublicGateway
 *
 * Handles customer.subscription_created events from Customer App.
 * Creates/dedupes Hub operational orders and 4 FulfillmentTasks per monthly cycle.
 *
 * Auth:
 *   - External HTTP: Authorization: Bearer CUSTOMER_APP_SYNC_SECRET
 *   - Internal SDK: long JWT token (>100 chars) with optional _internalSecret
 *
 * All 403/401 responses include a structured reason_code body for CA retry diagnostics.
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
      return Response.json({ error: 'Invalid JSON', reason_code: 'INVALID_JSON' }, { status: 400 });
    }

    const { event, _internalSecret } = body;
    const data = body.data || body;
    const customer_email = body.customer_email || data.customer_email;
    const stripe_subscription_id = body.stripe_subscription_id || data.stripe_subscription_id;
    const normalizedScheduleSource = normalizeSubscriptionScheduleSource(data.final_schedule_source);

    // ── Sanitized diagnostic logging (no secrets) ──────────────────────────────
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const hasAuthorizationHeader = !!authHeader;
    const tokenLength = token.length;
    const isSDKToken = tokenLength > 100;
    const isExternalBearer = !isSDKToken && token.length > 0;
    const hasInternalSecret = !!_internalSecret;

    console.log('[CUSTOMER-APP-GATEWAY] DIAGNOSTIC:', JSON.stringify({
      event,
      hasAuthorizationHeader,
      tokenLength,
      isSDKToken,
      isExternalBearer,
      hasInternalSecret,
      customer_email: customer_email || null,
      stripe_subscription_id: stripe_subscription_id || null,
      hasData: !!body.data,
      hasFulfillments: Array.isArray(data?.fulfillments),
      fulfillmentCount: Array.isArray(data?.fulfillments) ? data.fulfillments.length : 0,
      payloadShape: Object.keys(body).join(','),
    }));

    // ───────────────────────────────────────────────────────────────────────────
    // AUTH — structured 403 with reason_code for CA retry diagnostics
    // ───────────────────────────────────────────────────────────────────────────
    let isAuthenticated = false;
    let authResult = 'FAILED';

    if (!hasAuthorizationHeader) {
      authResult = 'MISSING_AUTH';
    } else if (isSDKToken && _internalSecret === INTERNAL_SECRET) {
      isAuthenticated = true;
      authResult = 'INTERNAL_SECRET';
    } else if (isSDKToken) {
      isAuthenticated = true;
      authResult = 'INTERNAL_SDK';
    } else if (token === SYNC_SECRET) {
      isAuthenticated = true;
      authResult = 'EXTERNAL_BEARER';
    } else if (!isSDKToken && !isExternalBearer) {
      authResult = 'MISSING_AUTH';
    } else if (isExternalBearer && token !== SYNC_SECRET) {
      authResult = 'INVALID_TOKEN';
    } else {
      authResult = 'INTERNAL_AUTH_FAILURE';
    }

    console.log('[CUSTOMER-APP-GATEWAY] AUTH RESULT:', authResult, isAuthenticated ? '✅' : '❌');

    if (!isAuthenticated) {
      const reason_code = authResult; // MISSING_AUTH | INVALID_TOKEN | INTERNAL_AUTH_FAILURE
      console.error(`[CUSTOMER-APP-GATEWAY] ❌ AUTH FAILED — reason_code: ${reason_code} | tokenLength: ${tokenLength} | isSDKToken: ${isSDKToken} | isExternalBearer: ${isExternalBearer}`);
      return Response.json({
        status: 'error',
        reason_code,
        message: reason_code === 'MISSING_AUTH'
          ? 'Authorization header is missing. Send: Authorization: Bearer <CUSTOMER_APP_SYNC_SECRET>'
          : reason_code === 'INVALID_TOKEN'
          ? 'Authorization token does not match the expected CUSTOMER_APP_SYNC_SECRET. Verify the secret is correct and not expired.'
          : 'Authentication failed due to an internal error. Check token format and retry.',
        event_received: event || null,
        stripe_subscription_id: stripe_subscription_id || null,
        hint: 'Use Authorization: Bearer <CUSTOMER_APP_SYNC_SECRET> for external HTTP calls.',
      }, { status: 403 });
    }

    // ───────────────────────────────────────────────────────────────────────────
    // PROCESS SUBSCRIPTION EVENT
    // ───────────────────────────────────────────────────────────────────────────
    if (event !== 'customer.subscription_created') {
      return Response.json({ status: 'acknowledged', event, note: 'Event acknowledged' });
    }

    // ── Phase 5: Schedule validation helpers ────────────────────────────────
    const VALID_PROD_DAYS = new Set([2, 5]); // Tue, Fri
    const VALID_DELIV_DAYS = new Set([3, 6]); // Wed, Sat
    const WIN_WED = '5:00 PM – 8:00 PM';
    const WIN_SAT = '12:00 PM – 3:00 PM';

    function normalizeSubscriptionScheduleSource(source) {
      if (source === 'central_engine' || source === 'subscription_renewal') {
        return 'subscription_renewal';
      }
      return null;
    }

    function p5GetDow(dateStr) {
      const [y, m, d] = dateStr.split('-').map(Number);
      return new Date(y, m - 1, d).getDay();
    }
    function p5ValidateFulfillments(fulfillments) {
      const errors = [];
      // Only validate if payload explicitly signals subscription schedule-engine output.
      // (legacy CA payloads without final_schedule_source are allowed through for backward compat)
      if (normalizedScheduleSource !== 'subscription_renewal') return errors;

      fulfillments.forEach((f, idx) => {
        const fn = f.fulfillment_number || idx + 1;
        if (f.production_date && !VALID_PROD_DAYS.has(p5GetDow(f.production_date))) {
          errors.push(`Fulfillment #${fn}: production_date ${f.production_date} is not Tue or Fri`);
        }
        const deliv = f.scheduled_date || f.delivery_date;
        if (deliv && !VALID_DELIV_DAYS.has(p5GetDow(deliv))) {
          errors.push(`Fulfillment #${fn}: delivery_date ${deliv} is not Wed or Sat`);
        }
        if (deliv && f.delivery_window_label) {
          const dow = p5GetDow(deliv);
          const expectedWin = dow === 3 ? WIN_WED : dow === 6 ? WIN_SAT : null;
          if (expectedWin && f.delivery_window_label !== expectedWin) {
            errors.push(`Fulfillment #${fn}: delivery_window "${f.delivery_window_label}" should be "${expectedWin}" for ${deliv}`);
          }
        }
      });
      return errors;
    }

    // Validate required fields
    const missingFields = [];
    if (!customer_email) missingFields.push('customer_email');
    if (!stripe_subscription_id) missingFields.push('stripe_subscription_id');
    const hasDeliveryDates = data.first_delivery_date || (Array.isArray(data.fulfillments) && data.fulfillments.length > 0);
    if (!hasDeliveryDates) missingFields.push('first_delivery_date or fulfillments[]');

    if (missingFields.length > 0) {
      console.error('[CUSTOMER-APP-GATEWAY] ❌ VALIDATION FAILED - Missing:', missingFields);
      return Response.json({
        status: 'error',
        reason_code: 'PAYLOAD_REJECTED',
        message: `Missing required fields: ${missingFields.join(', ')}`,
        missing_fields: missingFields,
        event_received: event,
        stripe_subscription_id: stripe_subscription_id || null,
        hint: 'Required: customer_email, stripe_subscription_id, (first_delivery_date OR fulfillments[])',
      }, { status: 400 });
    }

    // Validate payment status
    const paymentStatus = data.payment_status || data.financial_status || '';
    if (paymentStatus !== 'paid') {
      console.warn('[CUSTOMER-APP-GATEWAY] ⚠ NOT YET PAID - payment_status:', paymentStatus || 'MISSING');
      return Response.json({
        status: 'acknowledged',
        reason_code: 'NOT_YET_PAID',
        event,
        stripe_subscription_id,
        note: `Not yet paid (payment_status=${paymentStatus || 'missing'})`,
      });
    }

    const base44 = createClientFromRequest(req);

    // ───────────────────────────────────────────────────────────────────────────
    // BUILD FULFILLMENTS ARRAY
    // ───────────────────────────────────────────────────────────────────────────
    let fulfillmentsToCreate = [];

    if (Array.isArray(data.fulfillments) && data.fulfillments.length > 0) {
      fulfillmentsToCreate = data.fulfillments;
      console.log(`[CUSTOMER-APP-GATEWAY] Accepting ${fulfillmentsToCreate.length} explicit fulfillments from CA`);
    } else if (data.first_delivery_date) {
      console.log(`[CUSTOMER-APP-GATEWAY] ⚠ Single fulfillment only (legacy)`);

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
              status: 'error',
              reason_code: 'PAYLOAD_REJECTED',
              message: 'Could not decompose subscription plan — no products returned.',
              event_received: event,
              stripe_subscription_id,
              hint: 'Send fulfillments[] directly with product_name and quantity',
            }, { status: 400 });
          }
        } catch (decompErr) {
          console.error('[CUSTOMER-APP-GATEWAY] ❌ Decomposition error:', decompErr.message);
          return Response.json({
            status: 'error',
            reason_code: 'PAYLOAD_REJECTED',
            message: `Plan decomposition failed: ${decompErr.message}`,
            event_received: event,
            stripe_subscription_id,
            hint: 'Send fulfillments[] array directly',
          }, { status: 400 });
        }
      }

      if (fulfillmentItems.length === 0) {
        return Response.json({
          status: 'error',
          reason_code: 'PAYLOAD_REJECTED',
          message: 'No products provided and plan decomposition not possible.',
          event_received: event,
          stripe_subscription_id,
          hint: 'Send fulfillments[] array with products, or provide plan_name for auto-decomposition',
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
        status: 'error',
        reason_code: 'PAYLOAD_REJECTED',
        message: 'No fulfillments could be constructed from the payload.',
        event_received: event,
        stripe_subscription_id,
        hint: 'Send fulfillments[] array with fulfillment_number, scheduled_date, production_date, products',
      }, { status: 400 });
    }

    // ── Phase 5: Validate schedule before processing (subscription schedule-engine payloads only) ──
    if (fulfillmentsToCreate.length > 0) {
      const scheduleErrors = p5ValidateFulfillments(fulfillmentsToCreate);
      if (scheduleErrors.length > 0) {
        console.error('[CUSTOMER-APP-GATEWAY] ❌ SCHEDULE VALIDATION FAILED:', scheduleErrors);
        return Response.json({
          status: 'rejected',
          reason_code: 'INVALID_SCHEDULE',
          message: 'Fulfillment schedule does not comply with NuVira production rules (Tue/Fri production, Wed/Sat delivery).',
          schedule_errors: scheduleErrors,
          event_received: event,
          stripe_subscription_id,
          hint: 'Production days: Tuesday, Friday. Delivery days: Wednesday (5–8 PM), Saturday (12–3 PM).',
        }, { status: 422 });
      }
    }

    console.log(`[CUSTOMER-APP-GATEWAY] Processing ${fulfillmentsToCreate.length} fulfillments`);

    const lineItems = fulfillmentsToCreate.flatMap(f =>
      f.products ? f.products.map(p => ({ title: p.product_name, quantity: p.quantity, price: 0 })) : []
    );

    // ───────────────────────────────────────────────────────────────────────────
    // CREATE/DEDUPE OPERATIONAL ORDER
    // ───────────────────────────────────────────────────────────────────────────
    const existingOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({
      stripe_subscription_id,
    });

    // QUARANTINE GUARD: If ANY order for this sub_id carries ANY retirement signal,
    // block all ingestion — create AND patch — unconditionally.
    // Signals checked (any one is sufficient to block):
    //   payment_status       : 'refunded'
    //   production_status    : 'canceled' | 'cancelled'
    //   fulfillment_status   : 'cancelled'
    //   sync_status          : 'do_not_sync'
    //   data_quality_status  : 'quarantined'
    //   tags (any of)        : refunded, excluded, archived, do_not_sync,
    //                          internal_test_owner_override,
    //                          customer_confusion_duplicate_subscription
    const BLOCKED_TAGS = new Set([
      'refunded', 'excluded', 'archived', 'do_not_sync',
      'internal_test_owner_override', 'customer_confusion_duplicate_subscription',
    ]);
    const quarantinedOrder = (existingOrders || []).find(o =>
      o.data_quality_status === 'quarantined' ||
      o.payment_status === 'refunded' ||
      o.production_status === 'canceled' ||
      o.production_status === 'cancelled' ||
      o.fulfillment_status === 'cancelled' ||
      o.sync_status === 'do_not_sync' ||
      (Array.isArray(o.tags) && o.tags.some(t => BLOCKED_TAGS.has(t)))
    );
    if (quarantinedOrder) {
      console.warn(`[CUSTOMER-APP-GATEWAY] ⛔ QUARANTINE BLOCK — sub ${stripe_subscription_id} is retired (order ${quarantinedOrder.id}, status=${quarantinedOrder.data_quality_status}). Rejecting ingestion.`);
      return Response.json({
        status: 'rejected',
        reason_code: 'SUBSCRIPTION_QUARANTINED',
        message: `Subscription ${stripe_subscription_id} has been administratively retired and cannot be re-ingested.`,
        event_received: event,
        stripe_subscription_id,
        existing_order_id: quarantinedOrder.id,
        existing_order_status: quarantinedOrder.data_quality_status,
      }, { status: 409 });
    }

    const activeExisting = (existingOrders || []).filter(o =>
      o.data_quality_status !== 'quarantined' &&
      o.order_type === 'subscription' &&
      o.source_type === 'subscription_fulfillment'
    );

    let operationalOrderId = null;

    if (activeExisting.length > 0) {
      operationalOrderId = activeExisting[0].id;
      console.log(`[CUSTOMER-APP-GATEWAY] Deduped: reusing order ${operationalOrderId}`);

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

      // ── Phase 5: Derive first delivery window from day-of-week ──
      const firstSchedDate = fulfillmentsToCreate[0]?.scheduled_date || null;
      const firstSchedDow = firstSchedDate ? p5GetDow(firstSchedDate) : null;
      const orderDeliveryWindow = data.delivery_window_label ||
        (firstSchedDow === 3 ? WIN_WED : firstSchedDow === 6 ? WIN_SAT : WIN_WED);

      const createdOrder = await base44.asServiceRole.entities.ShopifyOrder.create({
        shopify_order_id: `sub_operational_${stripe_subscription_id}`,
        shopify_order_number: `#SUB-${stripe_subscription_id.slice(-10)}`,
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
        customer_notes: `Subscription: ${stripe_subscription_id} | Plan: ${data.plan_name || 'N/A'} | ${fulfillmentsToCreate.length} fulfillments`,
        line_items: lineItems,
        fulfillments: fulfillmentsArray,
        assigned_delivery_date: firstSchedDate,
        delivery_window_label: orderDeliveryWindow,
        // ── Phase 5 schedule fields ──
        schedule_source: normalizedScheduleSource,
        schedule_reason: data.schedule_reason || null,
        total_price: 0,
        subtotal: 0,
        stripe_subscription_id,
        customer_app_subscription_id: data.customer_app_subscription_id || null,
        customer_order_date: new Date().toISOString(),
      });

      operationalOrderId = createdOrder.id;
      console.log(`[CUSTOMER-APP-GATEWAY] Created order with ${fulfillmentsToCreate.length} fulfillments`);
    }

    // ───────────────────────────────────────────────────────────────────────────
    // CREATE/DEDUPE FULFILLMENT TASKS
    // ───────────────────────────────────────────────────────────────────────────
    const createdTaskIds = [];
    const deDupedTaskIds = [];

    for (const fulfillment of fulfillmentsToCreate) {
      const fulfNum = fulfillment.fulfillment_number;
      const schedDate = fulfillment.scheduled_date;
      const itemsSummary = (fulfillment.products || []).map(p => `${p.quantity}x ${p.product_name}`).join(', ');

      const existingTasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
        stripe_subscription_id,
        customer_app_subscription_id: data.customer_app_subscription_id,
      });

      const matchingTask = (existingTasks || []).find(t =>
        t.fulfillment_number === fulfNum &&
        t.scheduled_date === schedDate &&
        !(t.notes && t.notes.includes('RETIRED'))
      );

      if (matchingTask) {
        if (!matchingTask.items_summary && itemsSummary) {
          await base44.asServiceRole.entities.FulfillmentTask.update(matchingTask.id, { items_summary: itemsSummary });
        }
        deDupedTaskIds.push(matchingTask.id);
        console.log(`[CUSTOMER-APP-GATEWAY] Deduped FT #${fulfNum}: ${matchingTask.id}`);
      } else {
        // ── Phase 5: Derive delivery window from day-of-week if not explicitly provided ──
        const schedDow = schedDate ? p5GetDow(schedDate) : null;
        const p5Window = fulfillment.delivery_window_label ||
          (schedDow === 3 ? WIN_WED : schedDow === 6 ? WIN_SAT : data.delivery_window_label || WIN_WED);

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
          time_window: p5Window,
          delivery_window_label: p5Window,
          items_summary: itemsSummary,
          order_id: operationalOrderId,
          source_type: 'subscription_fulfillment',
          stripe_subscription_id,
          customer_app_subscription_id: data.customer_app_subscription_id || null,
          payment_status: 'paid',
          fulfillment_number: fulfNum,
          plan_name: data.plan_name || null,
          production_date: fulfillment.production_date || null,
          schedule_source: normalizedScheduleSource,
          notes: `Subscription: ${stripe_subscription_id} | Fulfillment #${fulfNum}/${fulfillmentsToCreate.length}`,
        });

        createdTaskIds.push(newTask.id);
        console.log(`[CUSTOMER-APP-GATEWAY] Created FT #${fulfNum}: ${newTask.id}`);
      }
    }

    // ───────────────────────────────────────────────────────────────────────────
    // AUTO-GENERATE PRODUCTION BATCH DEMAND (non-blocking, idempotent)
    // Only fires when new tasks were actually created (not on pure dedupes)
    // ───────────────────────────────────────────────────────────────────────────
    let batchDemandResult = null;
    if (createdTaskIds.length > 0 && operationalOrderId) {
      try {
        // Collect all production dates from the fulfillments
        const productionDates = fulfillmentsToCreate
          .map(f => f.production_date)
          .filter(Boolean);

        if (productionDates.length > 0) {
          const batchRes = await base44.asServiceRole.functions.invoke('triggerBatchDemandForDates', {
            _internalSecret: INTERNAL_SECRET,
            production_dates: productionDates,
            order_id: operationalOrderId,
            order_number: `#SUB-${stripe_subscription_id.slice(-10)}`,
            customer_email,
            customer_name: data.customer_name || '',
            fulfillments: fulfillmentsToCreate.map(f => ({
              production_date: f.production_date,
              items: (f.products || []).map(p => ({ title: p.product_name, quantity: p.quantity })),
            })),
          });
          batchDemandResult = batchRes?.data || null;
          console.log(`[CUSTOMER-APP-GATEWAY] Batch demand: created=${batchDemandResult?.created} updated=${batchDemandResult?.updated} deduped=${batchDemandResult?.deduped}`);
        }
      } catch (batchErr) {
        console.error(`[CUSTOMER-APP-GATEWAY] ⚠ OPERATIONAL WARNING: Batch demand generation failed (non-critical): ${batchErr.message}`);
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
      stripe_subscription_id,
      batch_demand: batchDemandResult,
      note: `${fulfillmentsToCreate.length} fulfillments processed. Batch demand auto-generated.`,
    }, { status: 200 });

  } catch (error) {
    console.error('[CUSTOMER-APP-GATEWAY] ERROR:', error.message);
    return Response.json({
      status: 'error',
      reason_code: 'INTERNAL_ERROR',
      message: error.message,
    }, { status: 500 });
  }
});
