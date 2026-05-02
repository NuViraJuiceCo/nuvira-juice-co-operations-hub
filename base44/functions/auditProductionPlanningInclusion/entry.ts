import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import moment from 'npm:moment-timezone@0.5.45';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user?.role === 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const CHICAGO_TZ = 'America/Chicago';
    const twoPmMinutes = 14 * 60;
    const nowUtc = moment.utc();
    const nowChicago = nowUtc.clone().tz(CHICAGO_TZ);

    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500);

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

    const activeOrders = allOrders.filter(o => 
      !isOrderExcluded(o) &&
      o.payment_status === 'paid'
    );

    const saturdayWindowActiveOrders = activeOrders.filter(o => {
      if (!o.customer_order_date) return false;
      const chicagoTime = moment(o.customer_order_date).tz(CHICAGO_TZ);
      const oDay = chicagoTime.day();
      const oMin = chicagoTime.hour() * 60 + chicagoTime.minute();
      return (oDay === 5 && oMin >= twoPmMinutes) || (oDay === 6 && oMin < twoPmMinutes);
    });

    const saturdayEligibleCount = saturdayWindowActiveOrders.length;
    const saturdayThresholdMet = saturdayEligibleCount > 10;

    // Build proof table for ALL orders
    const proofTable = allOrders.map(order => {
      const excluded = isOrderExcluded(order);
      const active = !excluded && order.payment_status === 'paid';
      
      let refunded = 'NO';
      let deleted = 'NO';
      let reason = '';

      if (order.payment_status === 'refunded') {
        refunded = 'YES';
        reason = 'payment_status=refunded';
      }
      if (order.production_status === 'refunded') {
        refunded = 'YES';
        reason = (reason ? reason + ', ' : '') + 'production_status=refunded';
      }
      if (order.canceled_at) {
        deleted = 'YES';
        reason = (reason ? reason + ', ' : '') + 'canceled_at set';
      }
      if (order.deleted_at) {
        deleted = 'YES';
        reason = (reason ? reason + ', ' : '') + 'deleted_at set';
      }
      if (order.do_not_recover === true) {
        reason = (reason ? reason + ', ' : '') + 'do_not_recover=true';
      }
      if (order.production_status === 'canceled') {
        reason = (reason ? reason + ', ' : '') + 'production_status=canceled';
      }

      let cutoffWindow = 'N/A';
      let saturdayIncluded = 'NO';
      let saturdayThresholdStatus = 'N/A';

      if (active && order.customer_order_date) {
        const chicagoTime = moment(order.customer_order_date).tz(CHICAGO_TZ);
        const oDay = chicagoTime.day();
        const oMin = chicagoTime.hour() * 60 + chicagoTime.minute();

        if (
          (oDay === 6 && oMin >= twoPmMinutes) ||
          oDay === 0 ||
          oDay === 1 ||
          (oDay === 2 && oMin < twoPmMinutes)
        ) {
          cutoffWindow = 'Tuesday';
        } else if (
          (oDay === 2 && oMin >= twoPmMinutes) ||
          oDay === 3 ||
          oDay === 4 ||
          (oDay === 5 && oMin < twoPmMinutes)
        ) {
          cutoffWindow = 'Friday';
        } else if (
          (oDay === 5 && oMin >= twoPmMinutes) ||
          (oDay === 6 && oMin < twoPmMinutes)
        ) {
          cutoffWindow = 'Window 3 (Conditional Saturday)';
          saturdayIncluded = 'YES';
          saturdayThresholdStatus = saturdayThresholdMet ? 'MET (→ Saturday/Sunday)' : 'NOT MET (→ Rolled to Tuesday/Wednesday)';
        }
      }

      return {
        section: order.source_channel === 'subscription' ? 'SUBSCRIPTION' : 'ONE-TIME',
        order_number: order.shopify_order_number,
        customer: order.customer_name || order.customer_email,
        included: active ? 'YES' : 'NO',
        reason: active ? `Active paid order in ${cutoffWindow}` : reason || 'Unknown exclusion',
        refunded: refunded,
        deleted: deleted,
        active: active ? 'YES' : 'NO',
        cutoff_window: cutoffWindow,
        saturday_threshold_included: saturdayIncluded,
        saturday_threshold_status: saturdayThresholdStatus,
        assigned_production_date: order.assigned_production_date || cutoffWindow,
        assigned_delivery_date: order.assigned_delivery_date || 'TBD',
        production_status: order.production_status,
        fulfillment_status: order.fulfillment_status || 'unknown',
        delivery_status: order.delivery_status || 'unknown',
        production_components: order.fulfillments?.[0]?.items?.map(i => `${i.title} x${i.quantity}`).join(', ') || order.line_items?.map(i => `${i.title} x${i.quantity}`).join(', ') || 'N/A',
        customer_facing_item: order.line_items?.map(i => `${i.title} x${i.quantity}`).join(', ') || 'N/A',
        production_batch_id: order.production_batch_id || 'Not assigned',
        ready_for_driver: 'NO',
        blocked_reason: excluded ? reason : 'None'
      };
    });

    // Group by section
    const bySection = {};
    for (const row of proofTable) {
      if (!bySection[row.section]) bySection[row.section] = [];
      bySection[row.section].push(row);
    }

    return Response.json({
      timestamp: nowChicago.format('YYYY-MM-DD HH:mm:ss Z'),
      summary: {
        total_orders: allOrders.length,
        active_orders: activeOrders.length,
        excluded_orders: allOrders.filter(isOrderExcluded).length,
        saturday_window_eligible: saturdayEligibleCount,
        saturday_threshold_met: saturdayThresholdMet,
        decision: saturdayThresholdMet ? 'Saturday production → Sunday delivery' : 'Roll Window 3 to Tuesday production → Wednesday delivery'
      },
      proof_table_by_section: bySection,
      all_orders_proof: proofTable
    });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});