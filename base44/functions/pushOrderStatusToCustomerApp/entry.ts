import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { orderId, orderData } = await req.json();

    if (!CUSTOMER_APP_API || !SYNC_SECRET) {
      return Response.json({ error: 'Customer app API not configured' }, { status: 500 });
    }

    if (!orderId || !orderData) {
      return Response.json({ error: 'Missing orderId or orderData' }, { status: 400 });
    }

    // Push order update to customer app
    const response = await fetch(`${CUSTOMER_APP_API}/functions/receiveOrderStatusUpdate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SYNC_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        order_id: orderData.order_id,
        order_number: orderData.order_number || null,
        customer_email: orderData.customer_email || null,
        status: orderData.status,
        fulfillment_status: orderData.fulfillment_status || null,
        fulfillment_type: orderData.fulfillment_type,
        delivery_address: orderData.delivery_address,
        notes: orderData.notes,
        // ── Delivery outcome fields ──
        delivered_at: orderData.delivered_at || null,
        delivery_photo_url: orderData.delivery_photo_url || null,
        delivery_drop_location: orderData.delivery_drop_location || null,
        updated_at: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[PUSH-STATUS] Customer app error ${response.status}: ${text.slice(0, 200)}`);
      throw new Error(`Customer app rejected update: ${response.status}`);
    }

    const result = await response.json();
    console.log(`[PUSH-STATUS] Order ${orderData.order_id} status synced to customer app`);
    return Response.json({ status: 'success', result });
  } catch (error) {
    console.error('[PUSH-STATUS] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});