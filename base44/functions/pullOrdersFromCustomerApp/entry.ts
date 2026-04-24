import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

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

    // Also fetch recent Stripe orders already created in the hub (from webhooks)
    try {
      const allHubOrders = await base44.asServiceRole.entities.ShopifyOrder.list('', 500);
      console.log(`[PULL-ORDERS] Fetched ${allHubOrders.length} total orders from hub`);
      
      // Include orders from webhooks that aren't already in our synced list
      const orderedOrderIds = new Set(orders.map(o => o.shopify_order_id || o.id));
      const newStripeOrders = (allHubOrders || [])
        .filter(o => !orderedOrderIds.has(o.shopify_order_id || o.id));
      
      console.log(`[PULL-ORDERS] Found ${newStripeOrders.length} webhook orders not yet included in sync`);
      
      if (newStripeOrders.length > 0) {
        // Convert to same format as customer app orders
        orders = [...orders, ...newStripeOrders.map(o => ({
          shopify_order_id: o.shopify_order_id,
          id: o.id,
          shopify_order_number: o.shopify_order_number,
          customer_email: o.customer_email,
          customer_phone: o.customer_phone,
          source_channel: o.source_channel,
          line_items: o.line_items,
          fulfillment_method: o.fulfillment_method,
          delivery_address: o.delivery_address,
          requested_delivery_date: o.requested_delivery_date,
          payment_status: o.payment_status,
          fulfillment_status: o.fulfillment_status,
          total_price: o.total_price,
          customer_notes: o.customer_notes,
          internal_notes: o.internal_notes,
          production_status: o.production_status,
          tags: o.tags,
          created_date: o.created_date,
        }))];
      }
    } catch (err) {
      console.error('[PULL-ORDERS] Stripe order fetch error:', err.message);
    }

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

        // Check if exists in hub
        const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({
          shopify_order_id: orderId,
        });

        // Build order, but preserve existing data if incoming is empty
        let hubOrder = {
          shopify_order_id: orderId || '',
          shopify_order_number: ord.shopify_order_number || ord.order_number || '',
          customer_email: ord.customer_email || '',
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
         if (!hubOrder.customer_name && existingData.customer_name) {
           hubOrder.customer_name = existingData.customer_name;
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