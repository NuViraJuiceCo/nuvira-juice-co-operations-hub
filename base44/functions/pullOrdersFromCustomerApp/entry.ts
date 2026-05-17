import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY'), { apiVersion: '2023-10-16' });

// ── PRODUCTION DATE DERIVATION ───────────────────────────────────────────────
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
  const fallback = new Date(d);
  fallback.setDate(d.getDate() - 1);
  return fallback.toISOString().split('T')[0];
}

// ── STRIPE HYDRATION FALLBACK ────────────────────────────────────────────────
async function hydrateFromStripe(ord) {
  const result = {};
  try {
    if (!ord.stripe_checkout_session_id) return result;

    const session = await stripe.checkout.sessions.retrieve(ord.stripe_checkout_session_id, {
      expand: ['line_items', 'customer', 'payment_intent'],
    });

    const name = session.customer_details?.name || session.customer?.name;
    if (name && !ord.customer_name) result.customer_name = name;

    const email = session.customer_details?.email || session.customer?.email;
    if (email && !ord.customer_email) result.customer_email = email;

    const phone = session.customer_details?.phone || session.customer?.phone;
    if (phone && !ord.customer_phone) result.customer_phone = phone;

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
      console.log(`[PULL-ORDERS] Hydrated address from Stripe for ${ord.shopify_order_number}: ${addr.line1}, ${addr.city}`);
    }

    if (session.line_items?.data?.length > 0 && (!ord.line_items || ord.line_items.length === 0)) {
      result.line_items = session.line_items.data.map(li => ({
        title: li.description || li.price?.product?.name || li.price?.nickname || 'Item',
        quantity: li.quantity || 1,
        price: (li.amount_total || 0) / 100 / (li.quantity || 1),
      }));
    }

    if (session.payment_status === 'paid' && (!ord.payment_status || ord.payment_status !== 'paid')) {
      result.payment_status = 'paid';
    }
    if (session.amount_total && !ord.total_price) {
      result.total_price = session.amount_total / 100;
    }
    if (session.payment_intent?.id && !ord.stripe_payment_intent_id) {
      result.stripe_payment_intent_id = session.payment_intent.id;
    }

    const meta = session.metadata || {};
    const deliveryDate = meta.selected_delivery_date || meta.requested_delivery_date || meta.delivery_date;
    if (deliveryDate && !ord.requested_delivery_date) {
      result.requested_delivery_date = deliveryDate;
      result.selected_delivery_date  = deliveryDate;
      result.assigned_delivery_date  = deliveryDate;
      result.delivery_window_label   = meta.delivery_window_label || '5 PM – 8 PM';
      result.production_date = deriveProductionDate(deliveryDate);
    }
  } catch (err) {
    console.log(`[PULL-ORDERS] Stripe hydration failed for ${ord.customer_email}: ${err.message}`);
  }
  return result;
}

// ── WRITE-DIFF GUARD ─────────────────────────────────────────────────────────
// Returns true if incoming CA order has materially changed vs the hub record.
// Only these fields can trigger a write — all other fields are ignored.
const DIFF_FIELDS = [
  'address_line1', 'address_line2', 'address_city', 'address_state', 'address_postal_code',
  'customer_name', 'customer_phone', 'customer_notes',
  'payment_status', 'fulfillment_status',
  'line_items',
  'total_price',
  'tags',
];

