import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import moment from 'npm:moment@2.30.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 200);
    const twoPmMinutes = 14 * 60;
    const today = moment().format('YYYY-MM-DD');

    // Filter for live/active orders (not fulfilled/refunded/canceled)
    const liveOrders = allOrders.filter(o => 
      o.payment_status !== 'refunded' && 
      o.production_status !== 'fulfilled' && 
      o.production_status !== 'refunded' && 
      o.production_status !== 'canceled'
    );

    const auditTable = liveOrders.map(order => {
      const orderTime = moment(order.customer_order_date);
      const dayOfWeek = orderTime.day();
      const timeInMinutes = orderTime.hour() * 60 + orderTime.minute();

      let cutoff_window = null;
      let saturday_eligible_count = null;

      if (
        (dayOfWeek === 6 && timeInMinutes >= twoPmMinutes) ||
        dayOfWeek === 0 ||
        dayOfWeek === 1 ||
        (dayOfWeek === 2 && timeInMinutes < twoPmMinutes)
      ) {
        cutoff_window = 'Window 1: Sat 2PM-Tue 2PM → Tue/Wed';
      } else if (
        (dayOfWeek === 2 && timeInMinutes >= twoPmMinutes) ||
        dayOfWeek === 3 ||
        dayOfWeek === 4 ||
        (dayOfWeek === 5 && timeInMinutes < twoPmMinutes)
      ) {
        cutoff_window = 'Window 2: Tue 2PM-Fri 2PM → Fri/Sat';
      } else if (
        (dayOfWeek === 5 && timeInMinutes >= twoPmMinutes) ||
        (dayOfWeek === 6 && timeInMinutes < twoPmMinutes)
      ) {
        cutoff_window = 'Window 3: Fri 2PM-Sat 2PM (CONDITIONAL)';
      }

      return {
        order_number: order.shopify_order_number,
        customer_name: order.customer_name,
        customer_email: order.customer_email,
        created_at: moment(order.customer_order_date).format('YYYY-MM-DD HH:mm'),
        cutoff_window,
        assigned_production_date: order.assigned_production_day || 'unassigned',
        assigned_delivery_date: order.assigned_delivery_day || 'unassigned',
        production_status: order.production_status || 'unknown',
        fulfillment_status: order.fulfillment_status || 'unknown',
        delivery_status: order.delivery_status || 'unknown',
        ready_for_driver: order.ready_for_driver === true ? 'YES' : 'NO',
        appears_in_driver_portal_today: 
          order.payment_status === 'paid' && 
          (order.production_status === 'ready_for_delivery' || order.batch_verified === true) &&
          (order.delivery_status === 'ready_for_delivery' || order.delivery_status === 'out_for_delivery') &&
          order.assigned_delivery_day === 'today' ? 'YES' : 'NO',
        batch_trigger: order.batch_trigger || 'none',
        reason: order.scheduling_reason || 'scheduled_per_cutoff'
      };
    });

    // Count Saturday window eligible orders for threshold evaluation
    const saturdayWindowOrders = allOrders.filter(o => {
      if (!o.customer_order_date) return false;
      const oTime = moment(o.customer_order_date);
      const oDay = oTime.day();
      const oMin = oTime.hour() * 60 + oTime.minute();
      
      return (
        (oDay === 5 && oMin >= twoPmMinutes) ||
        (oDay === 6 && oMin < twoPmMinutes)
      );
    });

    const saturdayEligibleCount = saturdayWindowOrders.length;
    const saturdayThresholdMet = saturdayEligibleCount > 10;

    return Response.json({
      audit_date: today,
      total_live_orders: liveOrders.length,
      saturday_window_eligible_count: saturdayEligibleCount,
      saturday_threshold_status: saturdayThresholdMet ? 'MET (11+)' : `NOT MET (${saturdayEligibleCount} ≤ 10)`,
      saturday_decision: saturdayThresholdMet ? 'Produce Saturday, deliver Sunday' : 'Roll to Tuesday, deliver Wednesday',
      audit_table: auditTable,
      summary: {
        paid_unproduced: liveOrders.filter(o => o.payment_status === 'paid' && !o.production_status?.includes('production')).length,
        in_production: liveOrders.filter(o => o.production_status === 'in_production').length,
        ready_for_delivery: liveOrders.filter(o => o.delivery_status === 'ready_for_delivery').length,
        out_for_delivery: liveOrders.filter(o => o.delivery_status === 'out_for_delivery').length
      }
    });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});