import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const params = await req.json().catch(() => ({}));
    const lookback_hours = params.lookback_hours || 24;

    const hub = base44.asServiceRole;
    const now = new Date();
    const cutoff = new Date(now.getTime() - lookback_hours * 60 * 60 * 1000);

    const out = {
      mode: 'LOYALTY AUTOMATION MONITOR (READ-ONLY)',
      executed_at: now.toISOString(),
      monitoring_window: {
        start: cutoff.toISOString(),
        end: now.toISOString(),
        lookback_hours
      },
      
      orders_monitored: {
        total_paid_orders: 0,
        orders_checked: []
      },
      
      loyalty_points_audit: {
        orders_with_userpoints: 0,
        orders_without_userpoints: 0,
        formula_verification: [],
        duplicate_detection: [],
        apple_relay_verification: []
      },
      
      alerts: {
        missing_userpoints: [],
        duplicate_userpoints: [],
        formula_errors: [],
        apple_relay_merged: [],
        other_issues: []
      },
      
      summary: {
        total_monitoring_hours: lookback_hours,
        paid_orders_found: 0,
        orders_with_correct_points: 0,
        orders_with_alerts: 0,
        critical_alerts: 0,
        monitoring_status: 'ACTIVE'
      }
    };

    // STEP 1: Find all orders with payment_status=paid in the lookback window
    try {
      const allOrders = await hub.entities.ShopifyOrder.list('-created_date', 500);
      
      for (const order of allOrders) {
        const orderCreatedTime = new Date(order.created_date || order.customer_order_date).getTime();
        const cutoffTime = cutoff.getTime();

        if (orderCreatedTime < cutoffTime) {
          continue;
        }

        if (order.payment_status !== 'paid') {
          continue;
        }

        // Skip test, quarantined, refunded, canceled orders
        if (order.internal_notes?.includes('[TEST]') || 
            order.internal_notes?.includes('[QUARANTINE]') ||
            order.production_status === 'refunded' ||
            order.production_status === 'canceled' ||
            order.payment_status === 'refunded') {
          continue;
        }

        out.summary.paid_orders_found++;
        out.orders_monitored.total_paid_orders++;

        const expectedPoints = Math.floor((order.total_price || 0) * 10);

        const orderRecord = {
          id: order.id,
          order_number: order.shopify_order_number,
          customer_email: order.customer_email,
          customer_name: order.customer_name,
          total_price: order.total_price,
          expected_points: expectedPoints,
          payment_status: order.payment_status,
          created_date: order.created_date || order.customer_order_date,
          apple_relay: order.customer_email?.includes('@privaterelay.appleid.com'),
          userpoints_found: false,
          userpoints_records: [],
          issues: []
        };

        // STEP 2: Check for matching UserPoints earned record
        try {
          const allPoints = await hub.entities.UserPoints.list('-created_date', 500);
          
          const matchingPoints = allPoints.filter(p => 
            p.customer_email === order.customer_email &&
            p.type === 'earned' &&
            p.order_id === order.id
          );

          if (matchingPoints.length === 0) {
            orderRecord.issues.push('NO_USERPOINTS_EARNED_RECORD');
            out.loyalty_points_audit.orders_without_userpoints++;
            out.alerts.missing_userpoints.push({
              order_id: order.id,
              order_number: order.shopify_order_number,
              email: order.customer_email,
              total_price: order.total_price,
              expected_points: expectedPoints,
              issue: 'Order paid but no UserPoints earned record found'
            });
          } else if (matchingPoints.length > 1) {
            orderRecord.issues.push('DUPLICATE_USERPOINTS_RECORDS');
            out.alerts.duplicate_userpoints.push({
              order_id: order.id,
              order_number: order.shopify_order_number,
              email: order.customer_email,
              duplicate_count: matchingPoints.length,
              records: matchingPoints.map(p => ({
                id: p.id,
                amount: p.amount,
                created_date: p.created_date
              }))
            });
          } else {
            const upRecord = matchingPoints[0];
            orderRecord.userpoints_found = true;
            orderRecord.userpoints_records.push({
              id: upRecord.id,
              amount: upRecord.amount,
              type: upRecord.type,
              created_date: upRecord.created_date
            });

            // Verify formula
            if (upRecord.amount !== expectedPoints) {
              orderRecord.issues.push('FORMULA_MISMATCH');
              out.alerts.formula_errors.push({
                order_id: order.id,
                order_number: order.shopify_order_number,
                email: order.customer_email,
                total_price: order.total_price,
                expected_formula: `Math.floor(${order.total_price} * 10) = ${expectedPoints}`,
                actual_amount: upRecord.amount,
                issue: 'Formula verification failed'
              });
            } else {
              out.loyalty_points_audit.formula_verification.push({
                order_number: order.shopify_order_number,
                email: order.customer_email,
                total_price: order.total_price,
                points: upRecord.amount,
                status: 'CORRECT'
              });
              out.summary.orders_with_correct_points++;
            }

            out.loyalty_points_audit.orders_with_userpoints++;
          }
        } catch (e) {
          orderRecord.issues.push(`USERPOINTS_READ_ERROR: ${e?.message || String(e)}`);
        }

        // STEP 3: Verify Apple Private Relay is preserved as separate identity
        if (orderRecord.apple_relay) {
          const nonRelayVariant = order.customer_email.replace('@privaterelay.appleid.com', '@example.com');
          try {
            const allMembers = await hub.entities.LoyaltyMember.filter({ email: order.customer_email });
            const nonRelayMembers = await hub.entities.LoyaltyMember.filter({ email: nonRelayVariant });

            if (allMembers.length > 0 && nonRelayMembers.length > 0) {
              orderRecord.issues.push('APPLE_RELAY_MERGED_WITH_OTHER_IDENTITY');
              out.alerts.apple_relay_merged.push({
                apple_relay_email: order.customer_email,
                other_identity_found: nonRelayVariant,
                issue: 'Apple Private Relay customer may have been merged'
              });
            } else if (allMembers.length > 0) {
              out.loyalty_points_audit.apple_relay_verification.push({
                email: order.customer_email,
                status: 'PRESERVED_AS_SEPARATE_IDENTITY'
              });
            }
          } catch (e) {
            orderRecord.issues.push(`APPLE_RELAY_CHECK_ERROR: ${e?.message || String(e)}`);
          }
        }

        if (orderRecord.issues.length > 0) {
          out.summary.orders_with_alerts++;
          if (orderRecord.issues.some(i => i.includes('NO_USERPOINTS') || i.includes('DUPLICATE') || i.includes('APPLE_RELAY_MERGED'))) {
            out.summary.critical_alerts++;
          }
        }

        out.orders_monitored.orders_checked.push(orderRecord);
      }
    } catch (e) {
      out.alerts.other_issues.push({
        step: 'monitor_orders',
        error: e?.message || String(e)
      });
    }

    // STEP 4: Summary and Recommendations
    out.summary.status = out.summary.critical_alerts > 0 ? 'ALERTS_PRESENT' : 'HEALTHY';
    out.summary.action_required = out.summary.critical_alerts > 0 
      ? `${out.summary.critical_alerts} critical alert(s) require review`
      : 'No action required — loyalty automation functioning normally';

    return Response.json(out, { status: 200 });

  } catch (error) {
    return Response.json({
      status: 'error',
      error: error?.message || String(error)
    }, { status: 500 });
  }
});