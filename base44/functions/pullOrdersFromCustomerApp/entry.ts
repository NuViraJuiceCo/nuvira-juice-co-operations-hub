import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    if (!CUSTOMER_APP_API || !SYNC_SECRET) {
      return Response.json({ error: 'Customer app API not configured' }, { status: 500 });
    }

    // Fetch orders from customer app
    const response = await fetch(`${CUSTOMER_APP_API}/functions/getOrdersForSync`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SYNC_SECRET}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Customer app error ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = await response.json();
    const orders = data.orders || [];

    if (!Array.isArray(orders)) {
      return Response.json({ error: 'Invalid response from customer app' }, { status: 500 });
    }

    // Upsert orders into hub Order entity
    const results = [];
    for (const ord of orders) {
      try {
        // Check if exists by order_id
        const existing = await base44.asServiceRole.entities.Order.filter({
          order_id: ord.order_id,
        });

        const hubOrder = {
          order_id: ord.order_id,
          customer_name: ord.customer_name || '',
          customer_email: ord.customer_email || '',
          channel: ord.channel || 'NuVira Juice App',
          status: ord.status || 'New',
          payment_status: ord.payment_status || 'Pending',
          fulfillment_type: ord.fulfillment_type || 'Delivery',
          fulfillment_window: ord.fulfillment_window || '',
          subtotal: ord.subtotal || 0,
          tax: ord.tax || 0,
          discount: ord.discount || 0,
          total: ord.total || 0,
          items: ord.items || [],
          delivery_address: ord.delivery_address || '',
          notes: ord.notes || '',
          sync_status: 'synced',
        };

        if (existing && existing.length > 0) {
          await base44.asServiceRole.entities.Order.update(existing[0].id, hubOrder);
          results.push({ order_id: ord.order_id, action: 'updated' });
        } else {
          await base44.asServiceRole.entities.Order.create(hubOrder);
          results.push({ order_id: ord.order_id, action: 'created' });
        }
      } catch (err) {
        results.push({
          order_id: ord.order_id,
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