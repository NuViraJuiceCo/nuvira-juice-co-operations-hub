/**
 * fetchCustomerProfile
 * Fetches raw orders from the customer app to find address data for a given email.
 * Used as a fallback when Stripe checkout has no shipping address.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const { email } = await req.json();
    if (!email) return Response.json({ error: 'email required' }, { status: 400 });

    // Fetch all orders from customer app and find ones matching this email
    const res = await fetch(`${CUSTOMER_APP_API}/functions/getAllOrdersForSync`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SYNC_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: SYNC_SECRET }),
    });

    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: `Customer app error ${res.status}: ${text.slice(0, 200)}` }, { status: 502 });
    }

    const data = await res.json();
    const orders = Array.isArray(data.orders) ? data.orders : (Array.isArray(data) ? data : []);

    const customerOrders = orders.filter(o =>
      (o.customer_email || '').toLowerCase() === email.toLowerCase()
    );

    // Extract first address found
    const withAddress = customerOrders.find(o =>
      o.address_line1 || o.delivery_address || o.address
    );

    return Response.json({
      email,
      total_orders: customerOrders.length,
      orders: customerOrders,
      address_found: withAddress ? {
        address_line1: withAddress.address_line1 || withAddress.delivery_address || withAddress.address || '',
        address_line2: withAddress.address_line2 || '',
        address_city: withAddress.address_city || withAddress.city || '',
        address_state: withAddress.address_state || withAddress.state || '',
        address_postal_code: withAddress.address_postal_code || withAddress.postal_code || withAddress.zip || '',
        address_country: withAddress.address_country || 'US',
      } : null,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});