function hasMaterialChange(incoming, hubOrder) {
  for (const field of DIFF_FIELDS) {
    const inVal = JSON.stringify(incoming[field] ?? null);
    const hubVal = JSON.stringify(hubOrder[field] ?? null);
    if (field === 'total_price') {
      // Numeric tolerance: ignore sub-cent differences
      const diff = Math.abs((incoming[field] || 0) - (hubOrder[field] || 0));
      if (diff > 0.01) return true;
      continue;
    }
    if (field === 'line_items' || field === 'tags') {
      if (inVal !== hubVal && incoming[field]?.length > 0) return true;
      continue;
    }
    if (inVal !== hubVal && (incoming[field] ?? '') !== '') return true;
  }
  return false;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let body = {};
    try { body = await req.json(); } catch (_) {}

    if (!CUSTOMER_APP_API || !SYNC_SECRET) {
      return Response.json({ error: 'Customer app API not configured' }, { status: 500 });
    }

    // ── CONCURRENCY LOCK: bail if another pull ran within last 10 minutes ──────
    // Extended from 3 min to 10 min — at 4-hour cadence this prevents any race conditions.
    const recentLogs = await base44.asServiceRole.entities.OrderSyncLog.filter(
      { sync_source: 'pullOrdersFromCustomerApp', event_type: 'pull_summary' },
      '-sync_timestamp', 1
    );
    if (recentLogs?.length > 0) {
      const secondsAgo = (Date.now() - new Date(recentLogs[0].sync_timestamp).getTime()) / 1000;
      if (secondsAgo < 600) {
        console.log(`[PULL-ORDERS] Skipping — another pull ran ${Math.round(secondsAgo)}s ago`);
        return Response.json({ status: 'skipped', reason: 'concurrency_lock', last_run_seconds_ago: Math.round(secondsAgo) });
      }
    }

    // ── FETCH ALL ORDERS FROM CUSTOMER APP ────────────────────────────────────
    const response = await fetch(`${CUSTOMER_APP_API}/functions/getAllOrdersForSync`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SYNC_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: SYNC_SECRET }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Customer app error ${response.status}: ${text.slice(0, 200)}`);
    }

    let data;
    try { data = await response.json(); } catch (parseErr) {
      console.error('[PULL-ORDERS] JSON parse error:', parseErr.message);
      return Response.json({ status: 'success', count: 0, results: [], warning: 'Invalid JSON response' });
    }

    let orders = Array.isArray(data.orders) ? data.orders : (Array.isArray(data) ? data : []);

    // Fetch subscription orders
    try {
      const subResponse = await fetch(`${CUSTOMER_APP_API}/functions/getSubscriptionOrdersForSync`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SYNC_SECRET}`, 'Content-Type': 'application/json' },
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

    if (!Array.isArray(orders) || orders.length === 0) {
      console.log(`[PULL-ORDERS] No orders found — writing summary log and exiting`);
      await base44.asServiceRole.entities.OrderSyncLog.create({
        sync_timestamp: new Date().toISOString(),
        sync_source: 'pullOrdersFromCustomerApp',
        event_type: 'pull_summary',
        action: 'skipped',
        reason: 'no_orders_from_ca',
        success: true,
      });
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
    console.log(`[PULL-ORDERS] Processing ${orders.length} unique orders from customer app`);

    // ── PRE-LOAD HUB INDEX ────────────────────────────────────────────────────
    const existingOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500);
    const existingByOrderId = new Map();
    const existingByOrderNumber = new Map();
    const existingByEmailTimeBucket = new Map();
    for (const o of existingOrders) {
      if (o.shopify_order_id) existingByOrderId.set(o.shopify_order_id, o);
      if (o.shopify_order_number) existingByOrderNumber.set(o.shopify_order_number, o);
      const dateForBucket = o.customer_order_date || o.created_date;
      if (o.customer_email && dateForBucket) {
        const bucket = Math.floor(new Date(dateForBucket).getTime() / (24 * 60 * 60 * 1000));
        existingByEmailTimeBucket.set(`${o.customer_email}__${bucket}`, o);
      }
    }
    console.log(`[PULL-ORDERS] Loaded ${existingOrders.length} existing hub orders`);

    // ── PROCESS ORDERS ────────────────────────────────────────────────────────
    const stats = { processed: 0, created: 0, updated: 0, skipped_no_change: 0, skipped_excluded: 0, skipped_dedup: 0, failed: 0 };
    const processedIds = new Set();

    for (let ord of orders) {
      const orderId = ord.shopify_order_id || ord.id;
      stats.processed++;
      try {
        if (processedIds.has(orderId)) {
          stats.skipped_dedup++;
          continue;
        }
        processedIds.add(orderId);

        let hubOrder = existingByOrderId.get(orderId);

        // Match by order number if not found by ID
        if (!hubOrder && ord.shopify_order_number) {
          const byNumber = existingByOrderNumber.get(ord.shopify_order_number);
          if (byNumber) {
            console.log(`[PULL-ORDERS] Matched by order number ${ord.shopify_order_number}`);
            hubOrder = byNumber;
          }
        }

        // Ghost duplicate check for subscription orders (no Stripe session ID)
        const isOneTimeWithStripeId = ord.stripe_checkout_session_id || ord.stripe_payment_intent_id;
        if (!hubOrder && !isOneTimeWithStripeId && ord.customer_email && (ord.created_date || ord.order_date)) {
          const orderDate = ord.created_date || ord.order_date;
          const bucket = Math.floor(new Date(orderDate).getTime() / (24 * 60 * 60 * 1000));
          const bucketMatch = existingByEmailTimeBucket.get(`${ord.customer_email}__${bucket}`);
          if (bucketMatch) {
            stats.skipped_dedup++;
            continue;
          }
        }

        // ── GUARDRAIL: Skip refunded/cancelled/excluded/manual_override orders ──
        if (hubOrder) {
          const isExcluded =
            hubOrder.payment_status === 'refunded' ||
            hubOrder.production_status === 'canceled' ||
            hubOrder.production_status === 'cancelled' ||
            (Array.isArray(hubOrder.tags) && hubOrder.tags.includes('excluded'));
          if (isExcluded) {
            stats.skipped_excluded++;
            continue;
          }
          if (hubOrder.manual_override === true) {
            stats.skipped_excluded++;
            continue;
          }
        }

        // ── STRIPE HYDRATION: fill missing fields for new orders ───────────────
        const needsHydration = ord.stripe_checkout_session_id &&
          !ord.stripe_subscription_id &&
          (!ord.address_line1 || !ord.line_items || ord.line_items.length === 0 || !ord.requested_delivery_date);
        if (needsHydration && !hubOrder) {
          const hydrated = await hydrateFromStripe(ord);
          if (Object.keys(hydrated).length > 0) {
            ord = { ...ord, ...hydrated };
          }
        }

        let customerName = ord.customer_name ||
          (ord.first_name || ord.last_name ? `${ord.first_name || ''} ${ord.last_name || ''}`.trim() : null) ||
          ord.full_name || null;
        if (!customerName && hubOrder?.customer_name) {
          customerName = hubOrder.customer_name;
        }

        // ── WRITE-DIFF GUARD: skip if nothing material changed ─────────────────
        if (hubOrder) {
          const incoming = {
            address_line1: ord.address_line1 || '',
            address_line2: ord.address_line2 || '',
            address_city: ord.address_city || '',
            address_state: ord.address_state || '',
            address_postal_code: ord.address_postal_code || '',
            customer_name: customerName || '',
            customer_phone: ord.customer_phone || '',
            customer_notes: ord.customer_notes || ord.notes || '',
            payment_status: ord.payment_status || 'pending',
            fulfillment_status: ord.fulfillment_status || null,
            line_items: ord.line_items && ord.line_items.length > 0 ? ord.line_items : (ord.items || []),
            total_price: ord.total_price || ord.total || 0,
            tags: ord.tags || [],
          };
          if (!hasMaterialChange(incoming, hubOrder)) {
            stats.skipped_no_change++;
            continue;
          }
        }

        const writeSource = hubOrder ? 'customer_app' : 'rebuild_subscriptions';
        const matchBy = hubOrder && hubOrder.shopify_order_id !== orderId
          ? { internal_id: hubOrder.id }
          : { shopify_order_id: orderId };

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
        if (action === 'created') stats.created++;
        else if (action === 'updated') stats.updated++;
        else stats.skipped_no_change++;

      } catch (err) {
        console.error(`[PULL-ORDERS] Failed to sync order ${orderId}:`, err.message);
        stats.failed++;
      }
    }

    // ── SINGLE SUMMARY LOG ENTRY (replaces per-order spam) ────────────────────
    await base44.asServiceRole.entities.OrderSyncLog.create({
      sync_timestamp: new Date().toISOString(),
      sync_source: 'pullOrdersFromCustomerApp',
      event_type: 'pull_summary',
      action: (stats.created + stats.updated) > 0 ? 'updated' : 'skipped',
      reason: `created=${stats.created} updated=${stats.updated} skipped_no_change=${stats.skipped_no_change} skipped_excluded=${stats.skipped_excluded} skipped_dedup=${stats.skipped_dedup} failed=${stats.failed}`,
      success: stats.failed === 0,
      fields_updated: [`total_processed:${stats.processed}`],
    });

    console.log(`[PULL-ORDERS] Done. created=${stats.created} updated=${stats.updated} skipped_no_change=${stats.skipped_no_change} excluded=${stats.skipped_excluded} dedup=${stats.skipped_dedup} failed=${stats.failed}`);
    return Response.json({
      status: 'success',
      count: stats.processed,
      stats,
    });

  } catch (error) {
    console.error('[PULL-ORDERS] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});