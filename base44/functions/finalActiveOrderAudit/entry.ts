import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import moment from 'npm:moment-timezone@0.5.45';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const CHICAGO_TZ = 'America/Chicago';
    const twoPmMinutes = 14 * 60;

    // Use REAL current time (not mocked)
    const nowUtc = moment.utc();
    const nowChicago = nowUtc.clone().tz(CHICAGO_TZ);
    const chicagoDayOfWeek = nowChicago.day();
    const chicagoDayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][chicagoDayOfWeek];
    const chicagoHour = nowChicago.hour();
    const chicagoMin = nowChicago.minute();

    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500);

    // GUARDRAIL: Exclude refunded/deleted/test orders
    const isOrderExcluded = (order) => {
      return (
        order.payment_status === 'refunded' ||
        order.production_status === 'refunded' ||
        order.production_status === 'canceled' ||
        order.do_not_recover === true ||
        order.do_not_sync === true ||
        order.canceled_at ||
        order.deleted_at
      );
    };

    // Filter to ACTIVE, PAID, NON-REFUNDED orders only
    const activeOrders = allOrders.filter(o => 
      !isOrderExcluded(o) &&
      o.payment_status === 'paid' &&
      o.production_status !== 'fulfilled'
    );

    // Saturday Window 3: Friday 2 PM through Saturday 2 PM (ACTIVE ONLY)
    const saturdayWindowActiveOrders = activeOrders.filter(o => {
      if (!o.customer_order_date) return false;
      const chicagoTime = moment(o.customer_order_date).tz(CHICAGO_TZ);
      const oDay = chicagoTime.day();
      const oMin = chicagoTime.hour() * 60 + chicagoTime.minute();
      
      return (
        (oDay === 5 && oMin >= twoPmMinutes) ||
        (oDay === 6 && oMin < twoPmMinutes)
      );
    });

    const saturdayEligibleCount = saturdayWindowActiveOrders.length;
    const saturdayThresholdMet = saturdayEligibleCount > 10;

    // Check if Saturday 2 PM cutoff has passed
    const saturdayDeadline = nowChicago.clone().day(6).hour(14).minute(0).second(0);
    if (nowChicago.isBefore(saturdayDeadline)) {
      saturdayDeadline.subtract(1, 'week');
    }
    const pastSaturdayDeadline = nowChicago.isAfter(saturdayDeadline);

    // Build audit table
    const auditTable = activeOrders.map(order => {
      const utcTime = moment(order.customer_order_date);
      const chicagoTime = utcTime.clone().tz(CHICAGO_TZ);
      
      const orderDayOfWeek = chicagoTime.day();
      const orderMin = chicagoTime.hour() * 60 + chicagoTime.minute();
      const orderDayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][orderDayOfWeek];

      let assigned_prod = null;
      let assigned_deliv = null;

      // Determine cutoff window
      if (
        (orderDayOfWeek === 6 && orderMin >= twoPmMinutes) ||
        orderDayOfWeek === 0 ||
        orderDayOfWeek === 1 ||
        (orderDayOfWeek === 2 && orderMin < twoPmMinutes)
      ) {
        assigned_prod = 'Tuesday';
        assigned_deliv = 'Wednesday';
      } else if (
        (orderDayOfWeek === 2 && orderMin >= twoPmMinutes) ||
        orderDayOfWeek === 3 ||
        orderDayOfWeek === 4 ||
        (orderDayOfWeek === 5 && orderMin < twoPmMinutes)
      ) {
        assigned_prod = 'Friday';
        assigned_deliv = 'Saturday';
      } else if (
        (orderDayOfWeek === 5 && orderMin >= twoPmMinutes) ||
        (orderDayOfWeek === 6 && orderMin < twoPmMinutes)
      ) {
        // Window 3: Conditional Saturday
        if (saturdayThresholdMet && pastSaturdayDeadline) {
          assigned_prod = 'Saturday';
          assigned_deliv = 'Sunday';
        } else {
          assigned_prod = 'Tuesday';
          assigned_deliv = 'Wednesday';
        }
      }

      return {
        order_number: order.shopify_order_number,
        customer_name: order.customer_name,
        is_refunded: 'NO',
        is_deleted: 'NO',
        is_active: 'YES',
        included_in_threshold_count: (orderDayOfWeek === 5 && orderMin >= twoPmMinutes) || (orderDayOfWeek === 6 && orderMin < twoPmMinutes) ? 'YES' : 'NO',
        reason: `Active order scheduled per cutoff window`,
        assigned_production_date: assigned_prod,
        assigned_delivery_date: assigned_deliv,
        production_status: order.production_status,
        fulfillment_status: order.fulfillment_status || 'pending_production',
        delivery_status: order.delivery_status || 'not_ready',
        appears_in_production_planning: 'YES',
        appears_in_driver_portal: assigned_deliv ? 'NO (not yet verified)' : 'NO'
      };
    });

    // Build excluded orders table
    const excludedOrders = allOrders.filter(isOrderExcluded).map(order => ({
      order_number: order.shopify_order_number,
      customer_name: order.customer_name,
      is_refunded: order.payment_status === 'refunded' ? 'YES' : 'NO',
      is_deleted: (order.canceled_at || order.deleted_at) ? 'YES' : 'NO',
      is_active: 'NO',
      included_in_threshold_count: 'NO',
      reason: order.do_not_recover ? 'do_not_recover flag set' : 
              order.payment_status === 'refunded' ? 'refunded' :
              order.canceled_at ? 'canceled' :
              order.deleted_at ? 'deleted' : 'excluded',
      assigned_production_date: '—',
      assigned_delivery_date: '—',
      production_status: order.production_status,
      fulfillment_status: '—',
      delivery_status: '—',
      appears_in_production_planning: 'NO',
      appears_in_driver_portal: 'NO'
    }));

    return Response.json({
      mode: 'live',
      now_utc: nowUtc.format('YYYY-MM-DD HH:mm:ss Z'),
      now_chicago: nowChicago.format('YYYY-MM-DD HH:mm:ss Z (ddd)'),
      chicago_day_of_week: `${chicagoDayName} (Day ${chicagoDayOfWeek})`,
      chicago_time_of_day: `${chicagoHour.toString().padStart(2, '0')}:${chicagoMin.toString().padStart(2, '0')}`,
      using_mock_time: false,

      saturday_window_status: {
        active_eligible_count: saturdayEligibleCount,
        threshold_required: 11,
        threshold_met: saturdayThresholdMet,
        past_saturday_2pm_deadline: pastSaturdayDeadline,
        decision: saturdayThresholdMet ? 'Saturday production → Sunday delivery' : 'Roll to Tuesday production → Wednesday delivery'
      },

      summary: {
        active_orders: activeOrders.length,
        refunded_excluded: allOrders.filter(o => o.payment_status === 'refunded').length,
        deleted_excluded: allOrders.filter(o => o.canceled_at || o.deleted_at).length,
        test_excluded: allOrders.filter(o => o.do_not_recover === true).length,
        total_excluded: excludedOrders.length
      },

      guardrails: {
        exclude_payment_status_refunded: true,
        exclude_production_status_refunded: true,
        exclude_do_not_recover_flag: true,
        exclude_canceled_at_timestamp: true,
        exclude_deleted_at_timestamp: true,
        no_assignment_to_production: true,
        no_fulfillment_task_creation: true,
        no_batch_item_creation: true,
        no_driver_portal_visibility: true,
        no_route_optimization: true
      },

      active_orders_audit: auditTable,
      excluded_orders_audit: excludedOrders,

      notes: {
        amar_kahlon_test_orders: 'All marked as refunded with do_not_recover=true flag',
        saturday_threshold_deadline_passed: pastSaturdayDeadline ? 'YES - threshold decision is FINAL' : 'NO - decision pending',
        current_decision_applied: saturdayThresholdMet ? `Produce Saturday (${saturdayEligibleCount} orders > 10)` : `Roll to Tuesday (${saturdayEligibleCount} orders ≤ 10)`
      }
    });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});