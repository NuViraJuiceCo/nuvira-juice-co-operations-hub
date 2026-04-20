import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { date, optimize } = await req.json();

    if (!CUSTOMER_APP_API || !SYNC_SECRET) {
      return Response.json({ error: 'Customer app API not configured' }, { status: 500 });
    }

    // Fetch orders from customer app
    const response = await fetch(`${CUSTOMER_APP_API}/functions/getOrdersForSync`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SYNC_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(date ? { date } : {}),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Customer app error ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = await response.json();
    const orders = data.orders || [];

    if (!Array.isArray(orders) || orders.length === 0) {
      return Response.json({ status: 'success', orders: [], optimized_orders: [] });
    }

    // Filter to only undelivered orders
    const queuedOrders = orders.filter(o => o.status !== 'delivered');

    if (!optimize) {
      return Response.json({ 
        status: 'success', 
        orders: queuedOrders,
        optimized_orders: null,
        total_distance_miles: null,
        total_duration_minutes: null,
      });
    }

    // Basic optimization: sort by address (mock optimization)
    // In production, integrate with Google Routes API for real optimization
    const optimizedOrders = [...queuedOrders].sort((a, b) => {
      return (a.delivery_address || '').localeCompare(b.delivery_address || '');
    });

    return Response.json({ 
      status: 'success', 
      orders: queuedOrders,
      optimized_orders: optimizedOrders,
      total_distance_miles: Math.round(queuedOrders.length * 2.5), // Mock calculation
      total_duration_minutes: Math.round(queuedOrders.length * 15), // Mock calculation
    });

  } catch (error) {
    console.error('[OPTIMIZE-ROUTE] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});