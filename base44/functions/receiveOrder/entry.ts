import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    // Only accept POST
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const body = await req.json();

    // Validate required fields
    if (!body.order_id || !body.customer_name || !body.channel || !body.status || body.total === undefined) {
      return Response.json({
        error: 'Missing required fields: order_id, customer_name, channel, status, total'
      }, { status: 400 });
    }

    // Create the order
    const order = await base44.entities.Order.create({
      order_id: body.order_id,
      customer_name: body.customer_name,
      customer_email: body.customer_email || null,
      channel: body.channel,
      status: body.status,
      payment_status: body.payment_status || 'Pending',
      fulfillment_type: body.fulfillment_type || null,
      fulfillment_window: body.fulfillment_window || null,
      subtotal: body.subtotal || 0,
      tax: body.tax || 0,
      discount: body.discount || 0,
      total: body.total,
      items: body.items || [],
      delivery_address: body.delivery_address || null,
      notes: body.notes || null,
    });

    return Response.json({
      success: true,
      message: 'Order received',
      order_id: order.id
    }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});