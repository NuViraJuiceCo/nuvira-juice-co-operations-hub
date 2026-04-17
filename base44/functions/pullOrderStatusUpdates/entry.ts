import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    // Validate authorization
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    const secret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

    if (!token || token !== secret) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await req.json();
    const { since_timestamp, order_ids, production_status, fulfillment_status } = body;

    const base44 = createClientFromRequest(req);

    // Fetch orders based on filters
    let orders = [];
    if (order_ids && order_ids.length > 0) {
      // Fetch specific orders
      for (const orderId of order_ids) {
        const result = await base44.entities.ShopifyOrder.filter({ shopify_order_id: orderId });
        orders = orders.concat(result);
      }
    } else {
      // Fetch all orders with optional timestamp filter
      const allOrders = await base44.entities.ShopifyOrder.list('-updated_date', 500);
      if (since_timestamp) {
        const sinceTime = new Date(since_timestamp);
        orders = allOrders.filter(o => new Date(o.updated_date) >= sinceTime);
      } else {
        orders = allOrders;
      }
    }

    // Apply status filters (support both single string and array)
    if (production_status) {
      const statuses = Array.isArray(production_status) ? production_status : [production_status];
      orders = orders.filter(o => statuses.includes(o.production_status));
    }
    if (fulfillment_status) {
      const statuses = Array.isArray(fulfillment_status) ? fulfillment_status : [fulfillment_status];
      orders = orders.filter(o => statuses.includes(o.fulfillment_status));
    }

    // Format response with only essential sync fields
    const updates = orders.map(order => ({
      shopify_order_id: order.shopify_order_id,
      shopify_order_number: order.shopify_order_number,
      production_status: order.production_status,
      fulfillment_status: order.fulfillment_status,
      assigned_delivery_date: order.assigned_delivery_date,
      updated_at: order.updated_date,
      sync_status: order.sync_status,
    }));

    return Response.json({
      status: 'success',
      count: updates.length,
      updates: updates,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error pulling order updates:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});