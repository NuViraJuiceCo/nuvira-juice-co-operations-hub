import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * PROTECTED ENDPOINT: Customer App Order Ingestion
 *
 * Purpose: Accept paid order payloads from Customer App and ingest them into Hub via safeSyncOrderUpdate.
 *          After successful creation: triggers FulfillmentTask creation and production batch recalculation.
 *
 * Security:
 * - Requires CUSTOMER_APP_SYNC_SECRET header token (shared secret)
 * - Internal test/dry_run calls allowed via body._internalSecret = INTERNAL_FUNCTION_SECRET
 * - Routes ALL writes through safeSyncOrderUpdate gateway
 * - Enforces idempotency on order_number, stripe_checkout_session_id, stripe_payment_intent_id
 * - Does NOT dedupe by customer_email, customer_name, phone, address, or cart
 *
 * Response contract:
 * - action=created           → new ShopifyOrder created; hub_order_id always present
 * - action=updated           → existing order payment upgraded; hub_order_id always present
 * - action=dedupe_exact_match → order already exists; hub_order_id always present
 * - action=queued_for_review  → data incomplete; order queued; no hub_order_id
 * - action=rejected           → invalid payload; no hub_order_id
 * - status=dry_run            → no writes; branch_trace shows projected_action
 */

// Production day schedule
const PRODUCTION_DAYS_DOW = { 2: true, 5: true, 6: true }; // Tue=2, Fri=5, Sat=6
const DELIVERY_DAYS_DOW   = { 3: true, 6: true, 0: true }; // Wed=3, Sat=6, Sun=0

