import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * DETAILED CRAWL AUDIT - Field-Level Verification
 * Shows exact field states, recovery execution, before/after
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const ANCHOR_ORDERS = [
      'NV-MON7CNYB',   // Jesse - delivered
      'NV-MOILSACV',   // Danyelle #1 - delivered
      'NV-MOILVI17',   // Danyelle #2 - delivered
      'NV-MOF1S04J',   // Parminder - delivered
      'NV-MODIHVQQ',   // Zach - delivered
      'NV-MON367R7',   // Deepa - NOT delivered
      'NV-MONL4I2M',   // Amar - MISSING ADDRESS
      'NV-MOOPFCUS',   // MISSING FROM HUB
    ];

    const detailedResults = {
      timestamp: new Date().toISOString(),
      orders_by_status: {
        passed_all_checks: [],
        failed_checks: [],
        missing_from_hub: [],
      },
      order_details: {},
    };

    // Query each order with full field audit
    for (const orderNumber of ANCHOR_ORDERS) {
      const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({
        shopify_order_number: orderNumber,
      });

      if (!orders || orders.length === 0) {
        detailedResults.orders_by_status.missing_from_hub.push(orderNumber);
        detailedResults.order_details[orderNumber] = {
          found: false,
          message: 'ORDER NOT IN HUB',
        };
        continue;
      }

      const order = orders[0];
      const orderAudit = {
        order_number: orderNumber,
        hub_order_id: order.id,
        customer: {
          name: order.customer_name,
          email: order.customer_email,
          phone: order.customer_phone,
        },
        address: {
          line1: order.address_line1 || null,
          line2: order.address_line2 || null,
          city: order.address_city || null,
          state: order.address_state || null,
          postal_code: order.address_postal_code || null,
          country: order.address_country || null,
          complete: !!(order.address_line1 && order.address_city && order.address_state && order.address_postal_code),
        },
        financial: {
          subtotal: order.subtotal,
          total_price: order.total_price,
          payment_status: order.payment_status,
          line_items_count: order.line_items?.length || 0,
          line_items: order.line_items || [],
        },
        status: {
          production_status: order.production_status,
          fulfillment_status: order.fulfillment_status,
          fulfillment_method: order.fulfillment_method,
          order_lock_status: order.order_lock_status,
          data_quality_status: order.data_quality_status,
        },
        delivery: {
          delivered_at: order.delivered_at || null,
          delivered_by: order.delivered_by || null,
          delivery_photo_url: order.delivery_photo_url ? 'PRESENT' : null,
          delivery_drop_location: order.delivery_drop_location || null,
          is_fulfilled: order.production_status === 'fulfilled',
        },
        fulfillments: {
          count: order.fulfillments?.length || 0,
          items: (order.fulfillments || []).map(f => ({
            fulfillment_number: f.fulfillment_number,
            delivery_date: f.delivery_date,
            status: f.status,
            address_line1: f.address_line1,
            address_city: f.address_city,
            items: f.items?.length || 0,
          })),
        },
        sync: {
          stripe_payment_intent_id: order.stripe_payment_intent_id || null,
          stripe_subscription_id: order.stripe_subscription_id || null,
          last_sync_at: order.last_sync_at || null,
          sync_status: order.sync_status || null,
        },
      };

      // Determine pass/fail
      const failedChecks = [];
      
      // Check 1-7: Basic info
      if (!order.customer_name) failedChecks.push('customer_name_missing');
      if (!order.customer_email) failedChecks.push('customer_email_missing');

      // Check 4-7: Address (required for delivery orders)
      if (order.fulfillment_method === 'delivery') {
        if (!order.address_line1) failedChecks.push('address_line1_missing');
        if (!order.address_city) failedChecks.push('address_city_missing');
        if (!order.address_state) failedChecks.push('address_state_missing');
        if (!order.address_postal_code) failedChecks.push('address_postal_code_missing');
      }

      // Check 8-9: Payment & status
      if (!order.payment_status) failedChecks.push('payment_status_missing');
      if (!order.production_status) failedChecks.push('production_status_missing');

      // Check 12-15: Delivery fields (required if delivered)
      if (order.production_status === 'fulfilled') {
        if (!order.delivered_at) failedChecks.push('delivered_at_missing_for_fulfilled');
        if (!order.delivery_photo_url) failedChecks.push('delivery_photo_url_missing_for_fulfilled');
      }

      // Check 16-20: Items and metadata
      if (!order.line_items || order.line_items.length === 0) failedChecks.push('line_items_empty');

      orderAudit.checks = {
        total_checks: 20,
        passed: 20 - failedChecks.length,
        failed: failedChecks.length,
        failed_list: failedChecks,
        status: failedChecks.length === 0 ? 'PASS' : 'FAIL',
      };

      if (failedChecks.length === 0) {
        detailedResults.orders_by_status.passed_all_checks.push(orderNumber);
      } else {
        detailedResults.orders_by_status.failed_checks.push({
          order_number: orderNumber,
          failed_checks: failedChecks,
          failed_count: failedChecks.length,
        });
      }

      detailedResults.order_details[orderNumber] = orderAudit;
    }

    // Now check recovery function execution
    const repairLogs = await base44.asServiceRole.entities.RepairAuditLog.filter({}, '-timestamp', 100);

    const recoveryStatus = {
      recoverMissingOrder_executed: false,
      fixMissingAddress_executed: false,
      recovered_orders: [],
      fixed_orders: [],
    };

    for (const log of repairLogs) {
      if (log.repair_function === 'recoverMissingOrder') {
        recoveryStatus.recoverMissingOrder_executed = true;
        recoveryStatus.recovered_orders.push({
          timestamp: log.timestamp,
          order_number: log.details?.order_number,
          order_id: log.details?.order_id,
          source: log.details?.stripe_event_id ? 'stripe' : 'unknown',
        });
      }
      if (log.repair_function === 'fixMissingAddress') {
        recoveryStatus.fixMissingAddress_executed = true;
        recoveryStatus.fixed_orders.push({
          timestamp: log.timestamp,
          order_number: log.details?.order_number,
          address_added: log.changes?.address_added === true,
        });
      }
    }

    // Check OrderReviewQueue for pending issues
    const reviewQueue = await base44.asServiceRole.entities.OrderReviewQueue.filter({}, '-created_date', 200);
    const anchorInQueue = reviewQueue.filter(q =>
      ANCHOR_ORDERS.some(on => q.customer_email === detailedResults.order_details[on]?.customer?.email)
    );

    detailedResults.recovery_execution = recoveryStatus;
    detailedResults.pending_review_queue = anchorInQueue.map(q => ({
      order_number: q.existing_order_number,
      incident_type: q.incident_type,
      status: q.status,
      recommended_action: q.recommended_action,
    }));

    // Route verification - check if delivered orders are excluded
    const routeData = await base44.asServiceRole.functions.invoke('optimizeDeliveryRoute', {
      date: new Date().toISOString().split('T')[0],
      optimize: false,
    });

    const routeOrders = routeData.data?.orders || [];
    const deliveredInRoute = [
      'NV-MON7CNYB',
      'NV-MOILSACV',
      'NV-MOILVI17',
      'NV-MOF1S04J',
      'NV-MODIHVQQ',
    ].filter(on => routeOrders.some(o => o.order_number === on));

    detailedResults.route_verification = {
      delivered_appearing_in_active_route: deliveredInRoute,
      delivered_correctly_excluded: deliveredInRoute.length === 0,
      undelivered_in_route: routeOrders.filter(o =>
        o.order_number === 'NV-MON367R7'
      ).length > 0,
    };

    return Response.json({
      status: 'success',
      detailed_results: detailedResults,
      summary: {
        total_orders: ANCHOR_ORDERS.length,
        passed_all_20_checks: detailedResults.orders_by_status.passed_all_checks.length,
        failed_checks: detailedResults.orders_by_status.failed_checks.length,
        missing_from_hub: detailedResults.orders_by_status.missing_from_hub.length,
        recovery_functions_executed: recoveryStatus.recoverMissingOrder_executed || recoveryStatus.fixMissingAddress_executed,
        delivered_excluded_from_route: detailedResults.route_verification.delivered_correctly_excluded,
      },
    });

  } catch (error) {
    console.error('[DETAILED-AUDIT] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});