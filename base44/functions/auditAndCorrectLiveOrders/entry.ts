import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import moment from 'npm:moment@2.30.1';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 200);
    const today = moment().format('YYYY-MM-DD');
    const twoPmMinutes = 14 * 60;

    const corrections = [];

    for (const order of allOrders) {
      if (!order.customer_order_date || order.production_status === 'fulfilled' || order.production_status === 'refunded' || order.production_status === 'canceled') {
        continue;
      }

      const orderTime = moment(order.customer_order_date);
      const dayOfWeek = orderTime.day();
      const timeInMinutes = orderTime.hour() * 60 + orderTime.minute();

      let shouldCorrect = false;
      let correctData = {};

      // Window 1: Saturday 2 PM through Tuesday 2 PM → Tuesday/Wednesday
      if (
        (dayOfWeek === 6 && timeInMinutes >= twoPmMinutes) ||
        dayOfWeek === 0 ||
        dayOfWeek === 1 ||
        (dayOfWeek === 2 && timeInMinutes < twoPmMinutes)
      ) {
        if (order.assigned_production_day !== 'Tuesday' || order.assigned_delivery_day !== 'Wednesday') {
          shouldCorrect = true;
          correctData = {
            assigned_production_day: 'Tuesday',
            assigned_delivery_day: 'Wednesday',
            production_status: 'scheduled_for_production',
            fulfillment_status: 'pending_production',
            delivery_status: 'not_ready',
            ready_for_driver: false
          };
        }
      }
      // Window 2: Tuesday 2 PM through Friday 2 PM → Friday/Saturday
      else if (
        (dayOfWeek === 2 && timeInMinutes >= twoPmMinutes) ||
        dayOfWeek === 3 ||
        dayOfWeek === 4 ||
        (dayOfWeek === 5 && timeInMinutes < twoPmMinutes)
      ) {
        if (order.assigned_production_day !== 'Friday' || order.assigned_delivery_day !== 'Saturday') {
          shouldCorrect = true;
          correctData = {
            assigned_production_day: 'Friday',
            assigned_delivery_day: 'Saturday',
            production_status: 'scheduled_for_production',
            fulfillment_status: 'pending_production',
            delivery_status: 'not_ready',
            ready_for_driver: false
          };
        }
      }

      if (shouldCorrect && order.payment_status === 'paid') {
        await base44.asServiceRole.entities.ShopifyOrder.update(order.id, correctData);
        corrections.push({
          order_number: order.shopify_order_number,
          customer_name: order.customer_name,
          customer_email: order.customer_email,
          created_at: order.customer_order_date,
          assigned_production_date: correctData.assigned_production_day,
          assigned_delivery_date: correctData.assigned_delivery_day,
          production_status: correctData.production_status,
          fulfillment_status: correctData.fulfillment_status,
          delivery_status: correctData.delivery_status,
          ready_for_driver: correctData.ready_for_driver,
          reason: 'corrected_to_official_schedule'
        });
      }
    }

    return Response.json({
      message: `Audited and corrected ${corrections.length} orders`,
      corrections_made: corrections,
      audit_date: today,
      notes: 'Orders that are paid but unproduced are removed from Driver Portal and scheduled correctly'
    });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});