import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import moment from 'npm:moment-timezone@0.5.45';

// Delivery window config
function getDeliveryWindowForProductionDay(production_day) {
  switch (production_day) {
    case 'Tuesday':
      return {
        delivery_day: 'Wednesday',
        delivery_window_start: 17,
        delivery_window_end: 20,
        delivery_window_label: '5:00 PM - 8:00 PM',
      };
    case 'Friday':
      return {
        delivery_day: 'Saturday',
        delivery_window_start: 17,
        delivery_window_end: 20,
        delivery_window_label: '5:00 PM - 8:00 PM',
      };
    case 'Saturday':
      return {
        delivery_day: 'Sunday',
        delivery_window_start: null,
        delivery_window_end: null,
        delivery_window_label: 'Manual/Exception',
      };
    default:
      return null;
  }
}

function calculateDeliveryDate(production_date, production_day) {
  if (!production_date) return null;
  const prodDate = moment(production_date);
  let daysToAdd = 0;
  switch (production_day) {
    case 'Tuesday':
      daysToAdd = 1;
      break;
    case 'Friday':
      daysToAdd = 1;
      break;
    case 'Saturday':
      daysToAdd = 1;
      break;
  }
  return prodDate.add(daysToAdd, 'days').format('YYYY-MM-DD');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const CHICAGO_TZ = 'America/Chicago';
    const twoPmMinutes = 14 * 60;
    const nowUtc = moment.utc();
    const nowChicago = nowUtc.clone().tz(CHICAGO_TZ);

    // Fetch all data
    const [allOrders, allBatches] = await Promise.all([
      base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500),
      base44.asServiceRole.entities.ProductionBatch.list('-production_date', 500),
    ]);

    // ─── GUARDRAILS: Multi-guard exclusion (mirrors Fulfillment isOrderProduction) ──
    const isOrderExcluded = (order) => {
      const tags = order.tags || [];
      if (tags.includes('refunded') || tags.includes('excluded') || tags.includes('do_not_sync') || tags.includes('not_for_production')) return true;
      if (order.sync_status === 'do_not_sync') return true;
      if (order.fulfillment_status === 'cancelled' || order.fulfillment_status === 'canceled') return true;
      if (['fulfilled', 'canceled', 'refunded', 'excluded'].includes(order.production_status)) return true;
      if (order.data_quality_status === 'quarantined') return true;
      if (order.do_not_recover === true || order.do_not_sync === true) return true;
      if (order.canceled_at || order.deleted_at) return true;
      // ── CRITICAL: POS/event orders are fulfilled on-site — NEVER create production demand ──
      if (order.source_type === 'shopify_pos' || order.source_channel === 'pos' || order.order_type === 'pos' || order.fulfillment_method === 'pos') return true;
      if (order.production_status === 'not_required') return true;
      return false;
    };

    // ─── Saturday threshold calculation ──────────────────────────────────────
    const activeOrders = allOrders.filter(o =>
      !isOrderExcluded(o) &&
      o.payment_status === 'paid'
    );
    console.log(`[PROD-PLANNING] Active orders: ${activeOrders.length} of ${allOrders.length} total (${allOrders.filter(isOrderExcluded).length} excluded)`);

    const saturdayWindowActiveOrders = activeOrders.filter(o => {
      if (!o.customer_order_date) return false;
      const chicagoTime = moment(o.customer_order_date).tz(CHICAGO_TZ);
      const oDay = chicagoTime.day();
      const oMin = chicagoTime.hour() * 60 + chicagoTime.minute();
      return (oDay === 5 && oMin >= twoPmMinutes) || (oDay === 6 && oMin < twoPmMinutes);
    });

    const saturdayEligibleCount = saturdayWindowActiveOrders.length;
    const saturdayThresholdMet = saturdayEligibleCount > 10;
    const saturdayDeadline = nowChicago.clone().day(6).hour(14).minute(0).second(0);
    if (nowChicago.isBefore(saturdayDeadline)) {
      saturdayDeadline.subtract(1, 'week');
    }
    const pastSaturdayDeadline = nowChicago.isAfter(saturdayDeadline);

    // ─── Normalize all active orders into production planning rows ──────────────
    const productionRows = [];

    for (const order of activeOrders) {
      const isSubscription = order.source_channel === 'subscription';
      const isFulfilled = order.production_status === 'fulfilled';

      // Skip fully fulfilled orders
      if (isFulfilled) continue;

      // Determine order type and fulfillment mode
      const orderType = order.source_channel === 'subscription' ? 'subscription' : 'one_time';
      const fulfillmentMode = order.fulfillment_mode || (order.fulfillments?.length > 1 ? 'multi_delivery' : 'single_delivery');

      // Determine production date and assigned day
      let assignedProductionDate = order.assigned_production_date;
      let cutoffWindow = 'regular';
      let saturdayIncluded = 'no';
      
      if (!assignedProductionDate && order.customer_order_date) {
        const chicagoTime = moment(order.customer_order_date).tz(CHICAGO_TZ);
        const oDay = chicagoTime.day();
        const oMin = chicagoTime.hour() * 60 + chicagoTime.minute();

        // Determine cutoff window
        if (
          (oDay === 6 && oMin >= twoPmMinutes) ||
          oDay === 0 ||
          oDay === 1 ||
          (oDay === 2 && oMin < twoPmMinutes)
        ) {
          assignedProductionDate = 'Tuesday';
        } else if (
          (oDay === 2 && oMin >= twoPmMinutes) ||
          oDay === 3 ||
          oDay === 4 ||
          (oDay === 5 && oMin < twoPmMinutes)
        ) {
          assignedProductionDate = 'Friday';
        } else if (
          (oDay === 5 && oMin >= twoPmMinutes) ||
          (oDay === 6 && oMin < twoPmMinutes)
        ) {
          cutoffWindow = 'Window 3 (Conditional Saturday)';
          saturdayIncluded = 'yes';
          assignedProductionDate = saturdayThresholdMet && pastSaturdayDeadline ? 'Saturday' : 'Tuesday';
        }
      }

      // For subscriptions, enumerate fulfillments
      if (isSubscription && order.fulfillments && order.fulfillments.length > 0) {
        for (let fi = 0; fi < order.fulfillments.length; fi++) {
          const f = order.fulfillments[fi];
          let prodDate = f.production_date || assignedProductionDate;
          // If prodDate is an ISO date string, convert it to a day name
          if (prodDate && /^\d{4}-\d{2}-\d{2}$/.test(prodDate)) {
            const dayOfWeek = moment(prodDate).day();
            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            prodDate = dayNames[dayOfWeek];
          }
          const windowInfo = getDeliveryWindowForProductionDay(prodDate);
          const deliveryDate = f.delivery_date || calculateDeliveryDate(
            f.production_date || moment().format('YYYY-MM-DD'),
            prodDate
          );

          productionRows.push({
            order_number: order.shopify_order_number,
            customer_name: order.customer_name || order.customer_email,
            customer_email: order.customer_email,
            order_type: 'subscription',
            fulfillment_mode: 'multi_delivery',
            parent_subscription_id: order.id,
            fulfillment_number: fi + 1,
            fulfillment_id: `${order.id}__${fi}`,
            line_items: order.line_items || [],
            production_components: f.items || [],
            payment_status: order.payment_status,
            is_refunded: false,
            is_deleted: false,
            is_active: true,
            do_not_recover: false,
            assigned_production_date: prodDate,
            assigned_delivery_date: f.delivery_date || deliveryDate,
            assigned_delivery_window_start: windowInfo?.delivery_window_start || null,
            assigned_delivery_window_end: windowInfo?.delivery_window_end || null,
            delivery_window_label: windowInfo?.delivery_window_label || null,
            delivery_window_timezone: 'America/Chicago',
            production_status: order.production_status,
            fulfillment_status: f.status || 'pending',
            delivery_status: order.delivery_status || 'not_ready',
            production_batch_id: null,
            batch_status: null,
            ready_for_driver: false,
            cutoff_window: cutoffWindow,
            saturday_threshold_status: saturdayThresholdMet ? 'met' : 'not_met',
            saturday_threshold_included: saturdayIncluded,
            scheduling_reason: null,
            blocked_from_production: false,
            blocked_reason: null,
            included_in_active_production: true,
            included_in_saturday_threshold_count: saturdayIncluded,
          });
        }
      } else {
        // One-time order
        let oneTimeProductionDate = assignedProductionDate;
        let oneTimeCutoff = 'regular';
        let oneTimeSaturdayIncluded = 'no';
        
        if (!oneTimeProductionDate && order.customer_order_date) {
          const chicagoTime = moment(order.customer_order_date).tz(CHICAGO_TZ);
          const oDay = chicagoTime.day();
          const oMin = chicagoTime.hour() * 60 + chicagoTime.minute();

          if (
            (oDay === 6 && oMin >= twoPmMinutes) ||
            oDay === 0 ||
            oDay === 1 ||
            (oDay === 2 && oMin < twoPmMinutes)
          ) {
            oneTimeProductionDate = 'Tuesday';
          } else if (
            (oDay === 2 && oMin >= twoPmMinutes) ||
            oDay === 3 ||
            oDay === 4 ||
            (oDay === 5 && oMin < twoPmMinutes)
          ) {
            oneTimeProductionDate = 'Friday';
          } else if (
            (oDay === 5 && oMin >= twoPmMinutes) ||
            (oDay === 6 && oMin < twoPmMinutes)
          ) {
            oneTimeCutoff = 'Window 3 (Conditional Saturday)';
            oneTimeSaturdayIncluded = 'yes';
            oneTimeProductionDate = saturdayThresholdMet && pastSaturdayDeadline ? 'Saturday' : 'Tuesday';
          }
        }

        let oneTimeProdDate = order.fulfillments?.[0]?.production_date || oneTimeProductionDate;
        // If oneTimeProdDate is an ISO date string, convert it to a day name
        if (oneTimeProdDate && /^\d{4}-\d{2}-\d{2}$/.test(oneTimeProdDate)) {
          const dayOfWeek = moment(oneTimeProdDate).day();
          const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          oneTimeProdDate = dayNames[dayOfWeek];
        }
        const windowInfo = getDeliveryWindowForProductionDay(oneTimeProdDate);
        const deliveryDate = order.fulfillments?.[0]?.delivery_date || order.assigned_delivery_date || calculateDeliveryDate(
          order.fulfillments?.[0]?.production_date || moment().format('YYYY-MM-DD'),
          oneTimeProdDate
        );

        productionRows.push({
          order_number: order.shopify_order_number,
          customer_name: order.customer_name || order.customer_email,
          customer_email: order.customer_email,
          order_type: 'one_time',
          fulfillment_mode: 'single_delivery',
          parent_subscription_id: null,
          fulfillment_number: 1,
          fulfillment_id: order.id,
          line_items: order.line_items || [],
          production_components: order.fulfillments?.[0]?.items || [],
          payment_status: order.payment_status,
          is_refunded: false,
          is_deleted: false,
          is_active: true,
          do_not_recover: false,
          assigned_production_date: oneTimeProdDate,
          assigned_delivery_date: deliveryDate,
          assigned_delivery_window_start: windowInfo?.delivery_window_start || null,
          assigned_delivery_window_end: windowInfo?.delivery_window_end || null,
          delivery_window_label: windowInfo?.delivery_window_label || null,
          delivery_window_timezone: 'America/Chicago',
          production_status: order.production_status,
          fulfillment_status: order.fulfillments?.[0]?.status || order.fulfillment_status || 'pending',
          delivery_status: order.delivery_status || 'not_ready',
          production_batch_id: null,
          batch_status: null,
          ready_for_driver: false,
          cutoff_window: oneTimeCutoff,
          saturday_threshold_status: saturdayThresholdMet ? 'met' : 'not_met',
          saturday_threshold_included: oneTimeSaturdayIncluded,
          scheduling_reason: null,
          blocked_from_production: false,
          blocked_reason: null,
          included_in_active_production: true,
          included_in_saturday_threshold_count: oneTimeSaturdayIncluded,
        });
      }
    }

    // ─── Link production batches to rows ─────────────────────────────────────
    const batchMap = {};
    for (const batch of allBatches) {
      const key = `${batch.production_date}__${(batch.product_name || '').toLowerCase()}`;
      batchMap[key] = batch;
    }

    for (const row of productionRows) {
      const key = `${row.assigned_production_date}__${(row.production_components[0]?.title || '').toLowerCase()}`;
      if (batchMap[key]) {
        row.production_batch_id = batchMap[key].id;
        row.batch_status = batchMap[key].status;
      }
    }

    return Response.json({
      now_chicago: nowChicago.format('YYYY-MM-DD HH:mm:ss Z'),
      saturday_threshold: {
        active_eligible_count: saturdayEligibleCount,
        threshold_met: saturdayThresholdMet,
        past_deadline: pastSaturdayDeadline,
        decision: saturdayThresholdMet ? 'Saturday → Sunday' : 'Roll to Tuesday → Wednesday'
      },
      active_orders_count: activeOrders.length,
      excluded_orders_count: allOrders.filter(isOrderExcluded).length,
      production_rows: productionRows,
      batch_count: Object.keys(batchMap).length,
    });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});