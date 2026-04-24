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

    // Load ALL orders from local ShopifyOrder database (not from customer app)
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500);
    
    // Filter to orders for the selected date if provided
    let orders = allOrders;
    if (date) {
      orders = allOrders.filter(o => {
        // For subscription orders: check if any fulfillment matches the date
        if (o.source_channel === 'subscription' && o.fulfillments && o.fulfillments.length > 0) {
          return o.fulfillments.some(f => f.delivery_date && f.delivery_date === date);
        }

        // For non-subscription orders: only show if explicitly assigned to this date
        if (o.assigned_delivery_date && o.assigned_delivery_date === date) {
          return true;
        }
        if (o.requested_delivery_date && o.requested_delivery_date === date) {
          return true;
        }

        // Do NOT include pre-orders or new orders without explicit delivery assignments
        return false;
      });
    }

    // Optionally sync bag returns from customer app if configured
    if (CUSTOMER_APP_API && SYNC_SECRET) {
      try {
        const returnsRes = await fetch(`${CUSTOMER_APP_API}/functions/getBagReturnsForSync`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SYNC_SECRET}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ includeCompleted: true }),
        });
        
        if (returnsRes.ok) {
          const returnsData = await returnsRes.json();
          const bagReturns = returnsData.returns || [];
          console.log(`[OPTIMIZE-ROUTE] Syncing ${bagReturns.length} bag returns from customer app`);
          
          for (const ret of bagReturns) {
            try {
              const existing = await base44.asServiceRole.entities.BagReturn.filter({
                customer_email: ret.customer_email,
                order_id: ret.order_id,
              });
              if (!existing || existing.length === 0) {
                await base44.asServiceRole.entities.BagReturn.create(ret);
              } else {
                await base44.asServiceRole.entities.BagReturn.update(existing[0].id, ret);
              }
            } catch (err) {
              console.error(`[OPTIMIZE-ROUTE] Failed to sync bag return for ${ret.customer_email}:`, err);
            }
          }
        }
      } catch (err) {
        console.error(`[OPTIMIZE-ROUTE] Bag returns sync failed (non-critical):`, err);
      }
    }

    if (!Array.isArray(orders) || orders.length === 0) {
      return Response.json({ status: 'success', orders: [], optimized_orders: [] });
    }

    // Map ShopifyOrder to driver portal format and filter to undelivered orders
    const queuedOrders = orders
      .filter(o => o.production_status !== 'fulfilled')
      .map(o => {
        let fulfillmentsForDate = o.fulfillments || [];
        
        // For subscription orders on a specific date, only show the fulfillment for that date
        if (date && o.source_channel === 'subscription' && o.fulfillments && o.fulfillments.length > 0) {
          fulfillmentsForDate = o.fulfillments.filter(f => f.delivery_date && f.delivery_date.startsWith(date));
        }

        return {
          id: o.id,
          order_number: o.shopify_order_number,
          customer_email: o.customer_email,
          customer_name: o.customer_name,
          contact_phone: o.customer_phone,
          delivery_address: o.delivery_address,
          items: o.line_items || [],
          fulfillments: fulfillmentsForDate,
          status: o.production_status === 'fulfilled' ? 'delivered' : o.production_status,
          delivery_photo_url: o.delivery_photo_url,
          delivery_drop_location: o.delivery_drop_location,
          delivered_by: o.delivered_by,
          delivered_at: o.delivered_at,
          leg_duration_seconds: null,
        };
      });

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