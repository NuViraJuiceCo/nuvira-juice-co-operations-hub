import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * STRIPE ORDER INTEGRITY DETECTOR
 * 
 * Detects broken Stripe-linked orders that have been degraded:
 * - Orders marked #unknown that still have Stripe metadata
 * - Orders with blank customer_name but valid Stripe linkage
 * - Orders with total_price=0 but have line_items
 * - Subscription orders with broken fulfillment linkage
 * 
 * Used by Operations Manager to flag broken orders for repair
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const issues = [];

    // Load all orders with Stripe linkage
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500);

    for (const order of allOrders) {
      if (!order) continue;

      // Check 1: #unknown orders with Stripe metadata
      if (order.shopify_order_number === '#unknown' && (
        order.stripe_customer_id ||
        order.stripe_checkout_session_id ||
        order.stripe_payment_intent_id ||
        order.stripe_subscription_id
      )) {
        issues.push({
          order_id: order.id,
          order_number: order.shopify_order_number,
          customer_email: order.customer_email,
          issue_type: 'unknown_with_stripe_linkage',
          severity: 'critical',
          message: 'Order downgraded to #unknown but still has Stripe metadata',
          stripe_ids: {
            customer: order.stripe_customer_id,
            checkout: order.stripe_checkout_session_id,
            intent: order.stripe_payment_intent_id,
            subscription: order.stripe_subscription_id,
          },
        });
      }

      // Check 2: Stripe-linked orders with missing customer name
      if ((order.stripe_customer_id || order.stripe_checkout_session_id) && 
          (!order.customer_name || order.customer_name === 'Unknown')) {
        issues.push({
          order_id: order.id,
          order_number: order.shopify_order_number,
          customer_email: order.customer_email,
          issue_type: 'missing_customer_name',
          severity: 'high',
          message: 'Stripe-linked order missing customer name',
          current_state: {
            customer_name: order.customer_name,
            address: order.address_line1 ? `${order.address_line1}, ${order.address_city}` : 'missing',
            total: order.total_price,
          },
        });
      }

      // Check 3: Stripe-linked orders with zero total but have items
      if ((order.stripe_customer_id || order.stripe_payment_intent_id) && 
          order.total_price === 0 && 
          order.line_items && 
          order.line_items.length > 0) {
        issues.push({
          order_id: order.id,
          order_number: order.shopify_order_number,
          customer_email: order.customer_email,
          issue_type: 'zero_total_with_items',
          severity: 'critical',
          message: 'Stripe-linked order has items but total is 0',
          line_items: order.line_items.map(i => `${i.title} x${i.quantity}`),
        });
      }

      // Check 4: Subscription orders with missing/broken fulfillments
      if (order.stripe_subscription_id && (!order.fulfillments || order.fulfillments.length === 0)) {
        issues.push({
          order_id: order.id,
          order_number: order.shopify_order_number,
          customer_email: order.customer_email,
          issue_type: 'subscription_missing_fulfillments',
          severity: 'high',
          message: 'Subscription order missing fulfillment breakdown',
          stripe_subscription_id: order.stripe_subscription_id,
        });
      }

      // Check 5: Fulfillment orders missing parent linkage
      if (order.fulfillment_instance_date && (!order.subscription_parent_id || !order.source_invoice_id)) {
        issues.push({
          order_id: order.id,
          order_number: order.shopify_order_number,
          customer_email: order.customer_email,
          issue_type: 'fulfillment_missing_parent_linkage',
          severity: 'medium',
          message: 'Fulfillment order missing parent subscription/invoice linkage',
          fulfillment_instance_date: order.fulfillment_instance_date,
        });
      }

      // Check 6: Sync status broken but has valid Stripe linkage
      if (order.sync_status === 'failed' && (
        order.stripe_customer_id ||
        order.stripe_checkout_session_id ||
        order.stripe_subscription_id
      )) {
        issues.push({
          order_id: order.id,
          order_number: order.shopify_order_number,
          customer_email: order.customer_email,
          issue_type: 'sync_failed_with_valid_linkage',
          severity: 'high',
          message: 'Order sync marked failed but still has valid Stripe linkage',
          last_reconciliation_at: order.last_reconciliation_at,
        });
      }
    }

    return Response.json({
      total_orders_scanned: allOrders.length,
      total_issues_found: issues.length,
      critical_count: issues.filter(i => i.severity === 'critical').length,
      high_count: issues.filter(i => i.severity === 'high').length,
      issues,
    });
  } catch (error) {
    console.error('[DETECTOR] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});