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
    'stripe_subscription_id', 'line_items', 'fulfillments'],
  in_production: ['customer_name', 'customer_email', 'customer_phone', 'source_channel',
    'stripe_subscription_id', 'line_items', 'fulfillments', 'total_price', 'subtotal'],
  out_for_delivery: ['customer_name', 'customer_email', 'customer_phone', 'source_channel',
    'stripe_subscription_id', 'line_items', 'fulfillments', 'total_price', 'subtotal',
    'address_line1', 'address_line2', 'address_city', 'address_state', 'address_postal_code', 'address_country'],
  fulfilled: ['customer_name', 'customer_email', 'customer_phone', 'source_channel',
    'stripe_subscription_id', 'line_items', 'fulfillments', 'total_price', 'subtotal',
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
    'requested_delivery_date', 'delivery_notes', 'fulfillment_method',
    'line_items', 'total_price', 'subtotal', 'tags', 'sync_status', 'last_sync_at',
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
// Any source can update these regardless of ownership
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
    });
  } catch (err) {
    console.error('[SAFE-SYNC] Quarantine failed:', err.message);
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

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
    if (stripeEventId && existingOrder) {
      if (existingOrder.stripe_event_id_applied === stripeEventId) {
        console.log('[SAFE-SYNC] Duplicate event, skipping:', stripeEventId);
        return Response.json({ status: 'skipped', reason: 'duplicate_event', order_id: existingOrder.id });
      }
    }

    // ── STEP 3: UNKNOWN QUALITY GATE ────────────────────────────────────────
    if (isUnknownQuality(incomingData)) {
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
        await quarantine(base44, {
          incident_type: 'low_quality_new_order',
          customer_email: incomingData.customer_email || null,
          customer_name: incomingData.customer_name || null,
          incoming_payload: incomingData,
          incoming_source: source,
          issue_description: `New order rejected — completeness score ${incomingScore}/${minScore} from ${source}. Missing critical fields.`,
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

    // ── STEP 5: ORDER LOCK ENFORCEMENT ──────────────────────────────────────
    const lockStatus = existingOrder?.order_lock_status || 'unlocked';
    const frozenFields = LOCK_FROZEN_FIELDS[lockStatus] || [];
    const fieldsRejected = [];

    if (frozenFields.length > 0 && source !== 'admin') {
      for (const field of frozenFields) {
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
      const preserveIfEmpty = ['customer_name', 'customer_phone', 'fulfillments', 'internal_notes', 'assigned_delivery_date', 'production_status', 'order_lock_status', 'total_price', 'subtotal'];
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
      writtenOrder = await base44.asServiceRole.entities.ShopifyOrder.create(incomingData);
    }

    // ── STEP 10: AUDIT LOG ───────────────────────────────────────────────────
    // Only log creates, Stripe webhook events, or writes with rejections — skip routine customer_app updates to reduce credits
    const shouldLog = !existingOrder || stripeEventId || fieldsRejected.length > 0 || fieldsFiltered.length > 0 || source === 'stripe_webhook';
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