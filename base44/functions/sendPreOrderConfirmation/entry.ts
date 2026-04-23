import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { orderId, orderData } = await req.json();

    // Get order details if not provided
    let order = orderData;
    if (!order && orderId) {
      order = await base44.asServiceRole.entities.ShopifyOrder.get(orderId);
    }

    if (!order || !order.customer_email) {
      return Response.json({ error: 'Order not found or invalid' }, { status: 400 });
    }

    // Send pre-order confirmation email
    await base44.integrations.Core.SendEmail({
      to: order.customer_email,
      subject: `Your NuVira Pre-Order Confirmation #${order.order_number}`,
      body: `Hi there!\n\nThank you for your NuVira pre-order!\n\nOrder: #${order.order_number}\nTotal: $${(order.total_price || 0).toFixed(2)}\n\nYour payment has been authorized and will be captured on May 1st, 2026. Your order will then move into production immediately.\n\nDelivery is scheduled for early June.\n\nWe appreciate your support and can't wait to get your fresh NuVira juices to you!\n\nQuestions? Reach out through the Support section in your account.\n\nThe NuVira Team 🥤`
    });

    return Response.json({ status: 'success', message: 'Pre-order confirmation sent' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});