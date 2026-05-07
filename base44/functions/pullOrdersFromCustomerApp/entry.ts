import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY'), { apiVersion: '2023-10-16' });

// ── PRODUCTION DATE DERIVATION ───────────────────────────────────────────────
// Derive production_date from assigned_delivery_date using Hub production rules.
// Production occurs Tue/Fri/Sat (day before delivery, adjusted for production day).
function deriveProductionDate(deliveryDateStr) {
  if (!deliveryDateStr) return null;
  const PRODUCTION_DAYS_DOW = { 2: true, 5: true, 6: true }; // Tue, Fri, Sat
  const d = new Date(deliveryDateStr + 'T00:00:00');
  for (let i = 1; i <= 7; i++) {
    const check = new Date(d);
    check.setDate(d.getDate() - i);
    if (PRODUCTION_DAYS_DOW[check.getDay()]) {
      return check.toISOString().split('T')[0];
    }
  }
  // Fallback: simple day before
  const fallback = new Date(d);
  fallback.setDate(d.getDate() - 1);
  return fallback.toISOString().split('T')[0];
}

// ── STRIPE HYDRATION FALLBACK ────────────────────────────────────────────────
// When a CA order arrives with missing address/items/delivery fields but has a
// stripe_checkout_session_id, fetch from Stripe and hydrate the missing fields.
// This prevents the race condition where Hub pulls the CA record before address
// hydration completes on the CA side (root cause of NV-MOT59U9C manual recovery).
async function hydrateFromStripe(ord) {
  const result = {};
  try {
    if (!ord.stripe_checkout_session_id) return result;

    const session = await stripe.checkout.sessions.retrieve(ord.stripe_checkout_session_id, {
      expand: ['line_items', 'customer', 'payment_intent'],
    });

    // Name
    const name = session.customer_details?.name || session.customer?.name;
    if (name && !ord.customer_name) result.customer_name = name;

    // Email
    const email = session.customer_details?.email || session.customer?.email;
    if (email && !ord.customer_email) result.customer_email = email;

    // Phone
    const phone = session.customer_details?.phone || session.customer?.phone;
    if (phone && !ord.customer_phone) result.customer_phone = phone;

    // Address — hydrate if CA fields are blank
    const addr = session.customer_details?.address || session.shipping?.address;
    if (addr && !ord.address_line1) {
      result.address_line1    = addr.line1 || '';
      result.address_line2    = addr.line2 || '';
      result.address_city     = addr.city  || '';
      result.address_state    = addr.state || '';
      result.address_postal_code = addr.postal_code || '';
      result.address_country  = addr.country || 'US';
      result.address_last_synced_from = 'stripe_metadata';
      result.address_last_synced_at   = new Date().toISOString();
      console.log(`[PULL-ORDERS] Hydrated address from Stripe for ${ord.shopify_order_number || ord.shopify_order_id}: ${addr.line1}, ${addr.city}`);
    }

    // Line items — hydrate if CA sent empty items
    if (session.line_items?.data?.length > 0 && (!ord.line_items || ord.line_items.length === 0)) {
      result.line_items = session.line_items.data.map(li => ({
        title: li.description || li.price?.product?.name || li.price?.nickname || 'Item',
        quantity: li.quantity || 1,
        price: (li.amount_total || 0) / 100 / (li.quantity || 1),
      }));
      console.log(`[PULL-ORDERS] Hydrated ${result.line_items.length} line_items from Stripe for ${ord.shopify_order_number}`);
    }

    // Payment status
    if (session.payment_status === 'paid' && (!ord.payment_status || ord.payment_status !== 'paid')) {
      result.payment_status = 'paid';
    }

    // Total price
    if (session.amount_total && !ord.total_price) {
      result.total_price = session.amount_total / 100;
    }

    // Payment intent ID
    if (session.payment_intent?.id && !ord.stripe_payment_intent_id) {
      result.stripe_payment_intent_id = session.payment_intent.id;
    }

    // Delivery date — read from session metadata (CA stores it there)
    const meta = session.metadata || {};
    const deliveryDate = meta.selected_delivery_date || meta.requested_delivery_date || meta.delivery_date;
    if (deliveryDate && !ord.requested_delivery_date) {
      result.requested_delivery_date = deliveryDate;
      result.selected_delivery_date  = deliveryDate;
      result.assigned_delivery_date  = deliveryDate;
      result.delivery_window_label   = meta.delivery_window_label || '5 PM – 8 PM';
      // Resolve production date (day before on a valid production day)
      const PRODUCTION_DAYS_DOW = { 2: true, 5: true, 6: true };
      const d = new Date(deliveryDate + 'T00:00:00');
      for (let i = 1; i <= 7; i++) {
        const check = new Date(d);
        check.setDate(d.getDate() - i);
        if (PRODUCTION_DAYS_DOW[check.getDay()]) {
          result.production_date = check.toISOString().split('T')[0];
          break;
        }
      }
      if (!result.production_date) {
        const fallback = new Date(d);
        fallback.setDate(d.getDate() - 1);
        result.production_date = fallback.toISOString().split('T')[0];
      }
      console.log(`[PULL-ORDERS] Hydrated delivery_date=${deliveryDate} production_date=${result.production_date} from Stripe metadata`);
    }

  } catch (err) {
    console.log(`[PULL-ORDERS] Stripe hydration failed for ${ord.customer_email}: ${err.message}`);
  }
  return result;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let body = {};
    try { body = await req.json(); } catch (_) {}
    const { date } = body;

    if (!CUSTOMER_APP_API || !SYNC_SECRET) {
      return Response.json({ error: 'Customer app API not configured' }, { status: 500 });
    }

    // ── CONCURRENCY LOCK: bail if another pull ran within the last 90 seconds ──
    // This prevents race conditions when a manual click fires simultaneously with the scheduler.
    const recentLogs = await base44.asServiceRole.entities.OrderSyncLog.filter(
      { sync_source: 'pullOrdersFromCustomerApp' }, '-sync_timestamp', 1
    );
    if (recentLogs && recentLogs.length > 0) {
      const lastRun = new Date(recentLogs[0].sync_timestamp).getTime();
      const secondsAgo = (Date.now() - lastRun) / 1000;
      if (secondsAgo < 180) {
        console.log(`[PULL-ORDERS] Skipping — another pull ran ${Math.round(secondsAgo)}s ago (concurrency lock)`);
        return Response.json({ status: 'skipped', reason: 'concurrency_lock', last_run_seconds_ago: Math.round(secondsAgo) });
      }
    }
    // Write a lock entry immediately so any concurrent run will see it
    await base44.asServiceRole.entities.OrderSyncLog.create({
      sync_timestamp: new Date().toISOString(),
      sync_source: 'pullOrdersFromCustomerApp',
      event_type: 'pull_start',
      action: 'lock_acquired',
      success: true,
    });

    // Fetch all orders from customer app
    const response = await fetch(`${CUSTOMER_APP_API}/functions/getAllOrdersForSync`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SYNC_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: SYNC_SECRET }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Customer app error ${response.status}: ${text.slice(0, 200)}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (parseErr) {
      console.error('[PULL-ORDERS] JSON parse error:', parseErr.message);
      return Response.json({ status: 'success', count: 0, results: [], warning: 'Invalid JSON response' });
    }

    let orders = Array.isArray(data.orders) ? data.orders : (Array.isArray(data) ? data : []);
    
    // Fetch subscription orders if available
    // NOTE: getSubscriptionOrdersForSync uses CUSTOMER_APP_SYNC_SECRET (same as SYNC_SECRET here) — intentional per architecture
    try {
      const subResponse = await fetch(`${CUSTOMER_APP_API}/functions/getSubscriptionOrdersForSync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SYNC_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: SYNC_SECRET }),
      });
      if (subResponse.ok) {
        const subData = await subResponse.json();
        const subOrders = Array.isArray(subData.orders) ? subData.orders : (Array.isArray(subData) ? subData : []);
        console.log(`[PULL-ORDERS] Fetched ${subOrders.length} subscription orders`);
        orders = [...orders, ...subOrders];
      }
    } catch (err) {
      console.error('[PULL-ORDERS] Subscription fetch error:', err.message);
    }

    // IMPORTANT: Do NOT re-add Stripe webhook orders from hub to orders list.
    // Stripe orders already in the hub (from stripeCheckoutWebhook) should NOT be
    // overwritten by incomplete subscription data from the customer app.
    // Only sync orders that originate from the customer app's subscription endpoint.

    if (!Array.isArray(orders) || orders.length === 0) {
      console.log(`[PULL-ORDERS] No orders found`);
      return Response.json({ status: 'success', count: 0, results: [] });
    }

    // Deduplicate incoming orders by keeping the latest version
    const seenOrderIds = new Map();
    for (const ord of orders) {
      const orderId = ord.shopify_order_id || ord.id;
      if (!orderId) continue;
      
      const existing = seenOrderIds.get(orderId);
      if (!existing || new Date(ord.created_date || 0) > new Date(existing.created_date || 0)) {
        seenOrderIds.set(orderId, ord);
      }
    }
    orders = Array.from(seenOrderIds.values());
    console.log(`[PULL-ORDERS] Deduplicated to ${orders.length} unique orders from customer app`);

    // Pre-load all existing hub orders indexed by shopify_order_id — avoids per-order DB lookups in safeSyncOrderUpdate
    const existingOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500);
    const existingByOrderId = new Map();
    const existingByOrderNumber = new Map();
    // Secondary index: email + 10-min time bucket → catches ghost duplicates with different IDs
    const existingByEmailTimeBucket = new Map();
    for (const o of existingOrders) {
      if (o.shopify_order_id) existingByOrderId.set(o.shopify_order_id, o);
      if (o.shopify_order_number) existingByOrderNumber.set(o.shopify_order_number, o);
      // Use customer_order_date OR created_date as fallback — some old orders have null customer_order_date
      const dateForBucket = o.customer_order_date || o.created_date;
      if (o.customer_email && dateForBucket) {
        const bucket = Math.floor(new Date(dateForBucket).getTime() / (24 * 60 * 60 * 1000)); // 24-hour bucket
        existingByEmailTimeBucket.set(`${o.customer_email}__${bucket}`, o);
      }
    }
    console.log(`[PULL-ORDERS] Loaded ${existingOrders.length} existing hub orders for change detection`);

    // Upsert orders into hub ShopifyOrder entity
    const results = [];
    const processedIds = new Set();

    for (let ord of orders) {
      const orderId = ord.shopify_order_id || ord.id;
      try {

        // Skip if we've already processed this ID in this sync
        if (processedIds.has(orderId)) {
          results.push({ order_id: orderId, action: 'skipped', reason: 'duplicate_in_batch' });
          continue;
        }
        processedIds.add(orderId);

        let hubOrder = existingByOrderId.get(orderId);

        // Secondary dedup: match by order number (catches orders where app used internal ID but hub has same order number)
        // This is the PRIMARY protection against the customer app sending different IDs for the same order
        if (!hubOrder && ord.shopify_order_number) {
          const byNumber = existingByOrderNumber.get(ord.shopify_order_number);
          if (byNumber) {
            console.log(`[PULL-ORDERS] Matched by order number ${ord.shopify_order_number} (ID ${orderId} vs hub ${byNumber.shopify_order_id}) — treating as same order`);
            hubOrder = byNumber;
          }
        }

        // Tertiary dedup: email + day bucket — ONLY for subscription orders where no Stripe session ID is present.
        // One-time/checkout orders MUST have unique Stripe session or payment intent IDs — NEVER dedupe those by email.
        // Same customer CAN place multiple one-time orders on the same day. Email alone is NOT an idempotency key.
        const isOneTimeWithStripeId = (ord.stripe_checkout_session_id || ord.stripe_payment_intent_id);
        if (!hubOrder && !isOneTimeWithStripeId && ord.customer_email && (ord.created_date || ord.order_date)) {
          const orderDate = ord.created_date || ord.order_date;
          const bucket = Math.floor(new Date(orderDate).getTime() / (24 * 60 * 60 * 1000));
          const bucketMatch = existingByEmailTimeBucket.get(`${ord.customer_email}__${bucket}`);
          if (bucketMatch) {
            console.log(`[PULL-ORDERS] Ghost duplicate (subscription) detected for ${ord.customer_email} (ID ${orderId} vs hub ${bucketMatch.shopify_order_id}) — skipping`);
            results.push({ order_id: orderId, action: 'skipped', reason: 'ghost_duplicate_by_email_day' });
            continue;
          }
        }

        // ── STRIPE HYDRATION: fill missing CA fields before quality checks ──────
        // Only trigger for one-time orders with a Stripe session ID where address is blank.
        // Subscription orders use a different hydration path (rebuildAllSubscriptionOrders).
        const needsHydration = ord.stripe_checkout_session_id &&
          !ord.stripe_subscription_id &&
          (!ord.address_line1 || !ord.line_items || ord.line_items.length === 0 || !ord.requested_delivery_date);

        if (needsHydration && !hubOrder) {
          const hydrated = await hydrateFromStripe(ord);
          if (Object.keys(hydrated).length > 0) {
            ord = { ...ord, ...hydrated };
            console.log(`[PULL-ORDERS] Stripe hydration applied for ${orderId}: ${Object.keys(hydrated).join(', ')}`);
          }
        }

        // Build customer name — try payload first, then existing hub record, then Stripe (last resort only if truly missing)
        let customerName = ord.customer_name ||
          (ord.first_name || ord.last_name ? `${ord.first_name || ''} ${ord.last_name || ''}`.trim() : null) ||
          ord.full_name || null;

        // Use existing hub name if we already have one — avoid Stripe API call
        if (!customerName && hubOrder?.customer_name) {
          customerName = hubOrder.customer_name;
        }

        // GUARDRAIL: If the hub order is already refunded/cancelled/excluded, never re-activate it
        if (hubOrder) {
          const hubIsExcluded =
            hubOrder.payment_status === 'refunded' ||
            hubOrder.production_status === 'canceled' ||
            hubOrder.production_status === 'cancelled' ||
            (Array.isArray(hubOrder.tags) && hubOrder.tags.includes('excluded'));
          if (hubIsExcluded) {
            console.log(`[PULL-ORDERS] Skipping ${hubOrder.shopify_order_number} — already marked refunded/cancelled/excluded in Hub. Will not reactivate.`);
            results.push({ order_id: orderId, action: 'skipped', reason: 'already_excluded_in_hub' });
            continue;
          }
        }

        // GUARDRAIL: If the hub order has manual_override=true, skip the write entirely.
        // An admin has manually set status fields that must not be overwritten by CA sync.
        // Only Stripe refund/cancel events (via stripeCheckoutWebhook) can override this.
        if (hubOrder?.manual_override === true) {
          console.log(`[PULL-ORDERS] Skipping ${hubOrder.shopify_order_number} — manual_override=true set by ${hubOrder.manual_override_by || 'admin'}. Customer App sync will not overwrite.`);
          results.push({ order_id: orderId, action: 'skipped', reason: 'manual_override_active' });
          continue;
        }

        // Skip write if order already exists in hub and nothing meaningful has changed
        // CRITICAL: Do NOT include sync_status/last_sync_at in this check — they change every run
        // and would prevent the no-change skip, causing a recalculate storm on every poll.
        if (hubOrder) {
          const incomingAddress = ord.address_line1 || '';
          const hubAddress = hubOrder.address_line1 || '';
          const incomingItems = JSON.stringify(ord.line_items || ord.items || []);
          const hubItems = JSON.stringify(hubOrder.line_items || []);
          const incomingNotes = ord.customer_notes || ord.notes || '';
          const hubNotes = hubOrder.customer_notes || '';
          const incomingTotal = ord.total_price || ord.total || 0;
          const hubTotal = hubOrder.total_price || 0;
          const incomingPhone = ord.customer_phone || '';
          const hubPhone = hubOrder.customer_phone || '';

          const unchanged =
            incomingAddress === hubAddress &&
            incomingItems === hubItems &&
            incomingNotes === hubNotes &&
            Math.abs(incomingTotal - hubTotal) < 0.01 &&
            incomingPhone === hubPhone &&
            (!customerName || customerName === hubOrder.customer_name);

          if (unchanged) {
            results.push({ order_id: orderId, action: 'skipped', reason: 'no_changes' });
            continue;
          }
        }

        // If this is a new order (no hubOrder), use 'rebuild_subscriptions' source which
        // allows shopify_order_id + shopify_order_number through field ownership.
        // For updates to existing orders, use 'customer_app' source (address/notes/items only).
        const writeSource = hubOrder ? 'customer_app' : 'rebuild_subscriptions';

        // When matched by order number to a different hub record, use internal_id so safeSyncOrderUpdate
        // finds and updates the CORRECT existing record instead of creating a new one.
        const matchBy = hubOrder && hubOrder.shopify_order_id !== orderId
          ? { internal_id: hubOrder.id }
          : { shopify_order_id: orderId };

        // Route ALL writes through safeSyncOrderUpdate — it enforces all protections
        const safeResult = await base44.asServiceRole.functions.invoke('safeSyncOrderUpdate', {
          incomingData: {
            shopify_order_id: orderId,
            shopify_order_number: ord.shopify_order_number || ord.order_number || `#APP-${orderId?.slice(-6) || Date.now()}`,
            customer_email: ord.customer_email || ord.contact_email || '',
            customer_name: customerName || '',
            customer_phone: ord.customer_phone || '',
            customer_app_user_id: ord.customer_app_user_id || ord.user_id || '',
            line_items: ord.line_items && ord.line_items.length > 0 ? ord.line_items : (ord.items || []),
            fulfillment_method: ord.fulfillment_method || ord.fulfillment_type || 'delivery',
            requested_delivery_date: ord.requested_delivery_date || ord.delivery_date || '',
            selected_delivery_date: ord.selected_delivery_date || null,
            assigned_delivery_date: ord.assigned_delivery_date || null,
            // Derive production_date from assigned_delivery_date if not provided
            production_date: ord.production_date || (ord.assigned_delivery_date ? deriveProductionDate(ord.assigned_delivery_date) : null) || (ord.selected_delivery_date ? deriveProductionDate(ord.selected_delivery_date) : null),
            delivery_window_label: ord.delivery_window_label || null,
            payment_status: ord.payment_status || 'pending',
            subtotal: ord.subtotal || 0,
            total_price: ord.total_price || ord.total || 0,
            customer_notes: ord.customer_notes || ord.notes || '',
            tags: ord.tags || [],
            customer_order_date: ord.created_date || ord.order_date || new Date().toISOString(),
            source_channel: 'online',
            source_type: ord.stripe_checkout_session_id ? 'stripe_checkout' : (ord.stripe_payment_intent_id ? 'stripe_payment' : 'customer_app'),
            stripe_checkout_session_id: ord.stripe_checkout_session_id || null,
            stripe_payment_intent_id: ord.stripe_payment_intent_id || null,
            address_line1: ord.address_line1 || '',
            address_line2: ord.address_line2 || '',
            address_city: ord.address_city || '',
            address_state: ord.address_state || '',
            address_postal_code: ord.address_postal_code || '',
            address_country: ord.address_country || 'US',
            ...(ord.address_last_synced_from ? {
              address_last_synced_from: ord.address_last_synced_from,
              address_last_synced_at: ord.address_last_synced_at,
            } : {}),
          },
          source: writeSource,
          matchBy,
        });

        const action = safeResult?.data?.action || 'unknown';
        results.push({ order_id: orderId, action, reason: safeResult?.data?.status });
        } catch (err) {
        console.error(`[PULL-ORDERS] Failed to sync order ${orderId}:`, err.message);
        results.push({
         order_id: orderId,
         action: 'failed',
         error: err.message,
        });
        }
    }

    console.log(`[PULL-ORDERS] Synced ${results.length} orders from customer app`);
    return Response.json({ status: 'success', count: results.length, results });
  } catch (error) {
    console.error('[PULL-ORDERS] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});