import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();

    const shopifyOrder = payload.data;
    if (!shopifyOrder || shopifyOrder.production_status !== 'new') {
      return Response.json({ message: 'Order already processed or invalid', skipped: true });
    }

    // Extract product titles from line items
    const products = shopifyOrder.line_items?.map(item => item.title).join(', ') || 'Multiple Items';
    const totalUnits = shopifyOrder.line_items?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 1;

    // Create production batch
    const batchId = `BATCH-${new Date().getFullYear()}-${String(Math.random()).slice(2, 6).toUpperCase()}`;
    const batch = await base44.asServiceRole.entities.ProductionBatch.create({
      batch_id: batchId,
      product_name: products,
      status: 'Planned',
      planned_units: totalUnits,
      production_date: shopifyOrder.assigned_delivery_date || new Date().toISOString().split('T')[0],
      notes: `Order ${shopifyOrder.shopify_order_number} · Customer: ${shopifyOrder.customer_email || 'N/A'}`,
    });

    // Create fulfillment task
    const task = await base44.asServiceRole.entities.FulfillmentTask.create({
      customer_name: shopifyOrder.customer_email?.split('@')[0] || 'Customer',
      fulfillment_type: shopifyOrder.fulfillment_method === 'delivery' ? 'Delivery' : shopifyOrder.fulfillment_method === 'pickup' ? 'Pickup' : 'Delivery',
      time_window: '9am-5pm',
      status: 'Unassigned',
      scheduled_date: shopifyOrder.assigned_delivery_date || new Date().toISOString().split('T')[0],
      address: shopifyOrder.delivery_address || '',
      items_summary: products,
      order_id: shopifyOrder.shopify_order_number,
    });

    // Update ShopifyOrder production status
    await base44.asServiceRole.entities.ShopifyOrder.update(shopifyOrder.id, {
      production_status: 'awaiting_production',
    });

    // Create notification for admins
    const admins = await base44.asServiceRole.entities.User.list();
    const adminEmails = admins.filter(u => u.role === 'admin').map(u => u.email);

    for (const email of adminEmails) {
      if (email) {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: email,
          subject: `📦 New Order Received: ${shopifyOrder.shopify_order_number}`,
          body: `
<div style="font-family: sans-serif; max-width: 600px;">
  <div style="background: #166534; padding: 20px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0;">New Order Received</h1>
  </div>
  <div style="background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px;">
    <p><strong>Order:</strong> ${shopifyOrder.shopify_order_number}</p>
    <p><strong>Customer:</strong> ${shopifyOrder.customer_email || 'N/A'}</p>
    <p><strong>Total:</strong> $${(shopifyOrder.total_price || 0).toFixed(2)}</p>
    <p><strong>Items:</strong> ${products}</p>
    <p><strong>Fulfillment:</strong> ${shopifyOrder.fulfillment_method}</p>
    <p style="color: #666; font-size: 12px; margin-top: 20px;">Production batch ${batchId} created. Fulfillment task assigned.</p>
  </div>
</div>
          `.trim(),
        });
      }
    }

    console.log(`[PROCESS] Created batch ${batchId} and fulfillment task for order ${shopifyOrder.shopify_order_number}`);

    return Response.json({
      success: true,
      batch_id: batch.id,
      task_id: task.id,
      order_id: shopifyOrder.id,
    });
  } catch (error) {
    console.error('processShopifyOrder error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});