function resolveProductionDateForDelivery(deliveryDateStr) {
  if (!deliveryDateStr) return null;
  const d = new Date(deliveryDateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  for (let i = 1; i <= 7; i++) {
    const check = new Date(d);
    check.setDate(d.getDate() - i);
    if (PRODUCTION_DAYS_DOW[check.getDay()]) {
      return check.toISOString().split('T')[0];
    }
  }
  const fallback = new Date(d);
  fallback.setDate(d.getDate() - 1);
  return fallback.toISOString().split('T')[0];
}

Deno.serve(async (req) => {
  try {
    // ── AUTHENTICATION ──────────────────────────────────────────────────────
    const base44 = createClientFromRequest(req);

    // Parse body first so we can read _internalSecret for test/dry_run calls
    const body = await req.json();

    const authHeader = req.headers.get('Authorization');
    const providedSecret = authHeader?.replace('Bearer ', '').trim();
    const expectedSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
    const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');

    // Allow internal test/dry_run calls via body._internalSecret or Authorization header
    const isInternalTest = internalSecret && (
      (providedSecret && providedSecret === internalSecret) ||
      (body._internalSecret && body._internalSecret === internalSecret)
    );
    const isCustomerApp = providedSecret && expectedSecret && providedSecret === expectedSecret;

    if (!isCustomerApp && !isInternalTest) {
      console.warn('[INGEST] Unauthorized request: missing or invalid auth secret');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── REQUEST PARSING ────────────────────────────────────────────────────
    const {
      order_number,
      order_intent_id,
      dry_run = false,
      customer_name,
      customer_email,
      customer_phone,
      address_line1,
      address_line2,
      address_city,
      address_state,
      address_postal_code,
      address_country,
      line_items,
      total_price,
      subtotal,
      stripe_checkout_session_id,
      stripe_payment_intent_id,
      stripe_customer_id,
      payment_status,
      fulfillment_method,
      delivery_notes,
      customer_notes,
      requested_delivery_date,
      selected_delivery_date,
      delivery_window_label,
    } = body;

    // ── DELIVERY DATE RESOLUTION ────────────────────────────────────────────
    const candidateDeliveryDate = selected_delivery_date || requested_delivery_date || null;
    let resolvedDeliveryDate = null;
    let resolvedProductionDate = null;
    let deliveryDateRejectionReason = null;

    if (candidateDeliveryDate) {
      const d = new Date(candidateDeliveryDate + 'T00:00:00');
      if (!isNaN(d.getTime()) && DELIVERY_DAYS_DOW[d.getDay()] !== undefined) {
        resolvedDeliveryDate = candidateDeliveryDate;
        resolvedProductionDate = resolveProductionDateForDelivery(candidateDeliveryDate);
      } else if (!isNaN(d.getTime())) {
        deliveryDateRejectionReason = `Delivery date ${candidateDeliveryDate} (day ${d.getDay()}) is not a supported delivery day (Wed/Sat/Sun). Hub will recalculate.`;
        console.warn('[INGEST] ' + deliveryDateRejectionReason);
      }
    }

    // ── VALIDATION ────────────────────────────────────────────────────────
    const errors = [];
    if (!order_number) errors.push('order_number required');
    if (!customer_email) errors.push('customer_email required');
    if (!line_items || !Array.isArray(line_items) || line_items.length === 0) {
      errors.push('line_items required (non-empty array)');
    }
    if (!total_price || total_price <= 0) errors.push('total_price required (> 0)');
    if (payment_status !== 'paid') errors.push('payment_status must be "paid"');
    const hasStripeId = stripe_checkout_session_id || stripe_payment_intent_id;
    if (!hasStripeId && !order_intent_id) {
      errors.push('At least one idempotency key required: stripe_checkout_session_id, stripe_payment_intent_id, or order_intent_id');
    }

    if (errors.length > 0) {
      console.warn('[INGEST] Validation failed:', errors);
      return Response.json({
        status: 'rejected',
        action: 'rejected',
        reason: 'validation_failed',
        errors,
      }, { status: 400 });
    }

    // ── ADDRESS VALIDATION for delivery orders ───────────────────────────────
    const isDelivery = (fulfillment_method || 'delivery') === 'delivery';
    if (isDelivery && (!address_line1 || !address_city)) {
      console.warn(`[INGEST] Delivery order ${order_number} missing address — quarantining. address_line1="${address_line1}" address_city="${address_city}"`);
      return Response.json({
        status: 'queued',
        action: 'queued_for_review',
        reason: 'delivery_order_missing_address',
        errors: ['Delivery orders require address_line1 and address_city'],
        order_number,
      }, { status: 202 });
    }

    // ── PRE-FLIGHT IDEMPOTENCY CHECK ────────────────────────────────────────
    let existingMatchedOrder = null;
    let matchedBy = null;

    if (stripe_checkout_session_id) {
      const found = await base44.asServiceRole.entities.ShopifyOrder.filter({ stripe_checkout_session_id });
      if (found?.length > 0) { existingMatchedOrder = found[0]; matchedBy = 'stripe_checkout_session_id'; }
    }
    if (!existingMatchedOrder) {
      const [byPI, byNum] = await Promise.all([
        stripe_payment_intent_id
          ? base44.asServiceRole.entities.ShopifyOrder.filter({ stripe_payment_intent_id })
          : Promise.resolve([]),
        order_number
          ? base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_number: order_number })
          : Promise.resolve([]),
      ]);
      if (byPI?.length > 0) { existingMatchedOrder = byPI[0]; matchedBy = 'stripe_payment_intent_id'; }
      else if (byNum?.length > 0) { existingMatchedOrder = byNum[0]; matchedBy = 'order_number'; }
    }

    // ── DRY RUN BRANCH TRACE ────────────────────────────────────────────────
    // dry_run=true traces which branch would execute without writing any data.
    if (dry_run) {
      const projectedAction = existingMatchedOrder
        ? (existingMatchedOrder.payment_status !== 'paid' ? 'updated (payment_upgrade)' : 'dedupe_exact_match')
        : 'created';

      return Response.json({
        status: 'dry_run',
        projected_action: projectedAction,
        hub_app_id: '69da9e8036b037ad40a9a73f',
        endpoint_function: 'ingestCustomerAppOrder',
        endpoint_url_pattern: 'https://<hub-domain>/functions/ingestCustomerAppOrder',
        branch_trace: {
          step_1_auth: isCustomerApp ? 'customer_app_secret' : 'internal_test_secret',
          step_2_validation: 'passed',
          step_3_idempotency: existingMatchedOrder
            ? `MATCH FOUND — ${existingMatchedOrder.shopify_order_number} by ${matchedBy}`
            : 'NO MATCH — would proceed to create new order',
          step_4_delivery_date: resolvedDeliveryDate
            ? `resolved → delivery=${resolvedDeliveryDate} production=${resolvedProductionDate}`
            : `not resolved — ${deliveryDateRejectionReason || 'no delivery date provided'}`,
          step_5_new_order_fields: existingMatchedOrder ? null : {
            shopify_order_number: order_number,
            payment_status: 'paid',
            production_status: 'awaiting_production',
            order_lock_status: 'verified',
            data_quality_status: 'complete',
            assigned_delivery_date: resolvedDeliveryDate || null,
            production_date: resolvedProductionDate || null,
            delivery_window_label: delivery_window_label || '5 PM – 8 PM',
            source_type: stripe_checkout_session_id ? 'stripe_checkout' : stripe_payment_intent_id ? 'stripe_payment_intent' : 'customer_app',
          },
          step_6_post_create: existingMatchedOrder ? 'N/A' : (resolvedDeliveryDate
            ? 'would create FulfillmentTask + recalculateProductionBatches'
            : 'would recalculateProductionBatches only (no delivery date)'),
          step_7_response: `action=${projectedAction}, hub_order_id=${existingMatchedOrder?.id || '<new_id>'}`,
        },
        idempotency_keys_checked: {
          stripe_checkout_session_id: stripe_checkout_session_id || null,
          stripe_payment_intent_id: stripe_payment_intent_id || null,
          order_number,
        },
        note: 'dry_run=true — zero records written. Remove dry_run or set to false to execute.',
      }, { status: 200 });
    }

    if (existingMatchedOrder) {
      const existingPayment = existingMatchedOrder.payment_status;
      const shouldUpgradePayment = existingPayment !== 'paid' && payment_status === 'paid';

      if (shouldUpgradePayment) {
        console.log(`[INGEST] Upgrading payment_status from ${existingPayment} → paid for ${existingMatchedOrder.shopify_order_number} (matched by ${matchedBy})`);
        await base44.asServiceRole.entities.ShopifyOrder.update(existingMatchedOrder.id, {
          payment_status: 'paid',
          sync_status: 'synced',
          last_sync_at: new Date().toISOString(),
        });
        return Response.json({
          status: 'success',
          action: 'updated',
          hub_order_id: existingMatchedOrder.id,
          order_id: existingMatchedOrder.id,
          order_number: existingMatchedOrder.shopify_order_number,
          payment_status_upgraded: true,
          matched_by: matchedBy,
          assigned_delivery_date: existingMatchedOrder.assigned_delivery_date || resolvedDeliveryDate || null,
          production_date: existingMatchedOrder.production_date || resolvedProductionDate || null,
          delivery_window_label: existingMatchedOrder.delivery_window_label || '5 PM – 8 PM',
        }, { status: 200 });
      }

      // True duplicate — return dedupe_exact_match with hub_order_id
      console.log(`[INGEST] Exact duplicate: ${order_number} matched ${existingMatchedOrder.shopify_order_number} by ${matchedBy}`);
      return Response.json({
        status: 'success',
        action: 'dedupe_exact_match',
        hub_order_id: existingMatchedOrder.id,
        order_id: existingMatchedOrder.id,
        order_number: existingMatchedOrder.shopify_order_number,
        matched_by: matchedBy,
        matched_hub_order_id: existingMatchedOrder.id,
        matched_order_number: existingMatchedOrder.shopify_order_number,
        matched_stripe_checkout_session_id: existingMatchedOrder.stripe_checkout_session_id || null,
        matched_stripe_payment_intent_id: existingMatchedOrder.stripe_payment_intent_id || null,
        reason: `Idempotent duplicate — order already exists in Hub (matched by ${matchedBy})`,
      }, { status: 200 });
    }

    // ── NO MATCH FOUND — BUILD PAYLOAD AND CREATE NEW ORDER ──────────────────
    console.log('[INGEST] No existing match — creating new order:', {
      order_number,
      stripe_checkout_session_id,
      stripe_payment_intent_id,
      customer_email,
      total_price,
    });

    const incomingData = {
      shopify_order_number: order_number,
      customer_name: customer_name || '',
      customer_email: customer_email,
      customer_phone: customer_phone || '',
      address_line1: address_line1 || '',
      address_line2: address_line2 || '',
      address_city: address_city || '',
      address_state: address_state || '',
      address_postal_code: address_postal_code || '',
      address_country: address_country || 'US',
      line_items: line_items || [],
      total_price: total_price,
      subtotal: subtotal || total_price,
      payment_status: 'paid',
      fulfillment_method: fulfillment_method || 'delivery',
      delivery_notes: delivery_notes || '',
      customer_notes: customer_notes || '',
      requested_delivery_date: requested_delivery_date || '',
      selected_delivery_date: selected_delivery_date || null,
      ...(resolvedDeliveryDate ? {
        assigned_delivery_date: resolvedDeliveryDate,
        production_date: resolvedProductionDate,
        delivery_window_label: delivery_window_label || '5 PM – 8 PM',
      } : {}),
      stripe_checkout_session_id: stripe_checkout_session_id || null,
      stripe_payment_intent_id: stripe_payment_intent_id || null,
      stripe_customer_id: stripe_customer_id || null,
      source_channel: 'online',
      source_type: stripe_checkout_session_id ? 'stripe_checkout' : stripe_payment_intent_id ? 'stripe_payment_intent' : 'customer_app',
      order_type: 'one_time',
      fulfillment_mode: 'single_delivery',
      sync_status: 'synced',
      last_sync_at: new Date().toISOString(),
      customer_order_date: new Date().toISOString(),
      production_status: 'awaiting_production',
      order_lock_status: 'verified',
      data_quality_status: 'complete',
    };

    const matchBy = {};
    if (stripe_checkout_session_id) matchBy.stripe_checkout_session_id = stripe_checkout_session_id;
    if (stripe_payment_intent_id) matchBy.stripe_payment_intent_id = stripe_payment_intent_id;
    if (order_intent_id) matchBy.order_intent_id = order_intent_id;
    // Always include order_number as final dedup safety net in safeSyncOrderUpdate
    if (order_number) matchBy.shopify_order_number = order_number;

    // ── CALL SAFESYNCORDERUPDATE ────────────────────────────────────────────
    const safeResult = await base44.asServiceRole.functions.invoke('safeSyncOrderUpdate', {
      incomingData,
      source: 'customer_app',
      matchBy,
    });

    const { status: safeStatus, action, order_id } = safeResult?.data || {};

    console.log('[INGEST] safeSyncOrderUpdate result:', { status: safeStatus, action, order_id });

    if (safeStatus === 'success' && action === 'created' && order_id) {
      const creationTasks = [];

      // ── ADDRESS SNAPSHOT ─────────────────────────────────────────────────────
      // Normalize address once and write back to ShopifyOrder top-level fields
      // to guarantee ShopifyOrder and FulfillmentTask are always consistent.
      const normalizedAddress = {
        address_line1: address_line1 || '',
        address_line2: address_line2 || '',
        address_city: address_city || '',
        address_state: address_state || '',
        address_postal_code: address_postal_code || '',
        address_country: address_country || 'US',
      };
      const fullAddressStr = [address_line1, address_line2, address_city, address_state, address_postal_code]
        .filter(Boolean).join(', ');
      const hasAddress = !!(address_line1 && address_city);

      // Backfill ShopifyOrder address fields atomically after creation
      if (hasAddress) {
        creationTasks.push(
          base44.asServiceRole.entities.ShopifyOrder.update(order_id, {
            ...normalizedAddress,
            delivery_address: fullAddressStr,
            address_last_synced_from: 'customer_app_ingest',
            address_last_synced_at: new Date().toISOString(),
          }).then(() => {
            console.log(`[INGEST] Address snapshot written to ShopifyOrder ${order_id}`);
          })
        );
      } else {
        console.warn(`[INGEST] Order ${order_number} created with missing address (line1="${address_line1}" city="${address_city}") — not a delivery-blocking issue if pickup`);
      }

      if (resolvedDeliveryDate) {
        const itemsSummary = line_items.map(i => `${i.quantity}x ${i.title}`).join(', ');

        creationTasks.push(
          base44.asServiceRole.entities.FulfillmentTask.create({
            customer_name: customer_name || customer_email,
            customer_email: customer_email || '',
            customer_phone: customer_phone || '',
            fulfillment_type: fulfillment_method === 'pickup' ? 'Pickup' : 'Delivery',
            time_window: delivery_window_label || '5 PM – 8 PM',
            delivery_window_label: delivery_window_label || '5 PM – 8 PM',
            status: 'Scheduled',
            scheduled_date: resolvedDeliveryDate,
            // Write both legacy address field and normalized fields
            address: fullAddressStr,
            address_line1: normalizedAddress.address_line1,
            address_line2: normalizedAddress.address_line2,
            address_city: normalizedAddress.address_city,
            address_state: normalizedAddress.address_state,
            address_postal_code: normalizedAddress.address_postal_code,
            delivery_address: fullAddressStr,
            items_summary: itemsSummary,
            order_id: order_id,
            order_number: order_number,
            source_type: 'order_derived',
            notes: `One-time order auto-fulfillment task created from ${stripe_checkout_session_id ? 'stripe_checkout' : 'stripe_payment_intent'} checkout`,
          }).then(ft => {
            console.log(`[INGEST] Created FulfillmentTask ${ft.id} for ${order_number} on ${resolvedDeliveryDate} — address: "${fullAddressStr}"`);
            return ft;
          })
        );
      }

      creationTasks.push(
        base44.asServiceRole.functions.invoke('recalculateProductionBatches', {}).then(() => {
          console.log(`[INGEST] Production batches recalculated for ${order_number}`);
        }).catch(err => {
          console.warn(`[INGEST] Batch recalc failed (non-fatal): ${err.message}`);
        })
      );

      await Promise.all(creationTasks);

      return Response.json({
        status: 'success',
        action: 'created',
        hub_order_id: order_id,
        order_id: order_id,
        order_number: order_number,
        assigned_delivery_date: resolvedDeliveryDate || null,
        production_date: resolvedProductionDate || null,
        delivery_window_label: resolvedDeliveryDate ? (delivery_window_label || '5 PM – 8 PM') : null,
        delivery_date_note: deliveryDateRejectionReason || null,
      }, { status: 200 });

    } else if (safeStatus === 'success' && action === 'updated') {
      return Response.json({
        status: 'success',
        action: 'updated',
        hub_order_id: order_id,
        order_id: order_id,
        order_number: order_number,
        assigned_delivery_date: resolvedDeliveryDate || null,
        production_date: resolvedProductionDate || null,
        delivery_window_label: resolvedDeliveryDate ? (delivery_window_label || '5 PM – 8 PM') : null,
      }, { status: 200 });

    } else if (safeStatus === 'rejected') {
      const reason = safeResult?.data?.reason || 'unknown_rejection';
      console.error(`[INGEST] safeSyncOrderUpdate rejected ${order_number}: ${reason}`);
      const queueableReasons = ['delivery_order_missing_address', 'low_quality_new_order', 'missing_customer_info'];
      const isQueued = queueableReasons.some(r => reason.startsWith(r.split('_score')[0]));
      return Response.json({
        status: isQueued ? 'queued' : 'rejected',
        action: isQueued ? 'queued_for_review' : 'rejected',
        reason: reason,
        order_number: order_number,
        gateway_detail: safeResult?.data,
      }, { status: isQueued ? 202 : 422 });

    } else {
      console.error('[INGEST] Unexpected safeSyncOrderUpdate response for', order_number, ':', JSON.stringify(safeResult?.data));
      return Response.json({
        status: 'error',
        action: 'error',
        reason: 'gateway_error',
        message: `safeSyncOrderUpdate returned unexpected response: status=${safeStatus} action=${action}`,
        order_number: order_number,
        gateway_detail: safeResult?.data,
      }, { status: 500 });
    }

  } catch (error) {
    console.error('[INGEST] Error:', error.message);
    return Response.json({
      status: 'error',
      action: 'error',
      reason: 'server_error',
      message: error.message,
    }, { status: 500 });
  }
});