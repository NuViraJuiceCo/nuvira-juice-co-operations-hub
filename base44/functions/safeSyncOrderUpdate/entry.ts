import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * safeSyncOrderUpdate — THE SINGLE GATEWAY FOR ALL ORDER WRITES
 *
 * ALL syncs (Stripe webhooks, customer app pulls, recovery tools) MUST route through here.
 * Direct writes to ShopifyOrder outside this function are forbidden.
 *
 * Enforces:
 *  - Order lock status (unlocked/verified/production_scheduled/in_production/out_for_delivery/fulfilled)
 *  - Field ownership per source
 *  - Subscription hard lock (never downgrade, never erase fulfillments)
 *  - Unknown/incomplete payload quarantine
 *  - Idempotency via stripeEventId
 *  - Audit logging to OrderSyncLog
 */

// ── LOCK RULES ──────────────────────────────────────────────────────────────
// For each lock level, which fields are FROZEN (cannot be overwritten by any sync)
const LOCK_FROZEN_FIELDS = {
  unlocked: [],
  verified: ['customer_name', 'customer_email', 'customer_phone', 'source_channel', 'stripe_subscription_id'],
  production_scheduled: ['customer_name', 'customer_email', 'customer_phone', 'source_channel',
    'stripe_subscription_id', 'line_items', 'fulfillments',
    'payment_status', 'address_line1', 'address_line2', 'address_city', 'address_state', 'address_postal_code', 'address_country'],
  in_production: ['customer_name', 'customer_email', 'customer_phone', 'source_channel',
    'stripe_subscription_id', 'line_items', 'fulfillments', 'total_price', 'subtotal',
    'payment_status', 'address_line1', 'address_line2', 'address_city', 'address_state', 'address_postal_code', 'address_country'],
  out_for_delivery: ['customer_name', 'customer_email', 'customer_phone', 'source_channel',
    'stripe_subscription_id', 'line_items', 'fulfillments', 'total_price', 'subtotal',
    'address_line1', 'address_line2', 'address_city', 'address_state', 'address_postal_code', 'address_country'],
  fulfilled: ['customer_name', 'customer_email', 'customer_phone', 'source_channel',
    'stripe_subscription_id', 'line_items', 'fulfillments', 'total_price', 'subtotal',
    'payment_status',
    'address_line1', 'address_line2', 'address_city', 'address_state', 'address_postal_code', 'address_country'],
};

// ── FIELD OWNERSHIP ──────────────────────────────────────────────────────────
// Only these sources can write these fields. All others are ignored.
const FIELD_OWNERSHIP = {
  stripe_webhook: [
    'shopify_order_id', 'shopify_order_number',
    'payment_status', 'stripe_customer_id', 'stripe_subscription_id', 'stripe_invoice_id',
    'stripe_checkout_session_id', 'stripe_payment_intent_id', 'stripe_charge_id',
    'stripe_created_event_type', 'stripe_event_id_applied', 'last_reconciliation_at',
    'sync_status', 'last_sync_at', 'customer_order_date', 'source_type',
    'customer_name', 'customer_email', 'customer_phone', 'source_channel',
    'line_items', 'total_price', 'subtotal', 'fulfillment_method',
    'address_line1', 'address_line2', 'address_city', 'address_state',
    'address_postal_code', 'address_country', 'address_last_synced_from', 'address_last_synced_at',
  ],
  customer_app: [
    'customer_name', 'customer_email', 'customer_phone',
    'address_line1', 'address_line2', 'address_city', 'address_state',
    'address_postal_code', 'address_country', 'customer_notes',
    'requested_delivery_date', 'selected_delivery_date', 'assigned_delivery_date',
    'production_date', 'delivery_window_label', 'delivery_notes', 'fulfillment_method',
    'line_items', 'total_price', 'subtotal', 'delivery_fee', 'tags', 'sync_status', 'last_sync_at',
    'shopify_order_number', 'payment_status', 'stripe_checkout_session_id', 'stripe_payment_intent_id',
    'stripe_customer_id', 'source_channel', 'source_type', 'order_type', 'fulfillment_mode',
    'customer_order_date', 'production_status', 'data_quality_status',
    'order_lock_status',
  ],
  rebuild_subscriptions: [
    'shopify_order_id', 'shopify_order_number',
    'customer_name', 'customer_email', 'customer_phone', 'source_channel', 'source_type',
    'stripe_subscription_id', 'stripe_customer_id', 'line_items', 'fulfillments',
    'total_price', 'subtotal', 'payment_status', 'fulfillment_method',
    'address_line1', 'address_line2', 'address_city', 'address_state',
    'address_postal_code', 'address_country', 'sync_status', 'last_sync_at', 'customer_order_date',
    'production_status', 'order_lock_status', 'customer_app_user_id', 'customer_notes', 'tags',
    'requested_delivery_date', 'delivery_notes',
  ],
  operations: [
    'production_status', 'fulfillment_status', 'assigned_delivery_date',
    'internal_notes', 'tags', 'sync_status', 'order_lock_status',
    'fulfillments', 'delivery_photo_url', 'delivery_drop_location', 'delivered_by', 'delivered_at',
    'fulfillment_method',
  ],
  // Hub Driver Portal and Customer App driver actions — same delivery fields as operations
  customer_app_driver: [
    'fulfillment_status', 'production_status',
    'delivered_at', 'delivered_by', 'delivery_photo_url', 'delivery_drop_location',
    'internal_notes', 'sync_status',
  ],
  admin: [
    // Admin can write anything
    '__all__',
  ],
  manual_recovery: [
    // Recovery can write most fields when repairing broken orders
    'shopify_order_id', 'shopify_order_number',
    'customer_name', 'customer_email', 'customer_phone', 'source_channel', 'source_type',
    'stripe_subscription_id', 'stripe_customer_id', 'stripe_checkout_session_id',
    'stripe_payment_intent_id', 'stripe_invoice_id', 'line_items', 'fulfillments',
    'total_price', 'subtotal', 'payment_status', 'fulfillment_method',
    'address_line1', 'address_line2', 'address_city', 'address_state',
    'address_postal_code', 'address_country', 'sync_status', 'repair_status',
    'repair_timestamp', 'repair_method', 'last_reconciliation_at', 'last_sync_at',
    'customer_order_date', 'production_status', 'order_lock_status',
  ],
};

