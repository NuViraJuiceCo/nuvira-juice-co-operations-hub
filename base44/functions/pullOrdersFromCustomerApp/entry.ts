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
    const { date } = await req.json();

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

    // Upsert orders into hub ShopifyOrder entity
    const results = [];
    const processedIds = new Set();

    for (const ord of orders) {
      try {
        const orderId = ord.shopify_order_id || ord.id;

        // Skip if we've already processed this ID in this sync
        if (processedIds.has(orderId)) {
          results.push({ order_id: orderId, action: 'skipped', reason: 'duplicate_in_batch' });
          continue;
        }
        processedIds.add(orderId);

        // GUARD: Never touch subscription orders that were manually created or synced from Stripe.
        // If a subscription order already exists for this email with source_channel=subscription,
        // skip this incoming record entirely — the hub copy is the source of truth.
        if (ord.source_channel === 'subscription' || ord.channel === 'subscription') {
          const existingSubOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({
            customer_email: ord.customer_email || '',
            source_channel: 'subscription',
          });
          if (existingSubOrders && existingSubOrders.length > 0) {
            console.log(`[PULL-ORDERS] SKIPPING subscription order for ${ord.customer_email} — hub copy already exists, will not overwrite.`);
            results.push({ order_id: orderId, action: 'skipped', reason: 'subscription_protected' });
            continue;
          }
        }

        // Check for existing duplicates and delete all older versions before upserting
        // But skip if this is a Stripe subscription (don't delete webhook orders)
        if (!orderId.startsWith('sub_')) {
          const existingDuplicates = await base44.asServiceRole.entities.ShopifyOrder.filter({
            shopify_order_id: orderId,
          });
          if (existingDuplicates && existingDuplicates.length > 0) {
            const sorted = existingDuplicates.sort((a, b) => new Date(b.updated_date || b.created_date) - new Date(a.updated_date || a.created_date));
            // Keep the first (newest), delete the rest
            for (let i = 1; i < sorted.length; i++) {
              console.log(`[PULL-ORDERS] Deleting duplicate ${orderId}: ${sorted[i].id}`);
              await base44.asServiceRole.entities.ShopifyOrder.delete(sorted[i].id);
            }
          }
        }

        // Check if exists in hub — also check with base44_ prefix variant to avoid duplicates
        let existing = await base44.asServiceRole.entities.ShopifyOrder.filter({
          shopify_order_id: orderId,
        });
        if (!existing || existing.length === 0) {
          existing = await base44.asServiceRole.entities.ShopifyOrder.filter({
            shopify_order_id: `base44_${orderId}`,
          });
        }

        // Build full customer name — try payload first, then Stripe
        let customerName = ord.customer_name ||
          (ord.first_name || ord.last_name ? `${ord.first_name || ''} ${ord.last_name || ''}`.trim() : null) ||
          ord.full_name || null;

        // If no name in payload, try to fetch from Stripe (including email lookup for subscription orders)
        if (!customerName && (ord.stripe_checkout_session_id || ord.stripe_payment_intent_id || ord.stripe_subscription_id || ord.customer_email)) {
          customerName = await fetchNameFromStripe(ord);
          if (customerName) console.log(`[PULL-ORDERS] Got name from Stripe for ${orderId}: ${customerName}`);
        }

        // Also preserve existing name if we still have nothing
        let hubOrder = {
          shopify_order_id: orderId || '',
          shopify_order_number: ord.shopify_order_number || ord.order_number || '',
          customer_email: ord.customer_email || '',
          customer_name: customerName,
          customer_phone: ord.customer_phone || '',
          source_channel: ord.source_channel || ord.channel || 'online',
          line_items: ord.line_items && ord.line_items.length > 0 ? ord.line_items : (ord.items || []),
          fulfillment_method: ord.fulfillment_method || ord.fulfillment_type || 'delivery',
          delivery_address: ord.delivery_address || '',
          requested_delivery_date: ord.requested_delivery_date || ord.delivery_date || '',
          payment_status: ord.payment_status || 'pending',
          fulfillment_status: ord.fulfillment_status || '',
          subtotal: ord.subtotal || 0,
          total_price: ord.total_price || ord.total || 0,
          customer_notes: ord.customer_notes || ord.notes || '',
          internal_notes: ord.internal_notes || '',
          production_status: ord.production_status || 'new',
          tags: ord.tags || [],
          assigned_delivery_date: ord.assigned_delivery_date || '',
          sync_status: 'synced',
          last_sync_at: new Date().toISOString(),
          customer_order_date: ord.created_date || ord.order_date || new Date().toISOString(),
        };

        if (existing && existing.length > 0) {
         // Preserve critical fields from existing order if incoming data is empty
         const existingData = existing[0];
         if (!hubOrder.shopify_order_number && existingData.shopify_order_number) {
           hubOrder.shopify_order_number = existingData.shopify_order_number;
         }
         if ((!hubOrder.line_items || hubOrder.line_items.length === 0) && existingData.line_items && existingData.line_items.length > 0) {
           hubOrder.line_items = existingData.line_items;
         }
         // Always preserve existing name if incoming has no name
         if (!hubOrder.customer_name && existingData.customer_name) {
           hubOrder.customer_name = existingData.customer_name;
         }
         // Preserve phone if incoming is empty
         if (!hubOrder.customer_phone && existingData.customer_phone) {
           hubOrder.customer_phone = existingData.customer_phone;
         }
         // Preserve tags if incoming is empty
         if ((!hubOrder.tags || hubOrder.tags.length === 0) && existingData.tags && existingData.tags.length > 0) {
           hubOrder.tags = existingData.tags;
         }
         // Never downgrade production_status from a meaningful state back to 'new'
         const meaningfulStatuses = ['awaiting_production','in_production','bottled','labeled','qc_checked','packed','in_cold_storage','assigned_for_pickup','assigned_for_delivery','fulfilled','canceled','refunded'];
         if (hubOrder.production_status === 'new' && meaningfulStatuses.includes(existingData.production_status)) {
           hubOrder.production_status = existingData.production_status;
         }
         // Preserve fulfillments if existing has them and incoming doesn't
         if ((!hubOrder.fulfillments || hubOrder.fulfillments.length === 0) && existingData.fulfillments && existingData.fulfillments.length > 0) {
           hubOrder.fulfillments = existingData.fulfillments;
         }
         // Preserve internal_notes if existing has content
         if (!hubOrder.internal_notes && existingData.internal_notes) {
           hubOrder.internal_notes = existingData.internal_notes;
         }
         // Preserve assigned_delivery_date
         if (!hubOrder.assigned_delivery_date && existingData.assigned_delivery_date) {
           hubOrder.assigned_delivery_date = existingData.assigned_delivery_date;
         }
         
         await base44.asServiceRole.entities.ShopifyOrder.update(existing[0].id, hubOrder);
         results.push({ order_id: orderId, action: 'updated', order_number: hubOrder.shopify_order_number });
        } else {
         await base44.asServiceRole.entities.ShopifyOrder.create(hubOrder);
         results.push({ order_id: orderId, action: 'created', order_number: hubOrder.shopify_order_number });
        }
        } catch (err) {
        console.error(`[PULL-ORDERS] Failed to sync order ${ord.shopify_order_id}:`, err.message);
        results.push({
         order_id: ord.shopify_order_id,
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