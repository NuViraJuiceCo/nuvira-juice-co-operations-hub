import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();

    const shopifyOrder = payload.data;
    if (!shopifyOrder || !shopifyOrder.customer_email) {
      return Response.json({ message: 'No customer email, skipping notification' });
    }

    const products = shopifyOrder.line_items?.map(item => `${item.quantity}x ${item.title}`).join(', ') || 'Order';

    await base44.asServiceRole.integrations.Core.SendEmail({
      to: shopifyOrder.customer_email,
      subject: `Order Confirmed: ${shopifyOrder.shopify_order_number} 🎉`,
      body: `
<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background: #166534; padding: 24px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 22px;">nuVira Juice Co.</h1>
    <p style="color: rgba(255,255,255,0.8); margin: 4px 0 0;">Your order is confirmed!</p>
  </div>
  <div style="background: white; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #e5e7eb;">
    <p style="margin-top: 0;">Hi there,</p>
    <p>Thank you for your order! We're getting your fresh juices ready.</p>
    <div style="background: #f0fdf4; padding: 16px; border-radius: 6px; margin: 16px 0;">
      <p style="margin: 0 0 8px; font-weight: bold;">Order Details</p>
      <p style="margin: 4px 0;"><strong>Order #:</strong> ${shopifyOrder.shopify_order_number}</p>
      <p style="margin: 4px 0;"><strong>Items:</strong> ${products}</p>
      <p style="margin: 4px 0;"><strong>Total:</strong> $${(shopifyOrder.total_price || 0).toFixed(2)}</p>
      <p style="margin: 4px 0;"><strong>Scheduled:</strong> ${shopifyOrder.assigned_delivery_date || 'TBD'}</p>
    </div>
    <p style="color: #666; font-size: 14px;">We'll send you updates as your order progresses through production and fulfillment.</p>
    <p style="margin-bottom: 0; color: #999; font-size: 12px;">nuVira Juice Co. · Fresh. Cold-Pressed. Delivered.</p>
  </div>
</div>
      `.trim(),
    });

    console.log(`[NOTIFY] Order received email sent to ${shopifyOrder.customer_email}`);
    return Response.json({ success: true, notified: shopifyOrder.customer_email });
  } catch (error) {
    console.error('sendOrderReceivedNotification error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});