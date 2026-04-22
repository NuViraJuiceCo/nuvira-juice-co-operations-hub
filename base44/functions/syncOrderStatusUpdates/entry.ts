import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    if (!CUSTOMER_APP_API || !SYNC_SECRET) {
      return Response.json({ error: 'Customer app API not configured' }, { status: 500 });
    }

    // Fetch all orders with production_status that needs syncing
    const orders = await base44.asServiceRole.entities.ShopifyOrder.list('-updated_date', 100);

    if (!Array.isArray(orders) || orders.length === 0) {
      return Response.json({ status: 'success', synced: 0 });
    }

    let synced = 0;
    const errors = [];

    for (const order of orders) {
      if (!order || !order.shopify_order_id) continue;

      try {
        const response = await fetch(`${CUSTOMER_APP_API}/functions/pushOrderStatusToCustomerApp`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SYNC_SECRET}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            order_id: order.shopify_order_id,
            order_number: order.shopify_order_number,
            status: order.production_status,
            fulfillment_method: order.fulfillment_method,
            delivery_address: order.delivery_address,
            notes: order.internal_notes,
            updated_at: new Date().toISOString(),
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          errors.push({ order_id: order.id, error: `${response.status}: ${text.slice(0, 100)}` });
          continue;
        }

        synced++;
        console.log(`[SYNC-STATUS] Synced order ${order.shopify_order_number}`);
      } catch (err) {
        errors.push({ order_id: order.id, error: err.message });
      }
    }

    return Response.json({
      status: errors.length === 0 ? 'success' : 'partial',
      synced,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('[SYNC-STATUS] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});