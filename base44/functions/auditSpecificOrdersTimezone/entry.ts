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
    const twoPmMinutes = 14 * 60; // 2:00 PM in minutes
    const targetOrderNumbers = ['NV-MONL4I2M', 'NV-MOOPFCUS', 'NV-MON367R7'];

    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 200);
    
    // Get all Saturday window orders for threshold calculation
    const saturdayWindowOrders = allOrders.filter(o => {
      if (!o.customer_order_date) return false;
      const chicagoTime = moment(o.customer_order_date).tz(CHICAGO_TZ);
      const chicagoDay = chicagoTime.day(); // 0=Sun, 6=Sat
      const chicagoMin = chicagoTime.hour() * 60 + chicagoTime.minute();
      
      return (
        (chicagoDay === 5 && chicagoMin >= twoPmMinutes) || // Friday after 2 PM Chicago time
        (chicagoDay === 6 && chicagoMin < twoPmMinutes) // Saturday before 2 PM Chicago time
      );
    });

    const saturdayEligibleCount = saturdayWindowOrders.length;
    const saturdayThresholdMet = saturdayEligibleCount > 10;

    // Audit specific orders
    const targetOrders = allOrders.filter(o => 
      targetOrderNumbers.includes(o.shopify_order_number)
    );

    const auditTable = targetOrders.map(order => {
      const utcTime = moment(order.customer_order_date);
      const chicagoTime = utcTime.clone().tz(CHICAGO_TZ);
      
      const chicagoDayOfWeek = chicagoTime.day();
      const chicagoMin = chicagoTime.hour() * 60 + chicagoTime.minute();
      const chicagoDayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][chicagoDayOfWeek];

      let cutoff_window = null;
      let assigned_production_date = null;
      let assigned_delivery_date = null;
      let final_decision = null;
      let threshold_status = null;

      // WINDOW 1: Saturday 2:00 PM through Tuesday 2:00 PM → Tuesday/Wednesday
      if (
        (chicagoDayOfWeek === 6 && chicagoMin >= twoPmMinutes) ||
        chicagoDayOfWeek === 0 ||
        chicagoDayOfWeek === 1 ||
        (chicagoDayOfWeek === 2 && chicagoMin < twoPmMinutes)
      ) {
        cutoff_window = 'Window 1: Sat 2PM-Tue 2PM → Tue/Wed';
        assigned_production_date = 'Tuesday';
        assigned_delivery_date = 'Wednesday';
        final_decision = 'Assign to Tuesday production';
        threshold_status = 'not_applicable';
      }
      // WINDOW 2: Tuesday 2:00 PM through Friday 2:00 PM → Friday/Saturday
      else if (
        (chicagoDayOfWeek === 2 && chicagoMin >= twoPmMinutes) ||
        chicagoDayOfWeek === 3 ||
        chicagoDayOfWeek === 4 ||
        (chicagoDayOfWeek === 5 && chicagoMin < twoPmMinutes)
      ) {
        cutoff_window = 'Window 2: Tue 2PM-Fri 2PM → Fri/Sat';
        assigned_production_date = 'Friday';
        assigned_delivery_date = 'Saturday';
        final_decision = 'Assign to Friday production';
        threshold_status = 'not_applicable';
      }
      // WINDOW 3: Friday 2:00 PM through Saturday 2:00 PM (CONDITIONAL)
      else if (
        (chicagoDayOfWeek === 5 && chicagoMin >= twoPmMinutes) ||
        (chicagoDayOfWeek === 6 && chicagoMin < twoPmMinutes)
      ) {
        cutoff_window = 'Window 3: Fri 2PM-Sat 2PM (CONDITIONAL)';
        
        if (saturdayThresholdMet) {
          assigned_production_date = 'Saturday';
          assigned_delivery_date = 'Sunday';
          final_decision = 'Assign to Saturday production (threshold met)';
          threshold_status = 'threshold_met';
        } else {
          assigned_production_date = 'Tuesday';
          assigned_delivery_date = 'Wednesday';
          final_decision = 'Roll to Tuesday production (threshold not met)';
          threshold_status = 'threshold_not_met';
        }
      }

      return {
        order_number: order.shopify_order_number,
        customer_name: order.customer_name,
        created_at_utc: utcTime.format('YYYY-MM-DD HH:mm:ss'),
        created_at_local_chicago: chicagoTime.format('YYYY-MM-DD HH:mm:ss'),
        local_day_of_week: chicagoDayName,
        cutoff_window,
        eligible_saturday_window_count: saturdayEligibleCount,
        threshold_required: 11,
        threshold_status,
        final_decision,
        assigned_production_date: order.assigned_production_day || assigned_production_date,
        assigned_delivery_date: order.assigned_delivery_day || assigned_delivery_date,
        production_status: order.production_status,
        fulfillment_status: order.fulfillment_status || 'unknown',
        delivery_status: order.delivery_status || 'unknown',
        ready_for_driver: order.ready_for_driver === true ? 'YES' : 'NO',
        appears_in_driver_portal_today: 
          order.payment_status === 'paid' && 
          (order.production_status === 'ready_for_delivery' || order.batch_verified === true) &&
          (order.delivery_status === 'ready_for_delivery' || order.delivery_status === 'out_for_delivery') ? 'YES' : 'NO',
        reason: order.scheduling_reason || 'per_official_cutoff_rules'
      };
    });

    // Check if there are any new orders in Driver Portal
    const newOrders = allOrders.filter(o => 
      o.payment_status === 'paid' && 
      !o.production_status?.includes('fulfilled') &&
      !targetOrderNumbers.includes(o.shopify_order_number) &&
      moment(o.created_date).isAfter(moment().subtract(24, 'hours'))
    );

    const newOrdersAudit = newOrders.slice(0, 5).map(order => {
      const utcTime = moment(order.customer_order_date);
      const chicagoTime = utcTime.clone().tz(CHICAGO_TZ);
      
      const chicagoDayOfWeek = chicagoTime.day();
      const chicagoMin = chicagoTime.hour() * 60 + chicagoTime.minute();
      const chicagoDayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][chicagoDayOfWeek];

      let cutoff_window = null;
      let assigned_production_date = null;
      let assigned_delivery_date = null;
      let final_decision = null;
      let threshold_status = null;

      if (
        (chicagoDayOfWeek === 6 && chicagoMin >= twoPmMinutes) ||
        chicagoDayOfWeek === 0 ||
        chicagoDayOfWeek === 1 ||
        (chicagoDayOfWeek === 2 && chicagoMin < twoPmMinutes)
      ) {
        cutoff_window = 'Window 1: Sat 2PM-Tue 2PM → Tue/Wed';
        assigned_production_date = 'Tuesday';
        assigned_delivery_date = 'Wednesday';
        final_decision = 'Assign to Tuesday production';
        threshold_status = 'not_applicable';
      } else if (
        (chicagoDayOfWeek === 2 && chicagoMin >= twoPmMinutes) ||
        chicagoDayOfWeek === 3 ||
        chicagoDayOfWeek === 4 ||
        (chicagoDayOfWeek === 5 && chicagoMin < twoPmMinutes)
      ) {
        cutoff_window = 'Window 2: Tue 2PM-Fri 2PM → Fri/Sat';
        assigned_production_date = 'Friday';
        assigned_delivery_date = 'Saturday';
        final_decision = 'Assign to Friday production';
        threshold_status = 'not_applicable';
      } else if (
        (chicagoDayOfWeek === 5 && chicagoMin >= twoPmMinutes) ||
        (chicagoDayOfWeek === 6 && chicagoMin < twoPmMinutes)
      ) {
        cutoff_window = 'Window 3: Fri 2PM-Sat 2PM (CONDITIONAL)';
        if (saturdayThresholdMet) {
          assigned_production_date = 'Saturday';
          assigned_delivery_date = 'Sunday';
          final_decision = 'Assign to Saturday production (threshold met)';
          threshold_status = 'threshold_met';
        } else {
          assigned_production_date = 'Tuesday';
          assigned_delivery_date = 'Wednesday';
          final_decision = 'Roll to Tuesday production (threshold not met)';
          threshold_status = 'threshold_not_met';
        }
      }

      return {
        order_number: order.shopify_order_number,
        customer_name: order.customer_name,
        created_at_utc: utcTime.format('YYYY-MM-DD HH:mm:ss'),
        created_at_local_chicago: chicagoTime.format('YYYY-MM-DD HH:mm:ss'),
        local_day_of_week: chicagoDayName,
        cutoff_window,
        eligible_saturday_window_count: saturdayEligibleCount,
        threshold_required: 11,
        threshold_status,
        final_decision,
        assigned_production_date: order.assigned_production_day || assigned_production_date,
        assigned_delivery_date: order.assigned_delivery_day || assigned_delivery_date,
        production_status: order.production_status,
        fulfillment_status: order.fulfillment_status || 'unknown',
        delivery_status: order.delivery_status || 'unknown',
        ready_for_driver: order.ready_for_driver === true ? 'YES' : 'NO',
        appears_in_driver_portal_today: 'NO',
        reason: 'new_order_created_in_last_24h'
      };
    });

    return Response.json({
      audit_date: moment().tz(CHICAGO_TZ).format('YYYY-MM-DD HH:mm:ss'),
      timezone: CHICAGO_TZ,
      saturday_window_status: {
        eligible_count: saturdayEligibleCount,
        threshold_required: 11,
        threshold_met: saturdayThresholdMet,
        decision: saturdayThresholdMet ? 'Saturday production → Sunday delivery' : 'Roll to Tuesday production → Wednesday delivery'
      },
      target_orders_audit: auditTable,
      new_orders_in_system: newOrdersAudit,
      total_new_orders_created_24h: newOrders.length,
      notes: {
        timezone_rule: '2026-05-02 at 00:00 UTC = 2026-05-01 at 7:00 PM Chicago time',
        current_chicago_time: moment().tz(CHICAGO_TZ).format('YYYY-MM-DD HH:mm:ss'),
        saturday_window_final: saturdayThresholdMet ? `${saturdayEligibleCount} orders (>10) → Produce Saturday` : `${saturdayEligibleCount} orders (≤10) → Roll to Tuesday`
      }
    });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});