// ── ALWAYS-SAFE FIELDS ───────────────────────────────────────────────────────
// Any source can update these regardless of ownership (used for internal tracking)
const ALWAYS_SAFE_FIELDS = ['sync_status', 'last_sync_at', 'stripe_event_id_applied', 'last_reconciliation_at'];

function normalizeTitle(title) {
  if (!title) return title;
  let t = title.replace(/^\d+\s*×\s*/, '').trim();
  t = t.replace(/\s*\(at\s+\$[\d.]+\s*\/\s*\w+\)/i, '').trim();
  t = t.replace(/\s*\(\$[\d.,]+.*?\)/i, '').trim();
  return t;
}

// Operational-only fields — these are legitimate targeted writes from operations/driver
// and should NEVER be flagged as unknown quality
const OPERATIONAL_FIELDS = new Set([
  'production_status', 'fulfillment_status', 'order_lock_status', 'assigned_delivery_date',
  'internal_notes', 'tags', 'sync_status', 'fulfillments', 'fulfillment_method',
  'delivery_photo_url', 'delivery_drop_location', 'delivered_by', 'delivered_at',
]);

function isUnknownQuality(data) {
  // Only flag as unknown quality if there are explicit signs of corruption/incomplete data
  // A small targeted update (e.g. only production_status) is NOT unknown quality
  const hasAnyIdentity = data.customer_email || data.stripe_subscription_id || data.stripe_checkout_session_id || data.customer_name;
  const hasExplicitUnknown = data.shopify_order_number === '#unknown' || data.shopify_order_number === '#UNKNOWN';
  
  // If ALL fields in the payload are operational fields, it's a legitimate targeted update
  const allFieldsAreOperational = Object.keys(data).every(k => OPERATIONAL_FIELDS.has(k));
  if (allFieldsAreOperational) return false;

  const isEmptyIdentityPayload = !hasAnyIdentity && Object.keys(data).length > 3; // More than 3 non-identity fields but no identity
  return hasExplicitUnknown || isEmptyIdentityPayload;
}

function getCompletenessScore(data) {
  let score = 0;
  if (data.customer_name && data.customer_name.trim()) score += 2;
  if (data.customer_email && data.customer_email.trim()) score += 2;
  if (data.line_items && data.line_items.length > 0) score += 2;
  if (data.total_price && data.total_price > 0) score += 1;
  if (data.address_line1 && data.address_line1.trim()) score += 1;
  if (data.stripe_subscription_id) score += 1;
  if (data.fulfillments && data.fulfillments.length > 0) score += 1;
  return Math.min(score, 10);
}

async function logSync(base44, params) {
  try {
    await base44.asServiceRole.entities.OrderSyncLog.create({
      sync_timestamp: new Date().toISOString(),
      sync_source: params.source,
      event_type: params.event_type || params.source,
      stripe_event_id: params.stripe_event_id || null,
      order_id: params.order_id || null,
      order_number: params.order_number || null,
      customer_email: params.customer_email || null,
      action: params.action,
      reason: params.reason || null,
      fields_updated: params.fields_updated || [],
      fields_rejected: params.fields_rejected || [],
      success: params.success !== false,
      error: params.error || null,
    });
  } catch (err) {
    console.error('[SAFE-SYNC] Log failed:', err.message);
  }
}

