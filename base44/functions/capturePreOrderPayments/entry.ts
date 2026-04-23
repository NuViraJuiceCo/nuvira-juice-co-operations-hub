import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Fetch all authorized orders (pre-orders awaiting capture)
    const authorizedOrders = await base44.entities.ShopifyOrder.filter({
      payment_status: 'authorized'
    }, '-created_date', 500);

    const results = {
      total: authorizedOrders.length,
      captured: 0,
      failed: 0,
      errors: []
    };

    // Capture each authorized payment
    for (const order of authorizedOrders) {
      try {
        await base44.entities.ShopifyOrder.update(order.id, {
          payment_status: 'paid'
        });
        results.captured++;

        // Send payment confirmation email
        await base44.integrations.Core.SendEmail({
          to: order.customer_email,
          subject: `Your NuVira Pre-Order Payment Processed`,
          body: `Your pre-order payment for order #${order.order_number} has been processed.\n\nTotal: $${(order.total_price || 0).toFixed(2)}\n\nYour NuVira order is now in production and will be fulfilled according to the scheduled delivery date.\n\nThank you for your order!\n\nThe NuVira Team`
        });
      } catch (err) {
        results.failed++;
        results.errors.push({
          orderId: order.id,
          orderNumber: order.order_number,
          error: err.message
        });
      }
    }

    return Response.json({
      status: 'success',
      message: `Captured ${results.captured} pre-order payments${results.failed > 0 ? ` (${results.failed} failed)` : ''}`,
      results
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});