import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * monitorNewOrderChain
 *
 * Post-payment chain monitor for live orders/subscriptions.
 * Looks at orders/subscriptions created in the last N minutes and verifies:
 *   1. Hub order exists with correct status
 *   2. FulfillmentTask exists and is Scheduled
 *   3. ProductionBatch includes this order in order_sources
 *   4. No duplicate Hub orders or FulfillmentTasks for same stripe_subscription_id
 *   5. Old/retired orders for same customer are excluded/quarantined
 *
 * Does NOT intervene or mutate any data.
 * Returns pass/fail per chain link, per order.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const lookbackMinutes = body.lookback_minutes || 30;
    const cutoff = new Date(Date.now() - lookbackMinutes * 60 * 1000).toISOString();

    // Load all recent orders, tasks, batches in parallel
    const [recentOrders, allTasks, allBatches] = await Promise.all([
      base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 100),
      base44.asServiceRole.entities.FulfillmentTask.list('-created_date', 200),
      base44.asServiceRole.entities.ProductionBatch.list('-production_date', 100),
    ]);

    // Focus on orders created within the lookback window that are active (paid, not excluded)
    const newOrders = recentOrders.filter(o => {
      const createdAt = new Date(o.created_date || 0).toISOString();
      if (createdAt < cutoff) return false;
      // Only active paid orders
      if (o.payment_status !== 'paid') return false;
      if (['refunded', 'canceled', 'cancelled'].includes(o.production_status)) return false;
      if (Array.isArray(o.tags) && (o.tags.includes('excluded') || o.tags.includes('do_not_sync') || o.tags.includes('retired_canceled_subscription'))) return false;
      if (o.data_quality_status === 'quarantined') return false;
      return true;
    });

    if (newOrders.length === 0) {
      return Response.json({
        status: 'no_new_orders',
        message: `No new active paid orders in the last ${lookbackMinutes} minutes. System idle — nothing to monitor yet.`,
        lookback_minutes: lookbackMinutes,
        cutoff,
        timestamp: new Date().toISOString(),
      });
    }

    const results = [];

    for (const order of newOrders) {
      const checks = {};
      const isSubscription = order.order_type === 'subscription' || order.source_type === 'subscription_fulfillment' || order.source_channel === 'subscription';

      // ── CHECK 1: Hub order health ──────────────────────────────────────────
      const hubOrderOk =
        order.payment_status === 'paid' &&
        order.sync_status === 'synced' &&
        !['refunded', 'canceled', 'cancelled'].includes(order.production_status) &&
        order.data_quality_status !== 'quarantined';

      checks.hub_order = {
        pass: hubOrderOk,
        detail: hubOrderOk
          ? `order ${order.shopify_order_number} → payment_status=paid, sync_status=synced, production_status=${order.production_status}`
          : `FAIL: payment_status=${order.payment_status}, sync_status=${order.sync_status}, production_status=${order.production_status}, dq=${order.data_quality_status}`,
      };

      // ── CHECK 2: FulfillmentTask exists and is Scheduled ──────────────────
      const linkedTasks = allTasks.filter(t =>
        t.order_id === order.id ||
        (isSubscription && order.stripe_subscription_id && t.stripe_subscription_id === order.stripe_subscription_id && t.status === 'Scheduled')
      );
      const activeTasks = linkedTasks.filter(t => t.status === 'Scheduled');
      const taskOk = activeTasks.length === 1;
      const taskWarn = activeTasks.length > 1;

      checks.fulfillment_task = {
        pass: taskOk,
        warn: taskWarn,
        detail: taskOk
          ? `1 Scheduled FulfillmentTask found (id: ${activeTasks[0].id}, date: ${activeTasks[0].scheduled_date})`
          : taskWarn
            ? `WARN: ${activeTasks.length} Scheduled tasks found — possible duplicate`
            : `FAIL: No Scheduled FulfillmentTask found for order ${order.id} / sub ${order.stripe_subscription_id || 'N/A'}`,
        task_ids: activeTasks.map(t => t.id),
      };

      // ── CHECK 3: ProductionBatch includes this order in order_sources ──────
      const deliveryDate = order.assigned_delivery_date || order.fulfillments?.[0]?.delivery_date;
      const productionDate = order.fulfillments?.[0]?.production_date || order.production_date;
      const batchesForDate = productionDate
        ? allBatches.filter(b => b.production_date === productionDate)
        : allBatches;

      const batchesWithOrder = batchesForDate.filter(b =>
        Array.isArray(b.order_sources) &&
        b.order_sources.some(s => s.order_id === order.id)
      );

      // For subscription orders, also check by order_number (#SUB-...)
      const batchesWithOrderNum = batchesForDate.filter(b =>
        Array.isArray(b.order_sources) &&
        b.order_sources.some(s => s.order_number === order.shopify_order_number)
      );

      const allBatchHits = [...new Set([...batchesWithOrder, ...batchesWithOrderNum].map(b => b.id))]
        .map(id => allBatches.find(b => b.id === id));

      const batchOk = allBatchHits.length > 0;
      checks.production_batch = {
        pass: batchOk,
        detail: batchOk
          ? `Found in ${allBatchHits.length} batch(es): ${allBatchHits.map(b => `${b.batch_id} (${b.product_name}, ${b.planned_units} units)`).join(', ')}`
          : `FAIL: Order ${order.shopify_order_number} not found in any ProductionBatch order_sources for production_date=${productionDate || 'unknown'}`,
        production_date: productionDate,
        delivery_date: deliveryDate,
      };

      // ── CHECK 4: No duplicate active orders for same subscription ──────────
      let dupCheck = { pass: true, detail: 'N/A (one-time order)' };
      if (isSubscription && order.stripe_subscription_id) {
        const siblingsActive = recentOrders.filter(o2 =>
          o2.id !== order.id &&
          o2.stripe_subscription_id === order.stripe_subscription_id &&
          o2.payment_status === 'paid' &&
          !['refunded', 'canceled', 'cancelled'].includes(o2.production_status) &&
          o2.data_quality_status !== 'quarantined' &&
          !(Array.isArray(o2.tags) && (o2.tags.includes('excluded') || o2.tags.includes('do_not_sync')))
        );
        dupCheck = {
          pass: siblingsActive.length === 0,
          detail: siblingsActive.length === 0
            ? `No duplicate active orders for sub ${order.stripe_subscription_id}`
            : `WARN: ${siblingsActive.length} other active order(s) found for same sub: ${siblingsActive.map(o2 => o2.shopify_order_number).join(', ')}`,
          duplicate_ids: siblingsActive.map(o2 => o2.id),
        };
      }
      checks.no_duplicate_orders = dupCheck;

      // ── CHECK 5: Old/retired orders for same customer are excluded ─────────
      const customerOrders = recentOrders.filter(o2 =>
        o2.id !== order.id &&
        o2.customer_email === order.customer_email &&
        isSubscription &&
        (o2.order_type === 'subscription' || o2.source_type === 'subscription_fulfillment')
      );
      const retiredOk = customerOrders.every(o2 =>
        o2.data_quality_status === 'quarantined' ||
        o2.production_status === 'canceled' ||
        o2.production_status === 'cancelled' ||
        o2.payment_status === 'refunded' ||
        (Array.isArray(o2.tags) && (o2.tags.includes('excluded') || o2.tags.includes('do_not_sync')))
      );
      const leakyOld = customerOrders.filter(o2 =>
        o2.data_quality_status !== 'quarantined' &&
        !['canceled', 'cancelled'].includes(o2.production_status) &&
        o2.payment_status !== 'refunded' &&
        !(Array.isArray(o2.tags) && (o2.tags.includes('excluded') || o2.tags.includes('do_not_sync')))
      );
      checks.old_orders_retired = isSubscription
        ? {
            pass: retiredOk,
            detail: retiredOk
              ? `All ${customerOrders.length} other subscription order(s) for ${order.customer_email} are properly retired/excluded`
              : `WARN: ${leakyOld.length} old subscription order(s) for ${order.customer_email} are NOT excluded: ${leakyOld.map(o2 => o2.shopify_order_number).join(', ')}`,
            leaky_ids: leakyOld.map(o2 => o2.id),
          }
        : { pass: true, detail: 'N/A (one-time order)' };

      // ── Overall pass/fail for this order ──────────────────────────────────
      const allPassed = Object.values(checks).every(c => c.pass !== false);
      const anyFailed = Object.values(checks).some(c => c.pass === false);
      const anyWarn = Object.values(checks).some(c => c.warn === true);

      results.push({
        order_id: order.id,
        order_number: order.shopify_order_number,
        customer_name: order.customer_name,
        customer_email: order.customer_email,
        order_type: isSubscription ? 'subscription' : 'one_time',
        stripe_subscription_id: order.stripe_subscription_id || null,
        created_at: order.created_date,
        chain_status: anyFailed ? 'FAIL' : anyWarn ? 'WARN' : 'PASS',
        checks,
      });
    }

    const totalPass = results.filter(r => r.chain_status === 'PASS').length;
    const totalFail = results.filter(r => r.chain_status === 'FAIL').length;
    const totalWarn = results.filter(r => r.chain_status === 'WARN').length;

    return Response.json({
      timestamp: new Date().toISOString(),
      lookback_minutes: lookbackMinutes,
      cutoff,
      orders_monitored: results.length,
      summary: { pass: totalPass, warn: totalWarn, fail: totalFail },
      overall: totalFail > 0 ? 'FAIL' : totalWarn > 0 ? 'WARN' : 'PASS',
      results,
    });

  } catch (error) {
    console.error('[MONITOR-CHAIN]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});