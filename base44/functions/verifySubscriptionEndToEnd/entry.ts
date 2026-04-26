import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * SUBSCRIPTION END-TO-END VERIFICATION
 * 
 * Tests a real subscription and verifies all 10 critical steps:
 * 1. Stripe event received
 * 2. 4 weekly orders created
 * 3. VIP Wellness composition (2 Oasis, 2 Aura, 2 Re-Nu per delivery)
 * 4. Monthly Ritual composition (1 Oasis, 1 Aura, 1 Re-Nu per delivery)
 * 5. Fulfillment dates (7 days apart)
 * 6. Production Planning sees orders
 * 7. Driver Portal sees fulfillment tasks
 * 8. No duplicate orders (exactly 4)
 * 9. No Customer App generated orders
 * 10. Data quality fields correct
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { stripe_subscription_id } = body;

    if (!stripe_subscription_id) {
      return Response.json({ 
        error: 'Missing stripe_subscription_id',
        message: 'Provide stripe_subscription_id in request body'
      }, { status: 400 });
    }

    const results = {
      test_subscription_id: stripe_subscription_id,
      timestamp: new Date().toISOString(),
      checks: {},
      summary: {
        total: 10,
        passed: 0,
        failed: 0,
      }
    };

    // CHECK 1: Stripe Event Received
    try {
      const stripeEvents = await base44.asServiceRole.entities.StripeEventLog.filter({
        stripe_subscription_id: stripe_subscription_id,
        event_type: 'customer.subscription.created'
      });
      
      results.checks['1_stripe_event_received'] = {
        status: stripeEvents && stripeEvents.length > 0 ? 'PASS' : 'FAIL',
        detail: stripeEvents && stripeEvents.length > 0 ? `Found event: ${stripeEvents[0].stripe_event_id}` : 'No customer.subscription.created event found',
      };
    } catch (e) {
      results.checks['1_stripe_event_received'] = { status: 'FAIL', error: e.message };
    }

    // CHECK 2-10: Get all orders for this subscription
    let orders = [];
    try {
      orders = await base44.asServiceRole.entities.ShopifyOrder.filter({
        stripe_subscription_id: stripe_subscription_id
      });
    } catch (e) {
      results.checks['2_four_weekly_orders'] = { status: 'FAIL', error: e.message };
      return Response.json({ success: false, results });
    }

    // CHECK 2: Four Weekly Orders
    results.checks['2_four_weekly_orders'] = {
      status: orders.length === 4 ? 'PASS' : 'FAIL',
      detail: `Found ${orders.length} orders (expected 4)`,
      order_ids: orders.map(o => o.id),
    };
    if (orders.length !== 4) results.summary.failed++;
    else results.summary.passed++;

    // CHECK 3-4: Composition (VIP & Monthly Ritual)
    const vipOrders = orders.filter(o => o.line_items?.some(item => item.title?.toLowerCase().includes('vip wellness')));
    const ritualOrders = orders.filter(o => o.line_items?.some(item => item.title?.toLowerCase().includes('monthly ritual')));

    // VIP Wellness: 2 Oasis, 2 Aura, 2 Re-Nu
    const vipCompositionValid = vipOrders.every(order => {
      const items = order.line_items || [];
      const oasis = items.filter(i => i.title?.toLowerCase().includes('oasis')).reduce((s, i) => s + (i.quantity || 0), 0);
      const aura = items.filter(i => i.title?.toLowerCase().includes('aura')).reduce((s, i) => s + (i.quantity || 0), 0);
      const renu = items.filter(i => i.title?.toLowerCase().includes('re-nu')).reduce((s, i) => s + (i.quantity || 0), 0);
      return oasis === 2 && aura === 2 && renu === 2;
    });

    results.checks['3_vip_wellness_composition'] = {
      status: vipOrders.length > 0 && vipCompositionValid ? 'PASS' : 'FAIL',
      detail: vipOrders.length === 0 ? 'No VIP Wellness orders found' : 
              vipCompositionValid ? 'All VIP orders have correct composition' : 'Some VIP orders have wrong composition',
      vip_order_count: vipOrders.length,
    };
    if (vipOrders.length > 0 && !vipCompositionValid) results.summary.failed++;
    else if (vipOrders.length > 0) results.summary.passed++;

    // Monthly Ritual: 1 Oasis, 1 Aura, 1 Re-Nu
    const ritualCompositionValid = ritualOrders.every(order => {
      const items = order.line_items || [];
      const oasis = items.filter(i => i.title?.toLowerCase().includes('oasis')).reduce((s, i) => s + (i.quantity || 0), 0);
      const aura = items.filter(i => i.title?.toLowerCase().includes('aura')).reduce((s, i) => s + (i.quantity || 0), 0);
      const renu = items.filter(i => i.title?.toLowerCase().includes('re-nu')).reduce((s, i) => s + (i.quantity || 0), 0);
      return oasis === 1 && aura === 1 && renu === 1;
    });

    results.checks['4_monthly_ritual_composition'] = {
      status: ritualOrders.length > 0 && ritualCompositionValid ? 'PASS' : 'FAIL',
      detail: ritualOrders.length === 0 ? 'No Monthly Ritual orders found' : 
              ritualCompositionValid ? 'All Ritual orders have correct composition' : 'Some Ritual orders have wrong composition',
      ritual_order_count: ritualOrders.length,
    };
    if (ritualOrders.length > 0 && !ritualCompositionValid) results.summary.failed++;
    else if (ritualOrders.length > 0) results.summary.passed++;

    // CHECK 5: Fulfillment Dates (7 days apart)
    let fulfillmentDatesValid = true;
    const dates = [];
    if (orders.length > 0 && orders[0].fulfillments) {
      orders[0].fulfillments.forEach(f => {
        if (f.delivery_date) dates.push(new Date(f.delivery_date).getTime());
      });
      dates.sort((a, b) => a - b);
      
      for (let i = 1; i < dates.length; i++) {
        const daysDiff = (dates[i] - dates[i-1]) / (1000 * 60 * 60 * 24);
        if (Math.abs(daysDiff - 7) > 1) { // Allow ±1 day tolerance
          fulfillmentDatesValid = false;
          break;
        }
      }
    } else {
      fulfillmentDatesValid = false;
    }

    results.checks['5_fulfillment_dates'] = {
      status: fulfillmentDatesValid ? 'PASS' : 'FAIL',
      detail: fulfillmentDatesValid ? 'Delivery dates are 7 days apart' : 'Delivery dates are not properly spaced',
      delivery_dates: dates.map(d => new Date(d).toISOString().split('T')[0]),
    };
    if (!fulfillmentDatesValid) results.summary.failed++;
    else results.summary.passed++;

    // CHECK 6: Production Planning sees orders
    let productionBatches = [];
    try {
      productionBatches = await base44.asServiceRole.entities.ProductionBatch.list('', 500);
      const batchesWithOrders = productionBatches.filter(b => 
        b.order_sources?.some(os => os.order_id && orders.map(o => o.id).includes(os.order_id))
      );
      results.checks['6_production_planning'] = {
        status: batchesWithOrders.length > 0 ? 'PASS' : 'FAIL',
        detail: batchesWithOrders.length > 0 ? `Found ${batchesWithOrders.length} batches with test orders` : 'No production batches contain test orders',
        batch_count: batchesWithOrders.length,
      };
      if (batchesWithOrders.length > 0) results.summary.passed++;
      else results.summary.failed++;
    } catch (e) {
      results.checks['6_production_planning'] = { status: 'FAIL', error: e.message };
      results.summary.failed++;
    }

    // CHECK 7: Driver Portal sees fulfillment tasks
    let fulfillmentTasks = [];
    try {
      fulfillmentTasks = await base44.asServiceRole.entities.FulfillmentTask.filter({});
      const tasksWithOrders = fulfillmentTasks.filter(t => t.order_id && orders.map(o => o.id).includes(t.order_id));
      results.checks['7_driver_portal'] = {
        status: tasksWithOrders.length > 0 ? 'PASS' : 'FAIL',
        detail: tasksWithOrders.length > 0 ? `Found ${tasksWithOrders.length} fulfillment tasks` : 'No fulfillment tasks for test orders',
        task_count: tasksWithOrders.length,
      };
      if (tasksWithOrders.length > 0) results.summary.passed++;
      else results.summary.failed++;
    } catch (e) {
      results.checks['7_driver_portal'] = { status: 'FAIL', error: e.message };
      results.summary.failed++;
    }

    // CHECK 8: No duplicate orders (exactly 4)
    results.checks['8_no_duplicate_orders'] = {
      status: orders.length === 4 ? 'PASS' : 'FAIL',
      detail: `Found ${orders.length} orders (expected exactly 4)`,
      order_count: orders.length,
    };
    if (orders.length === 4) results.summary.passed++;
    else results.summary.failed++;

    // CHECK 9: No Customer App generated orders
    let syncLogs = [];
    try {
      syncLogs = await base44.asServiceRole.entities.OrderSyncLog.filter({
        sync_source: 'customer_app_pull'
      });
      const customerAppOrderIds = syncLogs.map(log => log.order_id);
      const customerAppOrders = orders.filter(o => customerAppOrderIds.includes(o.id));
      
      results.checks['9_no_customer_app_orders'] = {
        status: customerAppOrders.length === 0 ? 'PASS' : 'FAIL',
        detail: customerAppOrders.length === 0 ? 'No orders from Customer App' : `Found ${customerAppOrders.length} orders from Customer App (should be 0)`,
        customer_app_order_count: customerAppOrders.length,
      };
      if (customerAppOrders.length === 0) results.summary.passed++;
      else results.summary.failed++;
    } catch (e) {
      results.checks['9_no_customer_app_orders'] = { status: 'FAIL', error: e.message };
      results.summary.failed++;
    }

    // CHECK 10: Data quality fields
    const dataQualityValid = orders.every(o => 
      o.order_lock_status === 'unlocked' &&
      o.data_quality_status === 'complete' &&
      o.repair_status === 'none'
    );

    results.checks['10_data_quality'] = {
      status: dataQualityValid ? 'PASS' : 'FAIL',
      detail: dataQualityValid ? 'All orders have correct data quality fields' : 'Some orders have incorrect fields',
      orders_checked: orders.length,
      orders_with_issues: orders.filter(o => 
        o.order_lock_status !== 'unlocked' || 
        o.data_quality_status !== 'complete' || 
        o.repair_status !== 'none'
      ).length,
    };
    if (dataQualityValid) results.summary.passed++;
    else results.summary.failed++;

    results.summary.status = results.summary.failed === 0 ? 'ALL_PASS' : 'SOME_FAILED';

    return Response.json({ success: true, results });
  } catch (error) {
    console.error('[VERIFY-SUBSCRIPTION]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});