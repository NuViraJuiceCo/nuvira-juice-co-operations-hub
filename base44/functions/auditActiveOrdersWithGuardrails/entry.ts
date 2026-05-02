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

    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500);

    // GUARDRAIL: Exclude refunded/deleted/test orders from active scheduling
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

    // Filter to ACTIVE orders only
    const activeOrders = allOrders.filter(o => 
      !isOrderExcluded(o) &&
      o.payment_status === 'paid' &&
      o.production_status !== 'fulfilled'
    );

    // Count Saturday Window 3 ACTIVE orders only
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

    // Current time check: Saturday 2 PM has passed?
    const saturdayDeadline = nowChicago.clone().day(6).hour(14).minute(0).second(0);
    if (nowChicago.isBefore(saturdayDeadline)) {
      saturdayDeadline.subtract(1, 'week');
    }
    const pastSaturdayDeadline = nowChicago.isAfter(saturdayDeadline);

    // Build audit table for all active orders
    const auditTable = activeOrders.map(order => {
      const utcTime = moment(order.customer_order_date);
      const chicagoTime = utcTime.clone().tz(CHICAGO_TZ);
      
      const orderDayOfWeek = chicagoTime.day();
      const orderMin = chicagoTime.hour() * 60 + chicagoTime.minute();
      const orderDayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][orderDayOfWeek];

      let cutoff_window = null;
      let assigned_prod = null;
      let assigned_deliv = null;

      // Determine cutoff window
      if (
        (orderDayOfWeek === 6 && orderMin >= twoPmMinutes) ||
        orderDayOfWeek === 0 ||
        orderDayOfWeek === 1 ||
        (orderDayOfWeek === 2 && orderMin < twoPmMinutes)
      ) {
        cutoff_window = 'Window 1';
        assigned_prod = 'Tuesday';
        assigned_deliv = 'Wednesday';
      } else if (
        (orderDayOfWeek === 2 && orderMin >= twoPmMinutes) ||
        orderDayOfWeek === 3 ||
        orderDayOfWeek === 4 ||
        (orderDayOfWeek === 5 && orderMin < twoPmMinutes)
      ) {
        cutoff_window = 'Window 2';
        assigned_prod = 'Friday';
        assigned_deliv = 'Saturday';
      } else if (
        (orderDayOfWeek === 5 && orderMin >= twoPmMinutes) ||
        (orderDayOfWeek === 6 && orderMin < twoPmMinutes)
      ) {
        cutoff_window = 'Window 3 (Conditional)';
        // Saturday threshold decision
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
        is_refunded: order.payment_status === 'refunded' ? 'YES' : 'NO',
        is_deleted: order.canceled_at || order.deleted_at ? 'YES' : 'NO',
        is_active: 'YES',
        included_in_threshold_count: cutoff_window === 'Window 3 (Conditional)' ? 'YES' : 'NO',
        reason: `Active order in ${cutoff_window}`,
        assigned_production_date: assigned_prod,
        assigned_delivery_date: assigned_deliv,
        production_status: order.production_status,
        fulfillment_status: order.fulfillment_status || 'unknown',
        delivery_status: order.delivery_status || 'unknown',
        appears_in_production_planning: assigned_prod ? 'YES' : 'NO',
        appears_in_driver_portal: assigned_deliv && order.ready_for_driver ? 'YES' : 'NO'
      };
    });

    return Response.json({
      mode: 'live',
      now_utc: nowUtc.format('YYYY-MM-DD HH:mm:ss'),
      now_chicago: nowChicago.format('YYYY-MM-DD HH:mm:ss'),
      chicago_day_of_week: chicagoDayName,
      using_mock_time: false,
      
      saturday_threshold: {
        active_eligible_count: saturdayEligibleCount,
        threshold_required: 11,
        threshold_met: saturdayThresholdMet,
        past_saturday_2pm_deadline: pastSaturdayDeadline,
        decision: saturdayThresholdMet ? 'Saturday production → Sunday delivery' : 'Roll to Tuesday production → Wednesday delivery'
      },

      active_orders_count: activeOrders.length,
      refunded_excluded_count: allOrders.filter(isOrderExcluded).length,
      
      guardrails_enforced: {
        exclude_if_payment_status: 'refunded',
        exclude_if_production_status: 'refunded | canceled',
        exclude_if_flags: 'do_not_recover=true | do_not_sync=true',
        exclude_if_timestamps: 'canceled_at | deleted_at exists'
      },

      active_orders_audit: auditTable
    });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});