async function quarantine(base44, params) {
  try {
    // Build idempotency key: source + incident_type + customer + order identifier
    const orderIdent = params.existing_order_id || 
                       params.incoming_payload?.stripe_subscription_id || 
                       params.incoming_payload?.stripe_checkout_session_id || 
                       params.incoming_payload?.shopify_order_number ||
                       'unknown';
    const idempotencyKey = `${params.incoming_source}::${params.incident_type}::${params.customer_email || 'no-email'}::${orderIdent}`;
    
    // Check if this exact issue already exists in pending status
    const existing = await base44.asServiceRole.entities.OrderReviewQueue.filter({
      idempotency_key: idempotencyKey,
      status: 'pending',
    });
    
    if (existing && existing.length > 0) {
      // Update occurrence count instead of creating duplicate
      const entry = existing[0];
      await base44.asServiceRole.entities.OrderReviewQueue.update(entry.id, {
        occurrence_count: (entry.occurrence_count || 1) + 1,
        last_seen_at: new Date().toISOString(),
        issue_description: params.issue_description, // Keep latest description
      });
      console.log(`[SAFE-SYNC] Duplicate quarantine blocked for idempotency_key: ${idempotencyKey}. Updated occurrence_count to ${(entry.occurrence_count || 1) + 1}.`);
      return;
    }
    
    // New issue - create entry
    await base44.asServiceRole.entities.OrderReviewQueue.create({
      incident_type: params.incident_type,
      customer_email: params.customer_email || null,
      customer_name: params.customer_name || null,
      existing_order_id: params.existing_order_id || null,
      existing_order_number: params.existing_order_number || null,
      existing_order_type: params.existing_order_type || null,
      incoming_payload: params.incoming_payload || {},
      incoming_source: params.incoming_source,
      issue_description: params.issue_description,
      recommended_action: params.recommended_action || 'manual_review',
      status: 'pending',
      idempotency_key: idempotencyKey,
      occurrence_count: 1,
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[SAFE-SYNC] Quarantine failed:', err.message);
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    // ── INTERNAL FUNCTION AUTHORIZATION ─────────────────────────────────────
    // Allow trusted internal functions (rebuild_subscriptions) to call this gateway
    // without requiring user authentication. Validate via INTERNAL_FUNCTION_SECRET.
    const providedSecret = body._internalSecret;
    const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');
    const TRUSTED_INTERNAL_SOURCES = new Set(['rebuild_subscriptions', 'operations', 'manual_recovery']);
    const isInternalCall = providedSecret && internalSecret && providedSecret === internalSecret && TRUSTED_INTERNAL_SOURCES.has(body.source);
    
    if (!isInternalCall) {
      // External/public call — require valid user auth
      const userAuth = await base44.auth.me().catch(() => null);
      if (!userAuth) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
    } else {
      // Internal call authorized — log and proceed
      console.log(`[SAFE-SYNC] Internal call from ${body.source} authorized via internal secret`);
    }

    const {
      incomingData,     // Fields to write
      source,           // Who is writing: stripe_webhook | customer_app | rebuild_subscriptions | operations | admin | manual_recovery
      stripeEventId,    // For idempotency
      matchBy,          // How to find existing order: { stripe_subscription_id, stripe_checkout_session_id, stripe_payment_intent_id, internal_id, shopify_order_id }
    } = body;

    if (!incomingData || !source) {
      return Response.json({ error: 'incomingData and source required' }, { status: 400 });
    }

    const allowedFields = source === 'admin'
      ? null // admin can write anything
      : (FIELD_OWNERSHIP[source] || []);

    // ── STEP 1: FIND EXISTING ORDER ─────────────────────────────────────────
    let existingOrder = null;

    if (matchBy) {
      // Try each identifier in priority order
      const searchKeys = [
        ['stripe_subscription_id', matchBy.stripe_subscription_id],
        ['stripe_checkout_session_id', matchBy.stripe_checkout_session_id],
        ['stripe_payment_intent_id', matchBy.stripe_payment_intent_id],
        ['shopify_order_id', matchBy.shopify_order_id],
      ];

      for (const [field, value] of searchKeys) {
        if (!value) continue;
        const found = await base44.asServiceRole.entities.ShopifyOrder.filter({ [field]: value });
        if (found && found.length > 0) {
          existingOrder = found[0];
          break;
        }
      }

      // Fallback: match by internal ID — direct entity get, no list scan needed
      if (!existingOrder && matchBy.internal_id) {
        try {
          const found = await base44.asServiceRole.entities.ShopifyOrder.get(matchBy.internal_id);
          existingOrder = found || null;
        } catch (err) {
          console.error('[SAFE-SYNC] internal_id lookup failed:', err.message);
        }
      }

      // FINAL SAFETY NET: match by shopify_order_number before ever creating a new record.
      // Prevents duplicates when the same order arrives with a different shopify_order_id
      // (e.g. customer app sends internal ID one time, Stripe ID another time).
      if (!existingOrder && incomingData.shopify_order_number) {
        const byNumber = await base44.asServiceRole.entities.ShopifyOrder.filter({
          shopify_order_number: incomingData.shopify_order_number,
        });
        if (byNumber && byNumber.length > 0) {
          existingOrder = byNumber[0];
          console.log(`[SAFE-SYNC] Matched existing order by order_number ${incomingData.shopify_order_number} — preventing duplicate creation`);
        }
      }
    }

    // ── STEP 2: IDEMPOTENCY CHECK ────────────────────────────────────────────
    if (stripeEventId) {
      if (existingOrder && existingOrder.stripe_event_id_applied === stripeEventId) {
        console.log('[SAFE-SYNC] Duplicate event, skipping:', stripeEventId);
        return Response.json({ status: 'skipped', reason: 'duplicate_event', order_id: existingOrder.id });
      }
      // Mark stripeEventId for idempotency on future re-submits (new AND existing orders)
      incomingData.stripe_event_id_applied = stripeEventId;
      if (!existingOrder) {
        console.log('[SAFE-SYNC] Marked new order with stripe_event_id_applied for idempotency:', stripeEventId);
      } else {
        console.log('[SAFE-SYNC] Updated existing order stripe_event_id_applied for future idempotency:', stripeEventId);
      }
    }

    // ── STEP 2.5: FAKE/TEST STRIPE ID GUARDRAIL ─────────────────────────────
    // Reject payloads from customer_app with obviously fake/placeholder Stripe IDs.
    // These are test/idempotency validation payloads that must never create production records.
    if (source === 'customer_app' && incomingData.payment_status === 'paid') {
      const sessionId = incomingData.stripe_checkout_session_id || '';
      const intentId = incomingData.stripe_payment_intent_id || '';

      const isFakeSession = sessionId && (
        sessionId.includes('UNIQUE') ||
        sessionId.includes('_TEST_') ||
        sessionId.includes('test_') ||
        sessionId.includes('fake_') ||
        sessionId.toLowerCase().includes('placeholder') ||
        sessionId === 'cs_live_UNIQUE_SESSION_ID_FOR_SECOND_ORDER' ||
        // Real Stripe live sessions are exactly: cs_live_ + 58 base62 chars (~66 total)
        // Anything suspiciously short or with non-base62 chars after the prefix is fake
        (sessionId.startsWith('cs_live_') && sessionId.length < 30)
      );

      const isFakeIntent = intentId && (
        intentId.includes('UNIQUE') ||
        intentId.includes('_TEST_') ||
        intentId.includes('test_') ||
        intentId.includes('fake_') ||
        intentId.toLowerCase().includes('placeholder') ||
        intentId === 'pi_UNIQUE_INTENT_FOR_SECOND'
      );

      if (isFakeSession || isFakeIntent) {
        console.error(`[SAFE-SYNC] GUARDRAIL: Rejected fake/test Stripe ID from customer_app. session=${sessionId} intent=${intentId}`);
        await logSync(base44, {
          source, order_number: incomingData.shopify_order_number,
          customer_email: incomingData.customer_email, action: 'rejected',
          reason: 'fake_stripe_id_guardrail', success: false,
          error: `Fake/test Stripe ID detected: session=${sessionId} intent=${intentId}`,
        });
        return Response.json({ status: 'rejected', reason: 'fake_stripe_id_detected', detail: 'Test/placeholder Stripe IDs are not permitted in production. Use real Stripe session or payment intent IDs.' }, { status: 422 });
      }
    }

    // ── STEP 3: UNKNOWN QUALITY GATE ────────────────────────────────────────
    // Admin writes matched by internal_id bypass this gate entirely — the order is
    // already resolved above via base44.entities.ShopifyOrder.get(matchBy.internal_id).
    const adminInternalIdWrite = source === 'admin' && matchBy?.internal_id && existingOrder;
    if (!adminInternalIdWrite && isUnknownQuality(incomingData)) {
      const existingScore = existingOrder ? getCompletenessScore(existingOrder) : 0;
      if (existingOrder && existingScore >= 5) {
        await quarantine(base44, {
          incident_type: 'unknown_order_attempt',
          customer_email: incomingData.customer_email || existingOrder.customer_email,
          customer_name: incomingData.customer_name || existingOrder.customer_name,
          existing_order_id: existingOrder.id,
          existing_order_number: existingOrder.shopify_order_number,
          existing_order_type: existingOrder.source_channel,
          incoming_payload: incomingData,
          incoming_source: source,
          issue_description: `Unknown/incomplete payload (score ${getCompletenessScore(incomingData)}/10) attempted to overwrite verified order. Blocked by safeSyncOrderUpdate.`,
          recommended_action: 'reject',
        });
        await logSync(base44, {
          source, order_id: existingOrder.id, order_number: existingOrder.shopify_order_number,
          customer_email: existingOrder.customer_email, action: 'rejected',
          reason: 'unknown_quality_blocked', success: false,
        });
        return Response.json({ status: 'rejected', reason: 'unknown_quality_would_overwrite_verified_order' });
      }
      // If no existing order or existing is also low quality, quarantine and stop
      if (!existingOrder) {
        await quarantine(base44, {
          incident_type: 'unknown_order_attempt',
          customer_email: incomingData.customer_email || null,
          incoming_payload: incomingData,
          incoming_source: source,
          issue_description: `New order with unknown quality rejected. Source: ${source}`,
          recommended_action: 'manual_review',
        });
        return Response.json({ status: 'rejected', reason: 'unknown_quality_new_order' });
      }
    }

    // ── STEP 3.5: MINIMUM QUALITY FOR NEW ORDERS ────────────────────────────
    // New orders must have minimum completeness to avoid corrupted records
    if (!existingOrder && source !== 'admin') {
      const incomingScore = getCompletenessScore(incomingData);
      const minScore = source === 'rebuild_subscriptions' ? 6 : 5; // Subscriptions need more data
      if (incomingScore < minScore) {
        // Quarantine function now handles deduplication via idempotency_key automatically
        await quarantine(base44, {
          incident_type: 'low_quality_new_order',
          customer_email: incomingData.customer_email || null,
          customer_name: incomingData.customer_name || null,
          incoming_payload: incomingData,
          incoming_source: source,
          issue_description: `New order rejected — score ${incomingScore}/${minScore}. Missing: ${!incomingData.customer_name ? 'customer_name ' : ''}${!incomingData.address_line1 ? 'address_line1' : ''}`,
          recommended_action: 'manual_review',
        });
        return Response.json({ status: 'rejected', reason: `low_quality_new_order_score_${incomingScore}_below_${minScore}` });
      }
    }

    // ── STEP 4: SUBSCRIPTION HARD LOCK ──────────────────────────────────────
    if (existingOrder && (existingOrder.source_channel === 'subscription' || existingOrder.stripe_subscription_id)) {
      // Never downgrade source_channel from subscription
      if (incomingData.source_channel && incomingData.source_channel !== 'subscription') {
        await quarantine(base44, {
          incident_type: 'subscription_downgrade_attempt',
          customer_email: existingOrder.customer_email,
          customer_name: existingOrder.customer_name,
          existing_order_id: existingOrder.id,
          existing_order_number: existingOrder.shopify_order_number,
          existing_order_type: 'subscription',
          incoming_payload: incomingData,
          incoming_source: source,
          issue_description: `Attempted to change subscription order channel to "${incomingData.source_channel}" via ${source}. Blocked.`,
          recommended_action: 'reject',
        });
        // Force keep subscription
        incomingData.source_channel = 'subscription';
      }

      // Never erase stripe_subscription_id
      if (incomingData.stripe_subscription_id === null || incomingData.stripe_subscription_id === '') {
        incomingData.stripe_subscription_id = existingOrder.stripe_subscription_id;
      }

      // Never erase line_items if existing has them
      if ((!incomingData.line_items || incomingData.line_items.length === 0) && existingOrder.line_items?.length > 0) {
        incomingData.line_items = existingOrder.line_items;
      }

      // Never erase fulfillments if existing has them
      if ((!incomingData.fulfillments || incomingData.fulfillments.length === 0) && existingOrder.fulfillments?.length > 0) {
        incomingData.fulfillments = existingOrder.fulfillments;
      }

      // Always force subscription channel
      incomingData.source_channel = 'subscription';
    }

    // ── STEP 3.9: MANUAL OVERRIDE GUARD ────────────────────────────────────
    // If an existing order has manual_override=true, block customer_app and
    // rebuild_subscriptions from overwriting status fields and delivery date.
    // stripe_webhook CAN still overwrite payment_status (refund/cancel events take priority).
    // admin source always bypasses this guard.
    const MANUAL_PROTECTED_FIELDS = [
      'production_status', 'fulfillment_status', 'order_lock_status',
      'assigned_delivery_date',
      'address_line1', 'address_line2', 'address_city', 'address_state', 'address_postal_code',
      'tags',
      // Always preserve the override flag itself so CA syncs cannot clear it
      'manual_override', 'manual_override_at', 'manual_override_by',
      'internal_notes', 'audit_trail',
    ];
    if (existingOrder?.manual_override === true && ['customer_app', 'rebuild_subscriptions'].includes(source)) {
      const blocked = [];
      for (const f of MANUAL_PROTECTED_FIELDS) {
        if (f in incomingData) {
          delete incomingData[f];
          blocked.push(f);
        }
      }
      if (blocked.length > 0) {
        console.log(`[SAFE-SYNC] manual_override guard: blocked ${source} from overwriting [${blocked.join(', ')}] on ${existingOrder.shopify_order_number}`);
      }
    }

    // ── STEP 3.95: ADMIN WRITE — capture audit trail entry ──────────────────
    // Every admin manual save appends an audit_trail entry to the order record.
    if (source === 'admin' && existingOrder && incomingData.manual_override === true) {
      const changedFields = {};
      for (const f of ['production_status', 'payment_status', 'fulfillment_method', 'assigned_delivery_date', 'internal_notes', 'customer_notes']) {
        if (f in incomingData && incomingData[f] !== existingOrder[f]) {
          changedFields[f] = { from: existingOrder[f], to: incomingData[f] };
        }
      }
      if (Object.keys(changedFields).length > 0) {
        const existingTrail = Array.isArray(existingOrder.audit_trail) ? existingOrder.audit_trail : [];
        incomingData.audit_trail = [
          ...existingTrail,
          {
            timestamp: incomingData.manual_override_at || new Date().toISOString(),
            action: 'ManualAdminEdit',
            performed_by: incomingData.manual_override_by || 'admin',
            before: Object.fromEntries(Object.entries(changedFields).map(([k, v]) => [k, v.from])),
            after: Object.fromEntries(Object.entries(changedFields).map(([k, v]) => [k, v.to])),
            reason: 'Manual admin edit via Orders UI',
          },
        ];
      }
    }

    // ── STEP 4.5: PAYMENT STATUS GUARDRAILS ─────────────────────────────────
    if (existingOrder && source !== 'admin') {
      const incomingPayment = incomingData.payment_status;
      const existingPayment = existingOrder.payment_status;

      // RULE A: Never downgrade paid → pending/null/unpaid once payment is confirmed.
      // Once an order is paid, no source (including customer_app polling) can revert it.
      // The customer app may send stale payment_status=pending on repeat syncs if their
      // local record hasn't updated — this guard permanently protects the paid status.
      if (existingPayment === 'paid') {
        const DOWNGRADE_VALUES = ['pending', 'unpaid', null, undefined, ''];
        const isDowngrade = incomingPayment !== undefined && DOWNGRADE_VALUES.includes(incomingPayment);
        if (isDowngrade) {
          console.warn(`[SAFE-SYNC] GUARDRAIL: Blocked payment_status downgrade paid→"${incomingPayment}" on ${existingOrder.shopify_order_number} from source:${source}. Preserving paid.`);
          delete incomingData.payment_status;
        }
      }

      // RULE B: Always allow upgrading pending/null → paid regardless of lock level.
      // Payment confirmation can legitimately arrive after production has started.
      if (incomingPayment === 'paid' && existingPayment !== 'paid') {
        // Force payment_status=paid through — will be preserved even if lock would otherwise freeze it
        incomingData._forcePaymentPaid = true;
        console.log(`[SAFE-SYNC] Allowing payment_status upgrade ${existingPayment || 'null'} → paid for ${existingOrder.shopify_order_number} (lock: ${existingOrder.order_lock_status})`);
      }
    }
    const _forcePaymentPaid = incomingData._forcePaymentPaid || false;
    delete incomingData._forcePaymentPaid;

    // ── STEP 5: ORDER LOCK ENFORCEMENT ──────────────────────────────────────
    const lockStatus = existingOrder?.order_lock_status || 'unlocked';
    const frozenFields = LOCK_FROZEN_FIELDS[lockStatus] || [];
    const fieldsRejected = [];

    if (frozenFields.length > 0 && source !== 'admin') {
      for (const field of frozenFields) {
        // CARVE-OUT: Never freeze payment_status when upgrading pending → paid (RULE B from Step 4.5)
        if (field === 'payment_status' && _forcePaymentPaid) continue;

        if (field in incomingData && existingOrder[field] !== undefined && existingOrder[field] !== null && existingOrder[field] !== '') {
          // Field is frozen and existing has a value — reject the incoming value
          delete incomingData[field];
          fieldsRejected.push(field);
        }
      }
      if (fieldsRejected.length > 0) {
        console.log(`[SAFE-SYNC] Lock ${lockStatus} rejected fields from ${source}:`, fieldsRejected.join(', '));
      }
    }

    // Customer App can initialize these fields when creating the Hub mirror, but
    // existing Hub orders own operational/control state after creation.
    if (existingOrder && source === 'customer_app') {
      const blockedOpsFields = ['production_status', 'order_lock_status', 'data_quality_status'];
      const blockedByOpsGuard = [];

      for (const field of blockedOpsFields) {
        if (field in incomingData) {
          delete incomingData[field];
          blockedByOpsGuard.push(field);
        }
      }

      if (blockedByOpsGuard.length > 0) {
        fieldsRejected.push(...blockedByOpsGuard);
        console.log(`[safeSyncOrderUpdate] customer_app operational ownership guard blocked fields: ${blockedByOpsGuard.join(', ')}`);
      }
    }

    // ── STEP 6: FIELD OWNERSHIP FILTER ──────────────────────────────────────
    const fieldsFiltered = [];
    if (allowedFields !== null) {
      for (const field of Object.keys(incomingData)) {
        if (!allowedFields.includes(field) && !ALWAYS_SAFE_FIELDS.includes(field)) {
          delete incomingData[field];
          fieldsFiltered.push(field);
        }
      }
      if (fieldsFiltered.length > 0) {
        console.log(`[SAFE-SYNC] Source ${source} filtered unauthorized fields:`, fieldsFiltered.join(', '));
      }
    }

    // ── STEP 7: NORMALIZE LINE ITEM TITLES ──────────────────────────────────
    if (incomingData.line_items && Array.isArray(incomingData.line_items)) {
      incomingData.line_items = incomingData.line_items.map(item => ({
        ...item,
        title: normalizeTitle(item.title),
      }));
    }

    // ── STEP 8: PRESERVE CRITICAL EXISTING FIELDS IF INCOMING IS EMPTY ──────
     if (existingOrder) {
       const preserveIfEmpty = ['customer_name', 'customer_phone', 'fulfillments', 'internal_notes', 'assigned_delivery_date', 'production_date', 'selected_delivery_date', 'delivery_window_label', 'production_status', 'order_lock_status', 'total_price', 'subtotal', 'delivery_fee', 'manual_override', 'manual_override_at', 'manual_override_by', 'audit_trail'];
       for (const field of preserveIfEmpty) {
         const incomingVal = incomingData[field];
         const existingVal = existingOrder[field];
         // Preserve existing if incoming is empty/zero/null and existing has a real value
         const incomingEmpty = incomingVal === undefined || incomingVal === null || incomingVal === '' || incomingVal === 0;
         const existingHasValue = existingVal !== undefined && existingVal !== null && existingVal !== '' && existingVal !== 0;
         if (incomingEmpty && existingHasValue) {
           incomingData[field] = existingVal;
         }
       }
         // Never downgrade production_status
       const meaningfulStatuses = ['awaiting_production', 'in_production', 'bottled', 'labeled', 'qc_checked', 'packed', 'in_cold_storage', 'assigned_for_pickup', 'assigned_for_delivery', 'fulfilled', 'canceled', 'refunded'];
       if (incomingData.production_status === 'new' && meaningfulStatuses.includes(existingOrder.production_status)) {
         incomingData.production_status = existingOrder.production_status;
       }

       // ADDRESS BLANK-OVERWRITE PROTECTION:
       // If existing order has complete address data and incoming has blank address fields,
       // preserve the existing address. Only allow overwrite when incoming is also complete.
       const existingAddrComplete = !!(existingOrder.address_line1 && existingOrder.address_city && existingOrder.address_state);
       const incomingAddrPresent = !!(incomingData.address_line1 !== undefined || incomingData.address_city !== undefined);
       if (existingAddrComplete && incomingAddrPresent) {
         const incomingAddrComplete = !!(incomingData.address_line1 && incomingData.address_city && incomingData.address_state);
         if (!incomingAddrComplete) {
           // Incoming has blank/empty address — preserve existing complete address
           console.log(`[SAFE-SYNC] Address blank-overwrite protection: preserving existing complete address on ${existingOrder.shopify_order_number} (incoming address incomplete from ${source})`);
           incomingData.address_line1 = existingOrder.address_line1;
           incomingData.address_line2 = existingOrder.address_line2 || incomingData.address_line2;
           incomingData.address_city = existingOrder.address_city;
           incomingData.address_state = existingOrder.address_state;
           incomingData.address_postal_code = existingOrder.address_postal_code || incomingData.address_postal_code;
           incomingData.address_country = existingOrder.address_country || incomingData.address_country;
         }
       }
     }

    // ── STEP 8.1: ONE-TIME ORDER LINE_ITEMS GUARDRAIL ──────────────────────────
    // CRITICAL: For one_time + single_delivery orders, line_items is the customer-facing product identity.
    // Production recalculation may update fulfillments (internal components) but MUST NOT replace line_items.
    // line_items = what customer ordered; fulfillments.items = internal decomposition for production.
    if (existingOrder && existingOrder.order_type === 'one_time' && existingOrder.fulfillment_mode === 'single_delivery' && source !== 'customer_app') {
      // Only stripe_webhook and manual_recovery can update line_items on one-time orders (order correction scenarios)
      // All other sources (operations, rebuild_subscriptions) must NOT overwrite line_items
      if (!['stripe_webhook', 'manual_recovery', 'admin'].includes(source)) {
        if (incomingData.line_items && existingOrder.line_items?.length > 0) {
          const incomingTitles = (incomingData.line_items || []).map(i => i.title).sort().join(',');
          const existingTitles = (existingOrder.line_items || []).map(i => i.title).sort().join(',');
          if (incomingTitles !== existingTitles) {
            console.warn(`[SAFE-SYNC] GUARDRAIL: ${source} attempted to replace line_items on one-time order ${existingOrder.id}. This is forbidden. Preserving existing line_items.`);
            incomingData.line_items = existingOrder.line_items;
            fieldsRejected.push('line_items');
          }
        }
      }
    }

    // ── STEP 8.2: DELIVERY ADDRESS QUALITY GATE ────────────────────────────
    // CRITICAL: All delivery orders MUST have complete address before entering Driver Portal
    // POS orders are fulfilled on-site and NEVER need a delivery address — skip entirely.
    const isPOSOrder = incomingData.source_type === 'shopify_pos' ||
                       incomingData.source_channel === 'pos' ||
                       incomingData.order_type === 'pos' ||
                       incomingData.fulfillment_method === 'pos' ||
                       existingOrder?.source_type === 'shopify_pos' ||
                       existingOrder?.source_channel === 'pos' ||
                       existingOrder?.order_type === 'pos';

    if (isPOSOrder) {
      console.log(`[SAFE-SYNC] POS order detected — skipping address gate, production, delivery, and fulfillment task creation.`);
      // Force POS fields to ensure consistency even if caller forgot some
      incomingData.production_status = incomingData.production_status || 'not_required';
      incomingData.order_lock_status = incomingData.order_lock_status || 'fulfilled';
      incomingData.fulfillment_status = incomingData.fulfillment_status || 'fulfilled';
      incomingData.payment_status = incomingData.payment_status || 'paid';
      incomingData.source_channel = 'pos';
      incomingData.source_type = 'shopify_pos';
    }

    const isDeliveryOrder = !isPOSOrder && (incomingData.fulfillment_method === 'delivery' || existingOrder?.fulfillment_method === 'delivery');

    if (isDeliveryOrder) {
      const hasParentAddress = incomingData.address_line1 && incomingData.address_city && 
                               incomingData.address_state && incomingData.address_postal_code;
      const hasFulfillmentAddress = (incomingData.fulfillments?.[0]?.address_line1 && 
                                     incomingData.fulfillments[0].address_city && 
                                     incomingData.fulfillments[0].address_state && 
                                     incomingData.fulfillments[0].address_postal_code) || false;

      // If incoming has neither, check if we can preserve from existing or fallback to FulfillmentTask
      if (!hasParentAddress && !hasFulfillmentAddress && existingOrder) {
        const existingParentAddress = existingOrder.address_line1 && existingOrder.address_city && 
                                      existingOrder.address_state && existingOrder.address_postal_code;
        const existingFulfillmentAddress = (existingOrder.fulfillments?.[0]?.address_line1 && 
                                            existingOrder.fulfillments[0].address_city && 
                                            existingOrder.fulfillments[0].address_state && 
                                            existingOrder.fulfillments[0].address_postal_code) || false;

        // Preserve existing address if available
        if (existingParentAddress) {
          incomingData.address_line1 = existingOrder.address_line1;
          incomingData.address_line2 = existingOrder.address_line2 || incomingData.address_line2;
          incomingData.address_city = existingOrder.address_city;
          incomingData.address_state = existingOrder.address_state;
          incomingData.address_postal_code = existingOrder.address_postal_code;
          incomingData.address_country = existingOrder.address_country || incomingData.address_country;
        } else if (existingFulfillmentAddress && incomingData.fulfillments?.length > 0) {
          incomingData.address_line1 = existingOrder.fulfillments[0].address_line1;
          incomingData.address_line2 = existingOrder.fulfillments[0].address_line2 || incomingData.address_line2;
          incomingData.address_city = existingOrder.fulfillments[0].address_city;
          incomingData.address_state = existingOrder.fulfillments[0].address_state;
          incomingData.address_postal_code = existingOrder.fulfillments[0].address_postal_code;
          incomingData.address_country = existingOrder.fulfillments[0].address_country || incomingData.address_country;
        } else {
          // FALLBACK: Check FulfillmentTask for this order's delivery date
          try {
            const deliveryDate = incomingData.requested_delivery_date || incomingData.assigned_delivery_date || 
                                (incomingData.fulfillments?.[0]?.delivery_date);
            if (existingOrder?.id && deliveryDate) {
              const ftasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
                order_id: existingOrder.id,
                scheduled_date: deliveryDate,
              });
              if (ftasks && ftasks.length > 0 && ftasks[0].address) {
                // Parse address from FulfillmentTask format: "line1, city, state"
                const addrParts = ftasks[0].address.split(',').map(p => p.trim());
                if (addrParts.length >= 3) {
                  incomingData.address_line1 = addrParts[0];
                  incomingData.address_city = addrParts[1];
                  incomingData.address_state = addrParts[2];
                  // FulfillmentTask doesn't have zip, so keep incoming if present
                  if (!incomingData.address_postal_code) {
                    incomingData.address_postal_code = addrParts[3] || '';
                  }
                  console.log(`[SAFE-SYNC] Recovered address from FulfillmentTask for order ${existingOrder.id}`);
                }
              }
            }
          } catch (err) {
            console.warn(`[SAFE-SYNC] FulfillmentTask fallback failed (non-critical): ${err.message}`);
          }
        }
      }

      // FINAL GATE: if still no address after all attempts, only hard-block NEW order creation.
      // For UPDATES to existing orders, allow the write to proceed — blocking an update just because
      // an address is still missing makes the problem permanently unresolvable (address can never sync in).
      const finalHasParentAddress = incomingData.address_line1 && incomingData.address_city && 
                                    incomingData.address_state && incomingData.address_postal_code;
      const finalHasFulfillmentAddress = (incomingData.fulfillments?.[0]?.address_line1 && 
                                          incomingData.fulfillments[0].address_city && 
                                          incomingData.fulfillments[0].address_state && 
                                          incomingData.fulfillments[0].address_postal_code) || false;

      if (!finalHasParentAddress && !finalHasFulfillmentAddress && source !== 'admin') {
        if (!existingOrder) {
          // Only hard-block NEW order creation with no address
          console.error(`[SAFE-SYNC] NEW delivery order from ${incomingData.customer_email} missing complete address — rejecting creation`);
          await quarantine(base44, {
            incident_type: 'missing_customer_info',
            customer_email: incomingData.customer_email || null,
            customer_name: incomingData.customer_name || null,
            existing_order_id: null,
            existing_order_number: incomingData.shopify_order_number,
            incoming_payload: incomingData,
            incoming_source: source,
            issue_description: `New delivery order creation rejected — missing complete address.`,
            recommended_action: 'manual_review',
          });
          return Response.json({ status: 'rejected', reason: 'delivery_order_missing_address' }, { status: 400 });
        } else {
          // For existing orders: log a warning but ALLOW the update to proceed so address can sync in later
          console.warn(`[SAFE-SYNC] Delivery order ${existingOrder.id} still missing address — allowing update to proceed so address can sync in`);
        }
      }
    }

    // ── STEP 8.5: PRODUCTION SNAPSHOT LOCK ──────────────────────────────────
    // When transitioning TO production_scheduled: capture snapshot of line_items + fulfillments
    // When order is already production_scheduled or beyond: compare against snapshot and block mismatches
    const snapshotStatuses = ['production_scheduled', 'in_production', 'out_for_delivery', 'fulfilled'];
    const isEnteringProductionScheduled = incomingData.production_status === 'production_scheduled' &&
      existingOrder && existingOrder.production_status !== 'production_scheduled';

    if (isEnteringProductionScheduled && source !== 'admin') {
      // Capture snapshot on transition into production_scheduled
      incomingData.production_snapshot = {
        line_items: existingOrder.line_items || [],
        fulfillments: (existingOrder.fulfillments || []).map(f => ({
          fulfillment_number: f.fulfillment_number,
          delivery_date: f.delivery_date,
          production_date: f.production_date,
          items: f.items || [],
        })),
        total_price: existingOrder.total_price,
        captured_at: new Date().toISOString(),
      };
      console.log(`[SAFE-SYNC] Production snapshot captured for order ${existingOrder.id}`);
    } else if (existingOrder?.production_snapshot && snapshotStatuses.includes(lockStatus) && source !== 'admin') {
      // Guard: if incoming tries to change line_items or fulfillments, compare against snapshot
      const snap = existingOrder.production_snapshot;
      if (incomingData.line_items && snap.line_items) {
        const snapTitles = snap.line_items.map(i => i.title).sort().join(',');
        const incomingTitles = incomingData.line_items.map(i => i.title).sort().join(',');
        if (snapTitles !== incomingTitles) {
          await quarantine(base44, {
            incident_type: 'overwrite_rejection',
            customer_email: existingOrder.customer_email,
            customer_name: existingOrder.customer_name,
            existing_order_id: existingOrder.id,
            existing_order_number: existingOrder.shopify_order_number,
            existing_order_type: existingOrder.source_channel,
            incoming_payload: { line_items: incomingData.line_items, snapshot_line_items: snap.line_items },
            incoming_source: source,
            issue_description: `Production snapshot mismatch: incoming line_items differ from snapshot captured at ${snap.captured_at}. Blocked by snapshot lock.`,
            recommended_action: 'manual_review',
          });
          delete incomingData.line_items;
          console.warn(`[SAFE-SYNC] Snapshot lock blocked line_items overwrite for order ${existingOrder.id}`);
        }
      }
      if (incomingData.fulfillments && snap.fulfillments && snap.fulfillments.length > 0) {
        if (incomingData.fulfillments.length !== snap.fulfillments.length) {
          await quarantine(base44, {
            incident_type: 'overwrite_rejection',
            customer_email: existingOrder.customer_email,
            customer_name: existingOrder.customer_name,
            existing_order_id: existingOrder.id,
            existing_order_number: existingOrder.shopify_order_number,
            existing_order_type: existingOrder.source_channel,
            incoming_payload: { fulfillment_count: incomingData.fulfillments.length, snapshot_count: snap.fulfillments.length },
            incoming_source: source,
            issue_description: `Production snapshot mismatch: incoming has ${incomingData.fulfillments.length} fulfillments vs snapshot ${snap.fulfillments.length}. Blocked.`,
            recommended_action: 'manual_review',
          });
          delete incomingData.fulfillments;
          console.warn(`[SAFE-SYNC] Snapshot lock blocked fulfillments overwrite for order ${existingOrder.id}`);
        }
      }
    }

    // ── STEP 8.9: GENERATE SHOPIFY_ORDER_ID FOR CUSTOMER APP STRIPE ORDERS ─────
    // Customer App Stripe orders may not have a real shopify_order_id.
    // Generate stable internal fallback: customer_app:{order_number} or stripe_checkout:{session_id}
    if (!existingOrder && !incomingData.shopify_order_id && source === 'customer_app') {
      if (incomingData.stripe_checkout_session_id) {
        incomingData.shopify_order_id = `stripe_checkout:${incomingData.stripe_checkout_session_id}`;
      } else if (incomingData.stripe_payment_intent_id) {
        incomingData.shopify_order_id = `stripe_payment_intent:${incomingData.stripe_payment_intent_id}`;
      } else if (incomingData.shopify_order_number) {
        incomingData.shopify_order_id = `customer_app:${incomingData.shopify_order_number}`;
      }
      if (incomingData.shopify_order_id) {
        console.log(`[SAFE-SYNC] Generated shopify_order_id for customer_app order: ${incomingData.shopify_order_id}`);
      }
    }

    // ── STEP 9: WRITE ────────────────────────────────────────────────────────
    let writtenOrder;
    const fieldsWritten = Object.keys(incomingData);

    if (existingOrder) {
      await base44.asServiceRole.entities.ShopifyOrder.update(existingOrder.id, incomingData);
      writtenOrder = { id: existingOrder.id, ...incomingData };
    } else {
      // Creating new order — ensure required fields
      if (!incomingData.customer_email) {
        return Response.json({ status: 'rejected', reason: 'missing_email_for_new_order' }, { status: 400 });
      }

      // Require shopify_order_number for new orders (visible order number)
      if (!incomingData.shopify_order_number) {
        return Response.json({ status: 'rejected', reason: 'missing_order_number_for_new_order' }, { status: 400 });
      }

      // Require shopify_order_id for new orders (internal ID)
      // Customer App Stripe orders should have generated one in STEP 8.9
      if (!incomingData.shopify_order_id) {
        return Response.json({ status: 'rejected', reason: 'missing_shopify_order_id_for_new_order' }, { status: 400 });
      }

      // Auto-set order_type and fulfillment_mode for new orders if not provided
      if (!incomingData.order_type) {
        if (incomingData.source_channel === 'subscription' || incomingData.stripe_subscription_id) {
          incomingData.order_type = 'subscription';
        } else if (incomingData.source_channel === 'pos' || incomingData.fulfillment_method === 'pos') {
          incomingData.order_type = 'pos';
        } else {
          incomingData.order_type = 'one_time';
        }
      }

      if (!incomingData.fulfillment_mode) {
        incomingData.fulfillment_mode = incomingData.order_type === 'subscription' ? 'multi_delivery' : 'single_delivery';
      }

      writtenOrder = await base44.asServiceRole.entities.ShopifyOrder.create(incomingData);
    }

    // ── STEP 10: AUDIT LOG ───────────────────────────────────────────────────
    // Log creates, Stripe webhooks, rejected fields, admin writes, and customer_app (skip only unchanged routine updates)
    const shouldLog = !existingOrder || stripeEventId || fieldsRejected.length > 0 || fieldsFiltered.length > 0 || source === 'stripe_webhook' || source === 'admin';
    if (shouldLog) {
      await logSync(base44, {
        source,
        stripe_event_id: stripeEventId || null,
        order_id: writtenOrder.id,
        order_number: writtenOrder.shopify_order_number || incomingData.shopify_order_number,
        customer_email: writtenOrder.customer_email || incomingData.customer_email,
        action: existingOrder ? 'updated' : 'created',
        reason: `source:${source}, lock:${lockStatus}`,
        fields_updated: fieldsWritten,
        fields_rejected: [...fieldsRejected, ...fieldsFiltered],
        success: true,
      });
    }

    return Response.json({
      status: 'success',
      action: existingOrder ? 'updated' : 'created',
      order_id: writtenOrder.id,
      fields_written: fieldsWritten.length,
      fields_rejected: fieldsRejected.length + fieldsFiltered.length,
      lock_status: lockStatus,
    });

  } catch (error) {
    console.error('[SAFE-SYNC] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
