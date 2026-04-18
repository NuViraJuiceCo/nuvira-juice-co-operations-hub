import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    // Verify shared secret
    const secret = req.headers.get('x-sync-secret');
    if (secret !== Deno.env.get('CUSTOMER_APP_SYNC_SECRET')) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const body = await req.json();

    console.log('[SYNC] Incoming payload:', JSON.stringify(body, null, 2));

    // Support both wrapped { event, data: {...} } and flat order payloads
    const order = body.data || body;

    const hubPayload = {
      shopify_order_id: `base44_${order.id || 'unknown'}`,
      shopify_order_number: order.order_number || (order.id ? `#${order.id.slice(-6).toUpperCase()}` : '#UNKNOWN'),
      base44_order_id: order.id,
      source_channel: 'online',
      customer_email: order.customer_email || '',
      customer_phone: order.contact_phone || '',
      line_items: (order.items || []).map(item => ({
        title: item.title || '',
        quantity: item.quantity || 1,
        price: item.price || 0,
      })),
      fulfillment_method: order.fulfillment_type || 'delivery',
      delivery_address: order.delivery_address || '',
      requested_delivery_date: order.estimated_delivery_date || '',
      payment_status: order.payment_captured ? 'paid' : 'pending',
      fulfillment_status: order.status || 'order_received',
      subtotal: order.subtotal || 0,
      total_price: order.total || 0,
      customer_notes: order.notes || '',
      production_status: 'new',
      assigned_delivery_date: order.estimated_delivery_date || '',
      tags: order.is_preorder ? ['preorder'] : [],
      internal_notes: order.is_preorder ? `Pre-order — fulfillment: ${order.preorder_fulfillment_date || 'TBD'}` : '',
      sync_status: 'synced',
      last_sync_at: new Date().toISOString(),
    };

    const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({ base44_order_id: order.id });
    let result;
    if (existing?.length > 0) {
      result = await base44.asServiceRole.entities.ShopifyOrder.update(existing[0].id, hubPayload);
      console.log(`[SYNC] Updated ShopifyOrder ${result.id} for customer app order ${order.id}`);
    } else {
      result = await base44.asServiceRole.entities.ShopifyOrder.create(hubPayload);
      console.log(`[SYNC] Created ShopifyOrder ${result.id} for customer app order ${order.id}`);
    }

    return Response.json({ success: true, id: result.id, synced_at: new Date().toISOString() });
  } catch (error) {
    console.error('receiveOrderFromCustomerApp error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});