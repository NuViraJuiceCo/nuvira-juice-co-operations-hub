import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

// Map hub production_status → customer-facing status
const STATUS_MAP = {
  new:                    'order_received',
  awaiting_production:    'order_received',
  in_production:          'in_production',
  bottled:                'in_production',
  labeled:                'in_production',
  qc_checked:             'bottled_packed',
  packed:                 'bottled_packed',
  in_cold_storage:        'bottled_packed',
  assigned_for_pickup:    'ready_for_pickup',
  assigned_for_delivery:  'out_for_delivery',
  fulfilled:              'delivered',
  canceled:               null,
  refunded:               null,
};

const STATUS_MESSAGES = {
  order_received:     'Your order has been received and is being scheduled.',
  in_production:      'Your juice is being freshly prepared!',
  bottled_packed:     'Your order is bottled and packed — almost ready!',
  out_for_delivery:   'Your order is on its way!',
  arriving_soon:      'Your order is arriving soon!',
  delivered:          'Your order has been delivered. Enjoy!',
  ready_for_pickup:   'Your order is ready for pickup!',
  picked_up:          'Your order has been picked up. Enjoy!',
};

Deno.serve(async (req) => {
  try {
    // Validate auth header
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();

    if (!SYNC_SECRET || token !== SYNC_SECRET) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);

    // Fetch recently updated orders
    const orders = await base44.asServiceRole.entities.ShopifyOrder.list('-updated_date', 200);

    const result = [];

    for (const order of orders) {
      // Skip orders with no base44_order_id (customer app can't match them)
      if (!order.base44_order_id) continue;

      // Skip canceled/refunded
      const customerStatus = STATUS_MAP[order.production_status];
      if (!customerStatus) continue;

      result.push({
        id: order.base44_order_id,
        shopify_order_number: order.shopify_order_number,
        status: customerStatus,
        message: STATUS_MESSAGES[customerStatus] || '',
        assigned_delivery_date: order.assigned_delivery_date || null,
        updated_at: order.updated_date,
      });
    }

    console.log(`[GET-ORDER-UPDATES] Returning ${result.length} order status updates`);
    return Response.json({ orders: result });

  } catch (error) {
    console.error('[GET-ORDER-UPDATES] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});