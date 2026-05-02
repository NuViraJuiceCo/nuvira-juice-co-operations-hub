import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const STRIPE_API_KEY = Deno.env.get('STRIPE_API_KEY');

/**
 * Audit all ShopifyOrder records against Stripe refund status.
 * Identifies orders with actual refunds (including reversed) that need status updates.
 */

async function getRefundStatusForPaymentIntent(paymentIntentId) {
  if (!STRIPE_API_KEY || !paymentIntentId) return null;

  try {
    // Fetch all refunds for this payment intent
    const refundsRes = await fetch(
      `https://api.stripe.com/v1/refunds?limit=100`,
      { headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` } }
    );

    if (!refundsRes.ok) return null;

    const refundsData = await refundsRes.json();
    const allRefunds = refundsData.data || [];

    // Filter refunds for this specific payment intent
    const piRefunds = allRefunds.filter(r => r.payment_intent === paymentIntentId);

    if (piRefunds.length === 0) return null;

    // Check refund statuses (succeeded, failed, reversed)
    const hasSucceeded = piRefunds.some(r => r.status === 'succeeded');
    const hasReversed = piRefunds.some(r => r.status === 'reversed');
    const hasFailed = piRefunds.some(r => r.status === 'failed');

    return {
      has_refunds: true,
      succeeded_refunds: piRefunds.filter(r => r.status === 'succeeded'),
      reversed_refunds: piRefunds.filter(r => r.status === 'reversed'),
      failed_refunds: piRefunds.filter(r => r.status === 'failed'),
      total_refund_amount: piRefunds
        .filter(r => r.status === 'succeeded')
        .reduce((sum, r) => sum + r.amount, 0) / 100,
      statuses: { succeeded: hasSucceeded, reversed: hasReversed, failed: hasFailed },
    };
  } catch (err) {
    console.error(`Failed to fetch refunds for PI ${paymentIntentId}:`, err.message);
    return null;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all ShopifyOrder records
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 1000);

    if (!allOrders || allOrders.length === 0) {
      return Response.json({
        status: 'success',
        total_orders_checked: 0,
        orders_needing_refund_update: [],
        message: 'No orders found',
      });
    }

    const ordersNeedingUpdate = [];
    const ordersAlreadyRefunded = [];
    const ordersWithReversedRefunds = [];
    let checkedCount = 0;
    let skippedCount = 0;

    // Check each order
    for (const order of allOrders) {
      // Skip if no payment intent
      if (!order.stripe_payment_intent_id) {
        skippedCount++;
        continue;
      }

      checkedCount++;

      // Get refund status from Stripe
      const refundStatus = await getRefundStatusForPaymentIntent(order.stripe_payment_intent_id);

      if (!refundStatus || !refundStatus.has_refunds) {
        continue; // No refunds for this order
      }

      const currentPaymentStatus = order.payment_status;
      const shouldBeRefunded = refundStatus.succeeded_refunds.length > 0;
      const hasReversedRefunds = refundStatus.reversed_refunds.length > 0;

      // Case 1: Order has succeeded refunds but payment_status isn't "refunded"
      if (shouldBeRefunded && currentPaymentStatus !== 'refunded') {
        ordersNeedingUpdate.push({
          order_id: order.id,
          order_number: order.shopify_order_number,
          customer_email: order.customer_email,
          current_payment_status: currentPaymentStatus,
          stripe_payment_intent: order.stripe_payment_intent_id,
          refund_count: refundStatus.succeeded_refunds.length,
          total_refund_amount: refundStatus.total_refund_amount,
          has_reversed: hasReversedRefunds,
          action_needed: 'UPDATE_TO_REFUNDED',
        });
      }

      // Case 2: Order has reversed refunds
      if (hasReversedRefunds) {
        ordersWithReversedRefunds.push({
          order_id: order.id,
          order_number: order.shopify_order_number,
          customer_email: order.customer_email,
          current_payment_status: currentPaymentStatus,
          stripe_payment_intent: order.stripe_payment_intent_id,
          reversed_count: refundStatus.reversed_refunds.length,
          succeeded_count: refundStatus.succeeded_refunds.length,
          action_needed: 'REVIEW_REVERSED_REFUNDS',
        });
      }

      // Case 3: Order already marked as refunded and has refunds in Stripe
      if (shouldBeRefunded && currentPaymentStatus === 'refunded') {
        ordersAlreadyRefunded.push({
          order_id: order.id,
          order_number: order.shopify_order_number,
          customer_email: order.customer_email,
          refund_count: refundStatus.succeeded_refunds.length,
          total_refund_amount: refundStatus.total_refund_amount,
          status: 'ALREADY_CORRECT',
        });
      }
    }

    return Response.json({
      status: 'success',
      total_orders_in_system: allOrders.length,
      orders_with_payment_intent: checkedCount,
      orders_skipped_no_intent: skippedCount,
      summary: {
        orders_needing_refund_update: ordersNeedingUpdate.length,
        orders_already_refunded_correctly: ordersAlreadyRefunded.length,
        orders_with_reversed_refunds: ordersWithReversedRefunds.length,
      },
      orders_needing_refund_update: ordersNeedingUpdate,
      orders_already_refunded_correctly: ordersAlreadyRefunded,
      orders_with_reversed_refunds: ordersWithReversedRefunds,
      next_step: ordersNeedingUpdate.length > 0
        ? 'Run updateRefundedOrdersFromAudit to update all flagged orders'
        : 'All orders are in sync with Stripe',
    });

  } catch (error) {
    console.error('[AUDIT-STRIPE-REFUNDS] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});