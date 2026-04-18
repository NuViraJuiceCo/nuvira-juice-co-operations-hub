import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const { event, data } = body;

    if (!CUSTOMER_APP_API) {
      return Response.json({ error: 'CUSTOMER_APP_API_URL not set' }, { status: 500 });
    }

    // Only push updates, not creates/deletes
    if (event?.type !== 'update') {
      return Response.json({ success: true, skipped: 'Only updates are pushed to customer app' });
    }

    const orderId = event?.entity_id;

    // Map hub ShopifyOrder fields to customer app order fields
    const statusUpdate = {
      hub_order_id: orderId,
      production_status: data?.production_status,
      fulfillment_status: data?.fulfillment_status,
      assigned_delivery_date: data?.assigned_delivery_date,
      sync_status: data?.sync_status,
    };

    const response = await fetch(`${CUSTOMER_APP_API}/functions/syncOrderStatusFromHub`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SYNC_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(statusUpdate),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Customer app responded ${response.status}: ${text}`);
    }

    console.log(`[PUSH-ORDER-STATUS] Order ${orderId} status pushed to customer app`);
    return Response.json({ success: true, order_id: orderId });
  } catch (error) {
    console.error('[PUSH-ORDER-STATUS] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});