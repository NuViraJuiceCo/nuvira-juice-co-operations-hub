import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * stripeSessionReconciliation — Scheduled Safety Net
 *
 * Scans Stripe Checkout Sessions created in the last 48 hours with payment_status=paid.
 * For each paid session, checks if Hub has a ShopifyOrder by stripe_checkout_session_id,
 * stripe_payment_intent_id, or order_number (from metadata).
 * If missing → ingests directly from Stripe metadata via safeSyncOrderUpdate.
 * If metadata incomplete → creates ONE deduped OrderReviewQueue entry.
 *
 * Scheduled: every 6 hours via automation.
 * Can also be invoked manually by admin.
 *
 * Safety rules:
 * - Never duplicates: checks session_id, payment_intent_id, AND order_number before creating
 * - Never touches canceled/refunded/quarantined orders
 * - All writes routed through safeSyncOrderUpdate
 * - Idempotent: safe to re-run at any time
 */

const STRIPE_API_KEY = Deno.env.get('STRIPE_API_KEY');
const PRODUCTION_DAYS_DOW = { 2: true, 5: true, 6: true }; // Tue, Fri, Sat

function resolveProductionDate(deliveryDateStr) {
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

async function fetchStripeJSON(path) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Stripe ${path} → ${res.status}: ${err}`);
  }
  return res.json();
}

async function fetchRecentPaidSessions(lookbackHours = 48) {
  const since = Math.floor((Date.now() - lookbackHours * 60 * 60 * 1000) / 1000);
  const sessions = [];
  let startingAfter = null;

  while (true) {
    // Note: payment_status is not a valid list filter on Stripe sessions API — filter client-side
    const qs = new URLSearchParams({
      limit: '100',
      'created[gte]': String(since),
    });
    if (startingAfter) qs.set('starting_after', startingAfter);

    const page = await fetchStripeJSON(`/v1/checkout/sessions?${qs}`);
    // Only keep paid sessions (filter client-side since Stripe API doesn't support payment_status filter)
    sessions.push(...(page.data || []).filter(s => s.payment_status === 'paid'));
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }

  return sessions;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Auth: admin or scheduled automation
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const isScheduled = body._scheduled === true;
    if (!isScheduled) {
      const user = await base44.auth.me().catch(() => null);
      if (!user || user.role !== 'admin') {
        return Response.json({ error: 'Admin access required' }, { status: 403 });
      }
    }

    const dryRun = body.dry_run === true;
    const lookbackHours = body.lookback_hours || 48;

    console.log(`[STRIPE-RECON] Starting reconciliation — lookback=${lookbackHours}h dryRun=${dryRun}`);

    // ── STEP 1: Fetch recent paid Stripe sessions ────────────────────────────
    const sessions = await fetchRecentPaidSessions(lookbackHours);
    console.log(`[STRIPE-RECON] Found ${sessions.length} paid Stripe sessions in last ${lookbackHours}h`);

    if (sessions.length === 0) {
      return Response.json({ status: 'success', sessions_scanned: 0, ingested: 0, already_exists: 0, queued: 0 });
    }

    // ── STEP 2: Pre-load Hub index for fast lookup ───────────────────────────
    const hubOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500);
    const bySessionId  = new Map(hubOrders.filter(o => o.stripe_checkout_session_id).map(o => [o.stripe_checkout_session_id, o]));
    const byPaymentIntent = new Map(hubOrders.filter(o => o.stripe_payment_intent_id).map(o => [o.stripe_payment_intent_id, o]));
    const byOrderNumber   = new Map(hubOrders.filter(o => o.shopify_order_number).map(o => [o.shopify_order_number, o]));

    // Pre-load pending queue entries to deduplicate
    const queueEntries = await base44.asServiceRole.entities.OrderReviewQueue.filter({ status: 'pending' });
    const queuedSessionIds = new Set(
      (queueEntries || [])
        .map(q => q.incoming_payload?.stripe_checkout_session_id)
        .filter(Boolean)
    );

    const results = { sessions_scanned: 0, already_exists: 0, ingested: 0, queued: 0, errors: [] };

    // ── STEP 3: Process each session ─────────────────────────────────────────
    for (const session of sessions) {
      results.sessions_scanned++;
      const sessionId = session.id;
      const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
      const meta = session.metadata || {};
      const metaOrderNumber = meta.order_number || meta.shopify_order_number || meta.nuvira_order_number;

      // ── CHECK: Does Hub already have this order? ─────────────────────────
      const existing = bySessionId.get(sessionId)
        || (paymentIntentId && byPaymentIntent.get(paymentIntentId))
        || (metaOrderNumber && byOrderNumber.get(metaOrderNumber));

      if (existing) {
        // Skip canceled/refunded/quarantined matches
        const skip = ['canceled', 'refunded', 'quarantined'].some(s =>
          existing.production_status === s || existing.data_quality_status === s
        );
        if (!skip) {
          results.already_exists++;
          continue;
        }
        // Existing is canceled/quarantined — a NEW paid session for same customer should still be ingested
      }

      // ── EXTRACT DATA from Stripe session ────────────────────────────────
      const email    = session.customer_details?.email || session.customer_email || '';
      const name     = session.customer_details?.name  || meta.customer_name || '';
      const phone    = session.customer_details?.phone || meta.customer_phone || '';
      const addr     = session.customer_details?.address || session.shipping_details?.address || {};
      const total    = (session.amount_total || 0) / 100;
      const subtotal = (session.amount_subtotal || session.amount_total || 0) / 100;

      // Address fields from metadata (CA stores structured fields) or customer_details
      const addressLine1 = meta.delivery_address_line1 || meta.address_line1 || addr.line1 || '';
      const addressLine2 = meta.delivery_address_line2 || meta.address_line2 || addr.line2 || '';
      const addressCity  = meta.delivery_city  || meta.address_city  || addr.city  || '';
      const addressState = meta.delivery_state || meta.address_state || addr.state || '';
      const addressZip   = meta.delivery_postal_code || meta.address_postal_code || addr.postal_code || '';
      const addressCountry = meta.delivery_country || meta.address_country || addr.country || 'US';

      const deliveryDate = meta.selected_delivery_date || meta.requested_delivery_date || meta.delivery_date || '';
      const productionDate = resolveProductionDate(deliveryDate);

      // ── COMPLETENESS CHECK ───────────────────────────────────────────────
      const hasIdentity = email && name;
      const hasAddress  = addressLine1 && addressCity && addressState;
      const isComplete  = hasIdentity && hasAddress && total > 0;

      if (!isComplete) {
        // Queue ONE entry per session — skip if already queued
        if (!queuedSessionIds.has(sessionId)) {
          const missing = [
            !email && 'email',
            !name  && 'customer_name',
            !addressLine1 && 'address_line1',
            !addressCity  && 'address_city',
            !addressState && 'address_state',
            !(total > 0)  && 'total_price',
          ].filter(Boolean).join(', ');

          console.log(`[STRIPE-RECON] Incomplete session ${sessionId} — queuing. Missing: ${missing}`);

          if (!dryRun) {
            await base44.asServiceRole.entities.OrderReviewQueue.create({
              incident_type: 'incomplete_payload',
              customer_email: email || null,
              customer_name: name || null,
              incoming_source: 'scheduled_sync',
              incoming_payload: {
                stripe_checkout_session_id: sessionId,
                stripe_payment_intent_id: paymentIntentId || null,
                order_number: metaOrderNumber || null,
                total_price: total,
                metadata: meta,
              },
              issue_description: `Paid Stripe session missing Hub order. Incomplete metadata — cannot auto-ingest. Missing: ${missing}`,
              recommended_action: 'recover_from_stripe',
              status: 'pending',
            });
            queuedSessionIds.add(sessionId);
          }
          results.queued++;
        }
        continue;
      }

      // ── FETCH LINE ITEMS ─────────────────────────────────────────────────
      let lineItems = [];
      try {
        const itemsData = await fetchStripeJSON(`/v1/checkout/sessions/${sessionId}/line_items?limit=100&expand[]=data.price.product`);
        lineItems = (itemsData.data || []).map(li => ({
          title: li.description || li.price?.product?.name || li.price?.nickname || 'Item',
          quantity: li.quantity || 1,
          price: (li.amount_total || 0) / 100 / (li.quantity || 1),
        }));
      } catch (err) {
        console.warn(`[STRIPE-RECON] Could not fetch line_items for ${sessionId}: ${err.message}`);
      }

      // ── BUILD ORDER PAYLOAD ──────────────────────────────────────────────
      const orderNumber = metaOrderNumber || `STR-${sessionId.slice(-8)}`;
      const incomingData = {
        shopify_order_id: `stripe_checkout:${sessionId}`,
        shopify_order_number: orderNumber,
        customer_name:   name,
        customer_email:  email,
        customer_phone:  phone,
        line_items:      lineItems,
        total_price:     total,
        subtotal:        subtotal,
        payment_status:  'paid',
        fulfillment_method: meta.delivery_method || meta.fulfillment_method || 'delivery',
        order_type:      'one_time',
        fulfillment_mode: 'single_delivery',
        source_channel:  'online',
        source_type:     'stripe_checkout',
        production_status: 'new',
        data_quality_status: 'complete',
        sync_status:     'synced',
        last_sync_at:    new Date().toISOString(),
        customer_order_date: new Date(session.created * 1000).toISOString(),
        stripe_checkout_session_id: sessionId,
        stripe_payment_intent_id:   paymentIntentId || null,
        stripe_customer_id:         typeof session.customer === 'string' ? session.customer : session.customer?.id || null,
        address_line1:   addressLine1,
        address_line2:   addressLine2,
        address_city:    addressCity,
        address_state:   addressState,
        address_postal_code: addressZip,
        address_country: addressCountry,
        address_last_synced_from: 'stripe_reconciliation',
        address_last_synced_at:   new Date().toISOString(),
        customer_notes:  meta.customer_notes || '',
        delivery_notes:  meta.delivery_notes || '',
        ...(deliveryDate ? {
          selected_delivery_date: deliveryDate,
          assigned_delivery_date: deliveryDate,
          requested_delivery_date: deliveryDate,
          production_date: productionDate,
          delivery_window_label: meta.delivery_window_label || '5 PM – 8 PM',
        } : {}),
      };

      if (dryRun) {
        console.log(`[STRIPE-RECON] DRY RUN — would ingest: ${orderNumber} (${email}) session=${sessionId}`);
        results.ingested++;
        continue;
      }

      // ── INGEST VIA safeSyncOrderUpdate ───────────────────────────────────
      try {
        const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');
        const safeResult = await base44.asServiceRole.functions.invoke('safeSyncOrderUpdate', {
          incomingData,
          source: 'rebuild_subscriptions', // has full field ownership; internal secret authorizes
          stripeEventId: sessionId,
          matchBy: {
            stripe_checkout_session_id: sessionId,
            ...(paymentIntentId ? { stripe_payment_intent_id: paymentIntentId } : {}),
            ...(metaOrderNumber ? { shopify_order_id: metaOrderNumber } : {}),
          },
          _internalSecret: internalSecret,
        });

        const action = safeResult?.data?.action;
        const orderId = safeResult?.data?.order_id;

        if (action === 'created' || action === 'updated') {
          console.log(`[STRIPE-RECON] ${action === 'created' ? '✅ Ingested' : '↩️ Updated'} ${orderNumber} → Hub id ${orderId}`);
          results.ingested++;

          // Update Hub index so subsequent sessions in this run don't re-create
          bySessionId.set(sessionId, { id: orderId, shopify_order_number: orderNumber });
          if (paymentIntentId) byPaymentIntent.set(paymentIntentId, { id: orderId });
          if (metaOrderNumber) byOrderNumber.set(metaOrderNumber, { id: orderId });
        } else {
          console.log(`[STRIPE-RECON] Skipped ${orderNumber}: ${safeResult?.data?.status} / ${safeResult?.data?.reason}`);
          results.already_exists++;
        }
      } catch (err) {
        console.error(`[STRIPE-RECON] Failed to ingest ${sessionId}: ${err.message}`);
        results.errors.push({ session_id: sessionId, order_number: metaOrderNumber, error: err.message });
      }
    }

    console.log(`[STRIPE-RECON] Done. scanned=${results.sessions_scanned} exists=${results.already_exists} ingested=${results.ingested} queued=${results.queued} errors=${results.errors.length}`);

    return Response.json({ status: 'success', dry_run: dryRun, lookback_hours: lookbackHours, ...results });

  } catch (error) {
    console.error('[STRIPE-RECON] Fatal error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});