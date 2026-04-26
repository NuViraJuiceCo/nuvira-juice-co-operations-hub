import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * PRODUCTION PLANNING & DRIVER PORTAL INTEGRITY CHECK
 * 
 * Verifies:
 * - Every production batch maps to exactly one verified order
 * - Every driver record maps to exactly one verified delivery
 * - No quarantined/incomplete orders in production
 * - No duplicate orders in driver portal
 * - No archived orders in operational flows
 * - No #UNKNOWN orders anywhere operational
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const [allOrders, allBatches, allFulfillmentTasks] = await Promise.all([
      base44.asServiceRole.entities.ShopifyOrder.list('', 1000),
      base44.asServiceRole.entities.ProductionBatch.list('', 500),
      base44.asServiceRole.entities.FulfillmentTask.list('', 500),
    ]);

    const issues = {
      production: {
        orphaned_batches: [],
        batches_with_missing_orders: [],
        batches_with_quarantined_orders: [],
        batches_with_unknown_orders: [],
        batches_with_locked_orders: [],
        duplicates_in_production: [],
      },
      driver_portal: {
        tasks_with_missing_orders: [],
        tasks_with_quarantined_orders: [],
        tasks_with_unknown_orders: [],
        duplicate_deliveries: [],
      },
      safety: {
        archived_in_operational: [],
        incomplete_in_operational: [],
        quarantined_in_operational: [],
      },
    };

    const orderMap = new Map(allOrders.map(o => [o.id, o]));
    const orderByNumber = new Map(allOrders.map(o => [o.shopify_order_number, o]));

    // PRODUCTION BATCH INTEGRITY
    for (const batch of allBatches || []) {
      if (!batch.order_sources || batch.order_sources.length === 0) {
        issues.production.orphaned_batches.push({
          batch_id: batch.batch_id,
          product_name: batch.product_name,
          status: batch.status,
        });
        continue;
      }

      const batchOrders = batch.order_sources.map(os => ({
        os_data: os,
        order: orderMap.get(os.order_id) || orderByNumber.get(os.order_id),
      }));

      for (const { os_data, order } of batchOrders) {
        if (!order) {
          issues.production.batches_with_missing_orders.push({
            batch_id: batch.batch_id,
            missing_order_id: os_data.order_id,
            missing_order_number: os_data.order_id,
          });
          continue;
        }

        // Check if order is quarantined
        if (['quarantined', 'needs_review'].includes(order.data_quality_status)) {
          issues.production.batches_with_quarantined_orders.push({
            batch_id: batch.batch_id,
            order_id: order.id,
            order_number: order.shopify_order_number,
            status: order.data_quality_status,
          });
        }

        // Check if order is #UNKNOWN
        if (order.customer_name === 'Unknown' || order.customer_email === 'unknown@unknown.com') {
          issues.production.batches_with_unknown_orders.push({
            batch_id: batch.batch_id,
            order_id: order.id,
            order_number: order.shopify_order_number,
          });
        }

        // Check if order is locked
        if (order.order_lock_status === 'fulfilled') {
          issues.production.batches_with_locked_orders.push({
            batch_id: batch.batch_id,
            order_id: order.id,
            order_number: order.shopify_order_number,
            lock_status: order.order_lock_status,
          });
        }
      }

      // Check for duplicate orders in same batch
      const orderIds = new Set();
      for (const os of batch.order_sources) {
        if (orderIds.has(os.order_id)) {
          issues.production.duplicates_in_production.push({
            batch_id: batch.batch_id,
            duplicate_order_id: os.order_id,
          });
        }
        orderIds.add(os.order_id);
      }
    }

    // DRIVER PORTAL INTEGRITY
    const deliveryByOrderId = new Map();
    for (const task of allFulfillmentTasks || []) {
      if (!task.order_id) continue;

      // Check if order exists
      const order = orderMap.get(task.order_id);
      if (!order) {
        issues.driver_portal.tasks_with_missing_orders.push({
          task_id: task.id,
          missing_order_id: task.order_id,
          customer_name: task.customer_name,
        });
        continue;
      }

      // Check if order is quarantined
      if (['quarantined', 'needs_review'].includes(order.data_quality_status)) {
        issues.driver_portal.tasks_with_quarantined_orders.push({
          task_id: task.id,
          order_id: order.id,
          order_number: order.shopify_order_number,
          status: order.data_quality_status,
        });
      }

      // Check if order is #UNKNOWN
      if (order.customer_name === 'Unknown' || order.customer_email === 'unknown@unknown.com') {
        issues.driver_portal.tasks_with_unknown_orders.push({
          task_id: task.id,
          order_id: order.id,
          order_number: order.shopify_order_number,
        });
      }

      // Check for duplicate deliveries of same order
      if (!deliveryByOrderId.has(task.order_id)) {
        deliveryByOrderId.set(task.order_id, []);
      }
      deliveryByOrderId.get(task.order_id).push(task.id);
    }

    for (const [orderId, taskIds] of deliveryByOrderId.entries()) {
      if (taskIds.length > 1) {
        const order = orderMap.get(orderId);
        issues.driver_portal.duplicate_deliveries.push({
          order_id: orderId,
          order_number: order?.shopify_order_number,
          duplicate_task_count: taskIds.length,
          task_ids: taskIds,
        });
      }
    }

    // SAFETY CHECKS
    for (const order of allOrders || []) {
      // Check if archived order is in operational flow
      if (['archived', 'deleted'].includes(order.data_quality_status)) {
        const inProduction = (allBatches || []).some(b => 
          b.order_sources?.some(os => os.order_id === order.id)
        );
        const inDriver = (allFulfillmentTasks || []).some(t => t.order_id === order.id);

        if (inProduction || inDriver) {
          issues.safety.archived_in_operational.push({
            order_id: order.id,
            order_number: order.shopify_order_number,
            in_production: inProduction,
            in_driver_portal: inDriver,
          });
        }
      }

      // Check if incomplete order is in operational flow
      if (order.data_quality_status === 'incomplete') {
        const inProduction = (allBatches || []).some(b => 
          b.order_sources?.some(os => os.order_id === order.id)
        );
        const inDriver = (allFulfillmentTasks || []).some(t => t.order_id === order.id);

        if (inProduction || inDriver) {
          issues.safety.incomplete_in_operational.push({
            order_id: order.id,
            order_number: order.shopify_order_number,
            in_production: inProduction,
            in_driver_portal: inDriver,
          });
        }
      }

      // Check if quarantined order is in operational flow
      if (['quarantined', 'needs_review'].includes(order.data_quality_status)) {
        const inProduction = (allBatches || []).some(b => 
          b.order_sources?.some(os => os.order_id === order.id)
        );
        const inDriver = (allFulfillmentTasks || []).some(t => t.order_id === order.id);

        if (inProduction || inDriver) {
          issues.safety.quarantined_in_operational.push({
            order_id: order.id,
            order_number: order.shopify_order_number,
            in_production: inProduction,
            in_driver_portal: inDriver,
          });
        }
      }
    }

    const totalIssues = 
      Object.values(issues.production).reduce((s, v) => s + (Array.isArray(v) ? v.length : 0), 0) +
      Object.values(issues.driver_portal).reduce((s, v) => s + (Array.isArray(v) ? v.length : 0), 0) +
      Object.values(issues.safety).reduce((s, v) => s + (Array.isArray(v) ? v.length : 0), 0);

    return Response.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        total_orders: allOrders?.length || 0,
        total_batches: allBatches?.length || 0,
        total_delivery_tasks: allFulfillmentTasks?.length || 0,
        total_integrity_issues: totalIssues,
        integrity_status: totalIssues === 0 ? 'CLEAN' : 'CRITICAL',
      },
      issues,
    });
  } catch (error) {
    console.error('[INTEGRITY-CHECK]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});