import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Check status of potentially missing orders from Customer App
 * NV-MONL4I2M, NV-MOOPFCUS
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const orderNumbers = ['NV-MONL4I2M', 'NV-MOOPFCUS'];
    const results = [];

    for (const orderNumber of orderNumbers) {
      // Check if order exists in Hub
      const hubOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({
        shopify_order_number: orderNumber,
      });

      if (hubOrders && hubOrders.length > 0) {
        const order = hubOrders[0];
        
        // Check if in review queue
        const reviewQueue = await base44.asServiceRole.entities.OrderReviewQueue.filter({
          existing_order_id: order.id,
        });

        results.push({
          order_number: orderNumber,
          status: 'FOUND_IN_HUB',
          hub_order_id: order.id,
          customer_email: order.customer_email,
          customer_name: order.customer_name,
          payment_status: order.payment_status,
          production_status: order.production_status,
          data_quality_status: order.data_quality_status,
          created_date: order.created_date,
          line_items_count: order.line_items?.length || 0,
          total_price: order.total_price,
          in_review_queue: reviewQueue.length > 0,
          review_queue_entries: reviewQueue.map(r => ({
            incident_type: r.incident_type,
            issue_description: r.issue_description,
            status: r.status,
            recommended_action: r.recommended_action,
          })),
        });
      } else {
        // Not in Hub - check Stripe and StripeEventLog
        const stripeEvents = await base44.asServiceRole.entities.StripeEventLog.filter({}, '-timestamp', 100);
        const relevantEvents = stripeEvents.filter(e => 
          e.notes?.includes(orderNumber) || 
          e.stripe_object_id?.includes(orderNumber)
        );

        results.push({
          order_number: orderNumber,
          status: 'NOT_FOUND_IN_HUB',
          stripe_events_found: relevantEvents.length,
          stripe_event_details: relevantEvents.map(e => ({
            event_type: e.event_type,
            event_status: e.status,
            failure_reason: e.failure_reason,
            notes: e.notes,
          })),
          recommendation: relevantEvents.length > 0 ? 'RECOVER_FROM_STRIPE' : 'INVESTIGATE_SOURCE',
        });
      }
    }

    return Response.json({
      status: 'success',
      timestamp: new Date().toISOString(),
      orders_checked: results,
      summary: {
        found_in_hub: results.filter(r => r.status === 'FOUND_IN_HUB').length,
        missing: results.filter(r => r.status === 'NOT_FOUND_IN_HUB').length,
        in_review_queue: results.filter(r => r.in_review_queue).length,
      },
    });

  } catch (error) {
    console.error('[CHECK-MISSING] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});