import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();

    const order = payload.data;
    if (!order || !order.customer_email) {
      return Response.json({ message: 'No customer email, skipping', sent: false });
    }

    if (!CUSTOMER_APP_API) {
      console.warn('[ORDER-STATUS-EMAIL] Customer app API not configured, skipping');
      return Response.json({ message: 'Customer app API not configured', sent: false });
    }

    // Trigger the Customer App to send the status email to its own registered user
    const response = await fetch(`${CUSTOMER_APP_API}/sendOrderStatusEmail`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SYNC_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customer_email: order.customer_email,
        order_id: order.shopify_order_number || order.order_id,
        production_status: order.production_status,
        fulfillment_status: order.fulfillment_status,
        assigned_delivery_date: order.assigned_delivery_date,
      }),
    });

    if (response.ok) {
      console.log(`[ORDER-STATUS-EMAIL] Status email triggered for ${order.customer_email}`);
      return Response.json({ success: true, notified: order.customer_email });
    } else {
      const text = await response.text();
      console.error(`[ORDER-STATUS-EMAIL] Customer app failed: ${response.status} - ${text}`);
      return Response.json({ success: false, reason: `Customer app error: ${response.status}` });
    }
  } catch (error) {
    console.error('orderStatusEmail error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});