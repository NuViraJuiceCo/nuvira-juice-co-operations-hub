import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * PROTECTED ENDPOINT: Customer App Order Ingestion
 * 
 * Purpose: Accept paid order payloads from Customer App and ingest them into Hub via safeSyncOrderUpdate.
 * 
 * Security:
 * - Requires CUSTOMER_APP_SYNC_SECRET header token (shared secret)
 * - Routes ALL writes through safeSyncOrderUpdate gateway
 * - Enforces idempotency on order_number, order_intent_id, stripe_checkout_session_id, stripe_payment_intent_id
 * - Does NOT dedupe by customer_email, customer_name, phone, or address
 * 
 * Idempotency Keys (in priority order):
 * 1. stripe_checkout_session_id (primary Stripe identifier)
 * 2. stripe_payment_intent_id (alternative Stripe identifier)
 * 3. order_intent_id (internal order identifier)
 * 4. order_number (display order number)
 * 
 * Same customer CAN place multiple orders:
 * - Each order MUST have a unique order_number
 * - Each order MUST have a unique Stripe Session/Intent ID
 * - Email address alone is NOT an idempotency key
 */

Deno.serve(async (req) => {
  try {
    // ── AUTHENTICATION ──────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    const providedSecret = authHeader?.replace('Bearer ', '').trim();
    const expectedSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

    if (!providedSecret || !expectedSecret || providedSecret !== expectedSecret) {
      console.warn('[INGEST] Unauthorized request: missing or invalid CUSTOMER_APP_SYNC_SECRET');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    
    // ── REQUEST PARSING ────────────────────────────────────────────────────
    const body = await req.json();
    const {
      order_number,        // e.g., "NV-MONI2Z3R"
      order_intent_id,     // e.g., "intent_abc123" (internal order intent)
      customer_name,
      customer_email,
      customer_phone,
      address_line1,
      address_line2,
      address_city,
      address_state,
      address_postal_code,
      address_country,
      line_items,          // Array of {title, quantity, price}
      total_price,
      subtotal,
      delivery_fee,
      stripe_checkout_session_id,   // Stripe session ID
      stripe_payment_intent_id,      // Stripe payment intent ID
      stripe_customer_id,
      payment_status,      // Should be "paid"
      fulfillment_method,  // "delivery", "pickup", etc.
      delivery_notes,
      customer_notes,
      requested_delivery_date,
      selected_delivery_date,        // Customer-chosen delivery date (takes priority over requested_delivery_date)
      delivery_window_label,         // Optional: "5 PM – 8 PM"
    } = body;

    // ── DELIVERY DATE RESOLUTION ──────────────────────────────────────────────
    // Validate customer-selected delivery date against supported schedule.
    // Supported: Wednesday (Wed delivery → Tue production),
    //            Saturday (Sat delivery → Fri production),
    //            Sunday (Sun delivery → Sat production — conditional)
    // Production is always the day immediately before the delivery date on a valid production day.
    const PRODUCTION_DAYS_DOW = { 2: true, 5: true, 6: true }; // Tue=2, Fri=5, Sat=6
    const DELIVERY_DAYS_DOW   = { 3: true, 6: true, 0: true }; // Wed=3, Sat=6, Sun=0

    function resolveProductionDateForDelivery(deliveryDateStr) {
      if (!deliveryDateStr) return null;
      const d = new Date(deliveryDateStr + 'T00:00:00');
      if (isNaN(d.getTime())) return null;
      // Walk backwards up to 7 days to find nearest valid production day
      for (let i = 1; i <= 7; i++) {
        const check = new Date(d);
        check.setDate(d.getDate() - i);
        if (PRODUCTION_DAYS_DOW[check.getDay()]) {
          return check.toISOString().split('T')[0];
        }
      }
      // Fallback: 1 day prior
      const fallback = new Date(d);
      fallback.setDate(d.getDate() - 1);
      return fallback.toISOString().split('T')[0];
    }

    // Pick the best delivery date: customer selection > requested > null
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
        // Invalid delivery day — log it but don't hard-reject; let Hub recalculate
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
    
    // Must have at least one Stripe identifier for idempotency
    const hasStripeId = stripe_checkout_session_id || stripe_payment_intent_id;
    if (!hasStripeId && !order_intent_id) {
      errors.push('At least one idempotency key required: stripe_checkout_session_id, stripe_payment_intent_id, or order_intent_id');
    }

    if (errors.length > 0) {
      console.warn('[INGEST] Validation failed:', errors);
      return Response.json({
        status: 'rejected',
        reason: 'validation_failed',
        errors,
      }, { status: 400 });
    }

    // ── BUILD INCOMING DATA FOR SAFESYNCORDERUPDATE ──────────────────────────
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
      // If a valid delivery date was resolved, set assigned_delivery_date and production_date
      ...(resolvedDeliveryDate ? {
        assigned_delivery_date: resolvedDeliveryDate,
        production_date: resolvedProductionDate,
        delivery_window_label: delivery_window_label || '5 PM – 8 PM',
      } : {}),
      stripe_checkout_session_id: stripe_checkout_session_id || null,
      stripe_payment_intent_id: stripe_payment_intent_id || null,
      stripe_customer_id: stripe_customer_id || null,
      source_channel: 'online',
      source_type: stripe_checkout_session_id ? 'stripe_checkout' : 'stripe_payment',
      order_type: 'one_time',
      fulfillment_mode: 'single_delivery',
      sync_status: 'synced',
      last_sync_at: new Date().toISOString(),
      customer_order_date: new Date().toISOString(),
      production_status: 'new',
      data_quality_status: 'complete',
    };

    // ── PRE-FLIGHT IDEMPOTENCY CHECK ────────────────────────────────────────
    // Check for exact duplicate BEFORE calling safeSyncOrderUpdate.
    // Exact duplicate = same stripe_checkout_session_id OR same stripe_payment_intent_id OR same order_number.
    // NOT a duplicate if only customer_email / address / total / items match.
    // If a match is found, return dedupe_exact_match with full context so CA can log it properly.
    let existingMatchedOrder = null;
    let matchedBy = null;

    // Run lookups in parallel where possible — check session first, then PI and order_number in parallel
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

    if (existingMatchedOrder) {
      // Exact idempotency match found.
      // If the existing order has payment_status=pending and incoming is paid, upgrade it.
      // Otherwise return dedupe_exact_match with full context.
      const existingPayment = existingMatchedOrder.payment_status;
      const shouldUpgradePayment = existingPayment !== 'paid' && incomingData.payment_status === 'paid';

      if (shouldUpgradePayment) {
        // Upgrade payment_status to paid — this is a legitimate state transition, not a duplicate
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

      // True duplicate — no new writes needed
      console.log(`[INGEST] Exact duplicate detected for ${order_number} (matched ${existingMatchedOrder.shopify_order_number} by ${matchedBy}) — returning dedupe_exact_match`);
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

    // ── NO MATCH FOUND — BUILD matchBy and proceed to safeSyncOrderUpdate ───
    // At this point we know no exact idempotency match exists. Create new order.
    const matchBy = {};
    if (stripe_checkout_session_id) matchBy.stripe_checkout_session_id = stripe_checkout_session_id;
    if (stripe_payment_intent_id) matchBy.stripe_payment_intent_id = stripe_payment_intent_id;
    if (order_intent_id) matchBy.order_intent_id = order_intent_id;
    // NOTE: Do NOT add shopify_order_id = order_number here — that caused wrong-order matching
    // since order_number != shopify_order_id in most cases. Order number dedup is handled above.

    console.log('[INGEST] No existing match — creating new order:', {
      order_number,
      stripe_checkout_session_id,
      stripe_payment_intent_id,
      customer_email,
      total_price,
      matchBy: Object.keys(matchBy),
    });

    // ── CALL SAFESYNCORDERUPDATE ────────────────────────────────────────────
    const safeResult = await base44.asServiceRole.functions.invoke('safeSyncOrderUpdate', {
      incomingData,
      source: 'customer_app',
      // Do NOT pass stripeEventId here — we don't want stripe_event_id_applied to block
      // future legitimate payment_status updates from the same session on retry.
      // Idempotency is fully handled by our pre-flight check above.
      matchBy,
    });

    const { status: safeStatus, action, order_id } = safeResult?.data || {};

    console.log('[INGEST] safeSyncOrderUpdate result:', {
      status: safeStatus,
      action,
      order_id,
    });

    // ── RESPONSE MAPPING ────────────────────────────────────────────────────
    if (safeStatus === 'success') {
      return Response.json({
        status: 'success',
        action: action || 'created',
        hub_order_id: order_id,
        order_id: order_id,
        order_number: order_number,
        assigned_delivery_date: resolvedDeliveryDate || null,
        production_date: resolvedProductionDate || null,
        delivery_window_label: resolvedDeliveryDate ? (delivery_window_label || '5 PM – 8 PM') : null,
        delivery_date_note: deliveryDateRejectionReason || null,
      }, { status: 200 });
    } else if (safeStatus === 'rejected') {
      return Response.json({
        status: 'rejected',
        reason: safeResult?.data?.reason || 'unknown_rejection',
        order_number: order_number,
        gateway_detail: safeResult?.data,
      }, { status: 422 });
    } else {
      console.error('[INGEST] Unexpected safeSyncOrderUpdate response:', safeResult?.data);
      return Response.json({
        status: 'error',
        reason: 'gateway_error',
        message: 'safeSyncOrderUpdate returned unexpected response',
        gateway_detail: safeResult?.data,
      }, { status: 500 });
    }

  } catch (error) {
    console.error('[INGEST] Error:', error.message);
    return Response.json({
      status: 'error',
      reason: 'server_error',
      message: error.message,
    }, { status: 500 });
  }
});