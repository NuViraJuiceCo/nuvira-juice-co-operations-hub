import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import moment from 'npm:moment@2.30.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { order_id } = await req.json();
    
    if (!order_id) {
      return Response.json({ error: 'order_id required' }, { status: 400 });
    }

    const order = await base44.asServiceRole.entities.ShopifyOrder.get('ShopifyOrder', order_id);
    if (!order) {
      return Response.json({ error: 'Order not found' }, { status: 404 });
    }

    const orderPlacedAt = moment(order.customer_order_date);
    const dayOfWeek = orderPlacedAt.day(); // 0=Sun, 1=Mon, ..., 6=Sat
    const hourOfDay = orderPlacedAt.hour();
    const minuteOfHour = orderPlacedAt.minute();
    const timeInMinutes = hourOfDay * 60 + minuteOfHour;
    const twoPmMinutes = 14 * 60; // 2:00 PM

    let window = null;
    let assigned_production_day = null;
    let assigned_delivery_day = null;
    let production_status = 'scheduled_for_production';
    let fulfillment_status = 'pending_production';
    let delivery_status = 'not_ready';
    let ready_for_driver = false;
    let batch_trigger = null;
    let scheduling_reason = null;

    // WINDOW 1: Saturday 2:00 PM through Tuesday 2:00 PM
    // Assigned to Tuesday production / Wednesday delivery
    if (
      (dayOfWeek === 6 && timeInMinutes >= twoPmMinutes) || // Saturday after 2 PM
      dayOfWeek === 0 || // Sunday
      dayOfWeek === 1 || // Monday
      (dayOfWeek === 2 && timeInMinutes < twoPmMinutes) // Tuesday before 2 PM
    ) {
      window = 1;
      assigned_production_day = 'Tuesday';
      assigned_delivery_day = 'Wednesday';
    }

    // WINDOW 2: Tuesday 2:00 PM through Friday 2:00 PM
    // Assigned to Friday production / Saturday delivery
    else if (
      (dayOfWeek === 2 && timeInMinutes >= twoPmMinutes) || // Tuesday after 2 PM
      dayOfWeek === 3 || // Wednesday
      dayOfWeek === 4 || // Thursday
      (dayOfWeek === 5 && timeInMinutes < twoPmMinutes) // Friday before 2 PM
    ) {
      window = 2;
      assigned_production_day = 'Friday';
      assigned_delivery_day = 'Saturday';
    }

    // WINDOW 3: Friday 2:00 PM through Saturday 2:00 PM (CONDITIONAL)
    // Depends on Saturday threshold
    else if (
      (dayOfWeek === 5 && timeInMinutes >= twoPmMinutes) || // Friday after 2 PM
      (dayOfWeek === 6 && timeInMinutes < twoPmMinutes) // Saturday before 2 PM
    ) {
      window = 3;
      
      // Count eligible orders in Saturday window to determine threshold
      const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 300);
      const saturdayWindowOrders = allOrders.filter(o => {
        if (!o.customer_order_date) return false;
        const oTime = moment(o.customer_order_date);
        const oDay = oTime.day();
        const oMin = oTime.hour() * 60 + oTime.minute();
        
        return (
          (oDay === 5 && oMin >= twoPmMinutes) || // Friday after 2 PM
          (oDay === 6 && oMin < twoPmMinutes) // Saturday before 2 PM
        );
      });

      const eligibleCount = saturdayWindowOrders.length;

      if (eligibleCount > 10) {
        // Saturday threshold MET
        assigned_production_day = 'Saturday';
        assigned_delivery_day = 'Sunday';
        batch_trigger = 'saturday_threshold_met';
      } else {
        // Saturday threshold NOT MET - roll to Tuesday
        assigned_production_day = 'Tuesday';
        assigned_delivery_day = 'Wednesday';
        batch_trigger = 'saturday_threshold_not_met';
        scheduling_reason = `fewer_than_11_orders_in_saturday_window_rolled_to_tuesday (${eligibleCount} eligible)`;
      }
    } else {
      return Response.json({ error: 'Invalid order date' }, { status: 400 });
    }

    // Update order
    const updateData = {
      assigned_production_day,
      assigned_delivery_day,
      production_status,
      fulfillment_status,
      delivery_status,
      ready_for_driver,
    };

    if (batch_trigger) updateData.batch_trigger = batch_trigger;
    if (scheduling_reason) updateData.scheduling_reason = scheduling_reason;

    await base44.asServiceRole.entities.ShopifyOrder.update(order_id, updateData);

    return Response.json({
      order_number: order.shopify_order_number,
      order_placed_at: order.customer_order_date,
      window,
      assigned_production_day,
      assigned_delivery_day,
      batch_trigger,
      scheduling_reason,
      production_status,
      fulfillment_status,
      delivery_status,
      ready_for_driver
    });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});