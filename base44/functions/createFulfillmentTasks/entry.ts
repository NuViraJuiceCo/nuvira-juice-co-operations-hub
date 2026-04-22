import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { order_id } = await req.json();

    if (!order_id) {
      return Response.json({ error: 'Missing order_id' }, { status: 400 });
    }

    const order = await base44.asServiceRole.entities.ShopifyOrder.filter({ id: order_id });
    if (!order || order.length === 0) {
      return Response.json({ error: 'Order not found' }, { status: 404 });
    }

    const o = order[0];

    // Only create fulfillment task if not already created
    const existing = await base44.asServiceRole.entities.FulfillmentTask.filter({ order_id: o.id });
    if (existing && existing.length > 0) {
      return Response.json({ status: 'already_exists', task_id: existing[0].id });
    }

    // Build items summary
    const itemsSummary = o.line_items?.length > 0
      ? `${o.line_items.length} item(s): ${o.line_items.map(i => `${i.quantity || 1}x ${i.title}`).join(', ')}`
      : 'No items';

    const task = await base44.asServiceRole.entities.FulfillmentTask.create({
      customer_name: o.customer_email || 'Customer',
      fulfillment_type: o.fulfillment_method === 'delivery' ? 'Delivery' : o.fulfillment_method === 'pickup' ? 'Pickup' : 'Wholesale',
      time_window: o.customer_notes || '',
      status: 'Unassigned',
      scheduled_date: o.assigned_delivery_date || o.requested_delivery_date || new Date().toISOString().split('T')[0],
      address: o.delivery_address || '',
      items_summary: itemsSummary,
      order_id: o.id,
    });

    console.log(`[CREATE-FULFILLMENT] Created task ${task.id} for order ${o.id}`);
    return Response.json({ status: 'success', task_id: task.id });
  } catch (error) {
    console.error('[CREATE-FULFILLMENT] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});