import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Find newest paid order from Stripe/Customer App
 * Check if Hub received, accepted, or quarantined it
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get all orders sorted by creation date
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 10);
    const newestOrder = allOrders[0];

    if (!newestOrder) {
      return Response.json({ error: 'No orders found' }, { status: 404 });
    }

    // Get sync logs for newest order
    const syncLogs = await base44.asServiceRole.entities.OrderSyncLog.filter({
      order_id: newestOrder.id,
    }, '-sync_timestamp', 20);

    // Get review queue entries
    const reviewQueue = await base44.asServiceRole.entities.OrderReviewQueue.filter({}, '-created_date', 50);
    const queueForOrder = reviewQueue.filter(q => 
      q.existing_order_id === newestOrder.id || q.customer_email === newestOrder.customer_email
    );

    // Get Stripe event logs
    const stripeEvents = await base44.asServiceRole.entities.StripeEventLog.filter({
      customer_email: newestOrder.customer_email,
    }, '-timestamp', 20);

    return Response.json({
      status: 'success',
      newest_order: {
        order_number: newestOrder.shopify_order_number,
        order_id: newestOrder.id,
        customer_name: newestOrder.customer_name,
        customer_email: newestOrder.customer_email,
        created_date: newestOrder.created_date,
        payment_status: newestOrder.payment_status,
        production_status: newestOrder.production_status,
        order_lock_status: newestOrder.order_lock_status,
        total_price: newestOrder.total_price,
        line_items_count: newestOrder.line_items?.length || 0,
        data_quality_status: newestOrder.data_quality_status,
      },
      sync_history: {
        total_logs: syncLogs.length,
        recent_logs: syncLogs.slice(0, 5).map(log => ({
          timestamp: log.sync_timestamp,
          source: log.sync_source,
          action: log.action,
          success: log.success,
          reason: log.reason,
        })),
      },
      review_queue: {
        entries_for_order: queueForOrder.length,
        entries: queueForOrder.map(q => ({
          incident_type: q.incident_type,
          issue_description: q.issue_description,
          status: q.status,
          recommended_action: q.recommended_action,
        })),
      },
      stripe_events: {
        total_events: stripeEvents.length,
        recent_events: stripeEvents.slice(0, 3).map(e => ({
          event_type: e.event_type,
          status: e.status,
          timestamp: e.timestamp,
          failure_reason: e.failure_reason,
        })),
      },
      assessment: {
        received_by_hub: syncLogs.length > 0,
        accepted: newestOrder.data_quality_status === 'complete' || newestOrder.data_quality_status === 'verified',
        quarantined: queueForOrder.length > 0,
        status: queueForOrder.length > 0 ? 'QUARANTINED' : (syncLogs.length > 0 ? 'ACCEPTED' : 'NOT_RECEIVED'),
      },
    });

  } catch (error) {
    console.error('[NEWEST-ORDER] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});