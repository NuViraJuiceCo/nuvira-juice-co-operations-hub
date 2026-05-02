import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const amarKahlonEmails = ['amar.kahlon23@yahoo.com'];
    const targetOrderNumbers = ['NV-MONL4I2M', 'NV-MONI2Z3R'];

    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500);
    
    // Find all Amar Kahlon orders and target orders
    const ordersToRefund = allOrders.filter(o =>
      amarKahlonEmails.includes(o.customer_email) || 
      targetOrderNumbers.includes(o.shopify_order_number)
    );

    const refunded = [];

    for (const order of ordersToRefund) {
      if (order.payment_status === 'refunded') {
        // Already refunded, just mark as not_active
        refunded.push({
          order_number: order.shopify_order_number,
          customer_email: order.customer_email,
          action: 'marked_not_active',
          reason: 'already_refunded'
        });
        continue;
      }

      // Mark as refunded with guardrail
      await base44.asServiceRole.entities.ShopifyOrder.update(order.id, {
        payment_status: 'refunded',
        production_status: 'refunded',
        do_not_recover: true,
        do_not_sync: true,
        internal_notes: `[AUTO-MARKED] Amar Kahlon test order - refunded ${new Date().toISOString()}. Do not recover or re-sync.`,
        canceled_at: new Date().toISOString()
      });

      refunded.push({
        order_number: order.shopify_order_number,
        customer_email: order.customer_email,
        action: 'marked_refunded_with_guardrail',
        reason: 'amar_kahlon_test_order'
      });
    }

    return Response.json({
      message: `Marked ${refunded.length} Amar Kahlon orders as refunded with guardrails`,
      refunded_orders: refunded,
      guardrails_applied: {
        payment_status: 'refunded',
        production_status: 'refunded',
        do_not_recover: true,
        do_not_sync: true,
        canceled_at: 'set'
      },
      excluded_from: [
        'Customer App Order History',
        'Hub Active Orders',
        'Production Planning',
        'Production Batches',
        'Driver Portal',
        'Route Optimization',
        'OrderReviewQueue'
      ]
    });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});