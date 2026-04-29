import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY'), { apiVersion: '2023-10-16' });

async function fetchNameFromStripe(ord) {
  try {
    if (ord.stripe_checkout_session_id) {
      const session = await stripe.checkout.sessions.retrieve(ord.stripe_checkout_session_id, { expand: ['customer'] });
      const name = session.customer_details?.name || session.customer?.name;
      if (name) return name;
    }
    if (ord.stripe_payment_intent_id) {
      const pi = await stripe.paymentIntents.retrieve(ord.stripe_payment_intent_id, { expand: ['customer'] });
      const name = pi.customer?.name || pi.shipping?.name;
      if (name) return name;
    }
    if (ord.stripe_subscription_id) {
      const sub = await stripe.subscriptions.retrieve(ord.stripe_subscription_id, { expand: ['customer'] });
      const name = sub.customer?.name;
      if (name) return name;
    }
    // Last resort: look up by email in Stripe (catches subscription orders with no IDs)
    if (ord.customer_email) {
      const customers = await stripe.customers.list({ email: ord.customer_email, limit: 1 });
      const name = customers.data[0]?.name;
      if (name) return name;
    }
  } catch (err) {
    console.log(`[PULL-ORDERS] Stripe name lookup failed for ${ord.customer_email}: ${err.message}`);
  }
  return null;
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
    for (const o of existingOrders) {
      if (o.shopify_order_id) existingByOrderId.set(o.shopify_order_id, o);
    }
    console.log(`[PULL-ORDERS] Loaded ${existingOrders.length} existing hub orders for change detection`);

    // Upsert orders into hub ShopifyOrder entity
    const results = [];
    const processedIds = new Set();

    for (const ord of orders) {
      const orderId = ord.shopify_order_id || ord.id;
      try {

        // Skip if we've already processed this ID in this sync
        if (processedIds.has(orderId)) {
          results.push({ order_id: orderId, action: 'skipped', reason: 'duplicate_in_batch' });
          continue;
        }
        processedIds.add(orderId);

        const hubOrder = existingByOrderId.get(orderId);

        // Build customer name — try payload first, then existing hub record, then Stripe (last resort only if truly missing)
        let customerName = ord.customer_name ||
          (ord.first_name || ord.last_name ? `${ord.first_name || ''} ${ord.last_name || ''}`.trim() : null) ||
          ord.full_name || null;

        // Use existing hub name if we already have one — avoid Stripe API call
        if (!customerName && hubOrder?.customer_name) {
          customerName = hubOrder.customer_name;
        }

        // Only hit Stripe if name is truly unknown and order has no hub record yet
        if (!customerName && !hubOrder && (ord.stripe_checkout_session_id || ord.stripe_payment_intent_id || ord.stripe_subscription_id || ord.customer_email)) {
          customerName = await fetchNameFromStripe(ord);
          if (customerName) console.log(`[PULL-ORDERS] Got name from Stripe for ${orderId}: ${customerName}`);
        }

        // Skip write if order already exists in hub and nothing meaningful has changed
        if (hubOrder) {
          const incomingAddress = ord.address_line1 || '';
          const hubAddress = hubOrder.address_line1 || '';
          const incomingItems = JSON.stringify(ord.line_items || ord.items || []);
          const hubItems = JSON.stringify(hubOrder.line_items || []);
          const incomingNotes = ord.customer_notes || ord.notes || '';
          const hubNotes = hubOrder.customer_notes || '';
          const incomingTotal = ord.total_price || ord.total || 0;
          const hubTotal = hubOrder.total_price || 0;

          const unchanged =
            incomingAddress === hubAddress &&
            incomingItems === hubItems &&
            incomingNotes === hubNotes &&
            Math.abs(incomingTotal - hubTotal) < 0.01 &&
            (!customerName || customerName === hubOrder.customer_name);

          if (unchanged) {
            results.push({ order_id: orderId, action: 'skipped', reason: 'no_changes' });
            continue;
          }
        }

        // Route ALL writes through safeSyncOrderUpdate — it enforces all protections
        const safeResult = await base44.asServiceRole.functions.invoke('safeSyncOrderUpdate', {
          incomingData: {
            shopify_order_id: orderId,
            shopify_order_number: ord.shopify_order_number || ord.order_number || `#APP-${orderId?.slice(-6) || Date.now()}`,
            customer_email: ord.customer_email || ord.contact_email || '',  // fallback to contact_email for Apple Sign In users
            customer_name: customerName || '',
            customer_phone: ord.customer_phone || '',
            customer_app_user_id: ord.customer_app_user_id || ord.user_id || '',
            line_items: ord.line_items && ord.line_items.length > 0 ? ord.line_items : (ord.items || []),
            fulfillment_method: ord.fulfillment_method || ord.fulfillment_type || 'delivery',
            requested_delivery_date: ord.requested_delivery_date || ord.delivery_date || '',
            payment_status: ord.payment_status || 'pending',
            subtotal: ord.subtotal || 0,
            total_price: ord.total_price || ord.total || 0,
            customer_notes: ord.customer_notes || ord.notes || '',
            tags: ord.tags || [],
            sync_status: 'synced',
            last_sync_at: new Date().toISOString(),
            customer_order_date: ord.created_date || ord.order_date || new Date().toISOString(),
            address_line1: ord.address_line1 || '',
            address_line2: ord.address_line2 || '',
            address_city: ord.address_city || '',
            address_state: ord.address_state || '',
            address_postal_code: ord.address_postal_code || '',
            address_country: ord.address_country || 'US',
          },
          source: 'customer_app',
          matchBy: { shopify_order_id: orderId },
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