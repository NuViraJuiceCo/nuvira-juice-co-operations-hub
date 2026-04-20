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

    // Fetch orders and bag returns from customer app
    const [ordersRes, returnsRes] = await Promise.all([
      fetch(`${CUSTOMER_APP_API}/functions/getOrdersForSync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SYNC_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(date ? { date } : {}),
      }),
      fetch(`${CUSTOMER_APP_API}/functions/getBagReturnsForSync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SYNC_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ includeCompleted: true, date: date ? date : undefined }),
      }),
    ]);

    if (!ordersRes.ok) {
      const text = await ordersRes.text();
      throw new Error(`Customer app error ${ordersRes.status}: ${text.slice(0, 200)}`);
    }

    const ordersData = await ordersRes.json();
    const orders = ordersData.orders || [];

    // Sync bag returns if available
    try {
      if (returnsRes.ok) {
        const returnsData = await returnsRes.json();
        const bagReturns = returnsData.returns || [];
        
        for (const ret of bagReturns) {
          try {
            const existing = await base44.asServiceRole.entities.BagReturn.filter({
              customer_email: ret.customer_email,
              order_id: ret.order_id,
            });
            if (!existing || existing.length === 0) {
              await base44.asServiceRole.entities.BagReturn.create(ret);
            } else {
              // Update existing with latest status
              await base44.asServiceRole.entities.BagReturn.update(existing[0].id, ret);
            }
          } catch (err) {
            console.warn(`[OPTIMIZE-ROUTE] Failed to sync bag return for ${ret.customer_email}:`, err.message);
          }
        }
        console.log(`[OPTIMIZE-ROUTE] Synced ${bagReturns.length} bag returns`);
      }
    } catch (err) {
      console.warn(`[OPTIMIZE-ROUTE] Bag returns sync failed:`, err.message);
    }

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