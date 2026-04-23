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

    // Fetch orders from customer app (all orders if no date specified)
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

    const orders = Array.isArray(data.orders) ? data.orders : (Array.isArray(data) ? data : []);

    if (!Array.isArray(orders) || orders.length === 0) {
      console.log(`[PULL-ORDERS] No orders found`);
      return Response.json({ status: 'success', count: 0, results: [] });
    }

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

        // Check if exists in hub
        const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({
          shopify_order_id: orderId,
        });

        const hubOrder = {
          shopify_order_id: orderId || '',
          shopify_order_number: ord.shopify_order_number || ord.order_number || '',
          customer_email: ord.customer_email || '',
          customer_phone: ord.customer_phone || '',
          source_channel: ord.source_channel || ord.channel || 'online',
          line_items: ord.line_items || ord.items || [],
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
         await base44.asServiceRole.entities.ShopifyOrder.update(existing[0].id, hubOrder);
         results.push({ order_id: orderId, action: 'updated', order_number: ord.shopify_order_number });
        } else {
         await base44.asServiceRole.entities.ShopifyOrder.create(hubOrder);
         results.push({ order_id: orderId, action: 'created', order_number: ord.shopify_order_number });
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