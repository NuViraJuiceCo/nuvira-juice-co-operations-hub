import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    // Validate authorization
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');

    if (!token || token !== SYNC_SECRET) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { since_timestamp, order_ids } = body;

    if (!CUSTOMER_APP_API) {
      return Response.json({ error: 'CUSTOMER_APP_API_URL not set' }, { status: 500 });
    }

    // Fetch order updates from customer app
    const response = await fetch(`${CUSTOMER_APP_API}/functions/getOrderUpdatesForSync`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SYNC_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ since_timestamp, order_ids }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Customer app responded ${response.status}: ${text}`);
    }

    const { orders: customerOrders } = await response.json();

    if (!Array.isArray(customerOrders)) {
      return Response.json({ error: 'Invalid response from customer app' }, { status: 500 });
    }

    // Sync order updates to hub database
    for (const orderData of customerOrders) {
      const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({ base44_order_id: orderData.id });
      if (existing?.length > 0) {
        const hubPayload = {
          production_status: orderData.production_status || 'new',
          fulfillment_status: orderData.fulfillment_status || 'order_received',
          assigned_delivery_date: orderData.assigned_delivery_date,
          sync_status: 'synced',
          last_sync_at: new Date().toISOString(),
        };
        await base44.asServiceRole.entities.ShopifyOrder.update(existing[0].id, hubPayload);
      }
    }

    console.log(`[PULL-ORDER-UPDATES] Synced ${customerOrders.length} order updates from customer app`);
    return Response.json({
      status: 'success',
      count: customerOrders.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error pulling order updates:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});