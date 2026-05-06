/**
 * reconcileAllOperationalRecords
 *
 * Full Hub operational audit + reconciliation function.
 * Scans ALL ShopifyOrder, FulfillmentTask, and ProductionBatch records.
 * Computes a derived operational_state for each order.
 * Applies corrections where status fields are stale or inconsistent.
 * Preserves audit trail on every touched record.
 * Never deletes records or changes payment_status without Stripe evidence.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;

    const now = new Date().toISOString();

    // ── LOAD ALL RECORDS ─────────────────────────────────────────────────────
    const [allOrders, allTasks, allBatches] = await Promise.all([
      base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500),
      base44.asServiceRole.entities.FulfillmentTask.list('-updated_date', 500),
      base44.asServiceRole.entities.ProductionBatch.list('-production_date', 500),
    ]);

    // ── BUILD LOOKUP MAPS ────────────────────────────────────────────────────
    // Tasks by order_id (array, since subscriptions can have multiple)
    const tasksByOrderId = {};
    for (const t of allTasks) {
      if (t.order_id) {
        if (!tasksByOrderId[t.order_id]) tasksByOrderId[t.order_id] = [];
        tasksByOrderId[t.order_id].push(t);
      }
    }

    // Batch order_sources lookup: order_id -> [batch]
    const batchesByOrderId = {};
    for (const b of allBatches) {
      for (const src of (b.order_sources || [])) {
        if (src.order_id) {
          if (!batchesByOrderId[src.order_id]) batchesByOrderId[src.order_id] = [];
          batchesByOrderId[src.order_id].push(b);
        }
      }
    }

    // ── CLASSIFY + RECONCILE EACH ORDER ─────────────────────────────────────
    const report = {
      scanned_orders: 0,
      scanned_tasks: allTasks.length,
      scanned_batches: allBatches.length,
      active_valid: [],
      excluded_refunded_cancelled: [],
      fulfilled_delivered: [],
      missing_address_delivery: [],
      stale_status_corrected: [],
      unchanged: [],
      task_corrections: [],
      batch_corrections: [],
      errors: [],
      order_details: [],
    };

    for (const order of allOrders) {
      report.scanned_orders++;

      const d = order; // entity fields are directly on the object
      const orderNum = d.shopify_order_number || d.id;

      // ── COMPUTE EXCLUSION STATE ──────────────────────────────────────────
      const isRefunded = d.payment_status === 'refunded';
      const isCancelled =
        d.production_status === 'canceled' ||
        d.production_status === 'cancelled' ||
        d.status === 'cancelled' ||
        d.status === 'Cancelled' ||
        d.status === 'canceled';
      const isExcluded =
        Array.isArray(d.tags) && d.tags.includes('excluded');
      const isDoNotRecover = d.do_not_recover === true || d.do_not_sync === true;
      const isQuarantined = d.data_quality_status === 'quarantined';

      const fullyExcluded = isRefunded || isCancelled || isExcluded || isDoNotRecover || isQuarantined;

      // ── COMPUTE DELIVERY STATE ───────────────────────────────────────────
      const isFulfilled =
        d.production_status === 'fulfilled' ||
        d.fulfillment_status === 'fulfilled' ||
        d.status === 'fulfilled' ||
        d.delivered_at != null;

      const hasAddress = !!(d.address_line1 || d.delivery_address);
      const isDelivery = d.fulfillment_method === 'delivery' || d.fulfillment_method == null;

      const missingAddress = !fullyExcluded && !isFulfilled && isDelivery && !hasAddress;

      // ── DERIVE OPERATIONAL STATE ─────────────────────────────────────────
      let operationalState;
      if (fullyExcluded) {
        operationalState = 'excluded_refunded_cancelled';
      } else if (isFulfilled) {
        operationalState = 'fulfilled_delivered';
      } else if (missingAddress) {
        operationalState = 'needs_address';
      } else if (d.payment_status === 'paid') {
        const ps = d.production_status || '';
        if (ps === 'awaiting_production' || ps === 'new' || ps === '') {
          operationalState = 'awaiting_production';
        } else if (['in_production', 'bottled', 'labeled', 'qc_checked', 'packed', 'in_cold_storage'].includes(ps)) {
          operationalState = 'in_production';
        } else if (['assigned_for_pickup', 'assigned_for_delivery'].includes(ps)) {
          operationalState = 'ready_for_delivery';
        } else if (ps === 'scheduled_for_production') {
          operationalState = 'awaiting_production';
        } else {
          operationalState = 'active_unknown_status';
        }
      } else {
        // payment not paid, not excluded, not fulfilled
        operationalState = 'pending_payment';
      }

      // ── CHECK FOR STALE STATUS TO CORRECT ───────────────────────────────
      const corrections = {};
      let needsCorrection = false;

      // If excluded but production_status shows active — stale, should be canceled
      if (fullyExcluded && !['canceled', 'cancelled', 'refunded', 'fulfilled'].includes(d.production_status || '')) {
        corrections.production_status = 'canceled';
        needsCorrection = true;
      }

      // If fully excluded but order_lock_status is active — should be fulfilled (locked)
      if (fullyExcluded && !['fulfilled'].includes(d.order_lock_status || '')) {
        // Don't force lock status changes — log only
      }

      // If fulfilled (delivered_at set, FulfillmentTask Completed) but production_status ≠ fulfilled
      if (!fullyExcluded && isFulfilled && d.production_status !== 'fulfilled') {
        const relatedTasks = tasksByOrderId[order.id] || [];
        const allCompleted = relatedTasks.length > 0 && relatedTasks.every(t => t.status === 'Completed');
        if (allCompleted || d.delivered_at) {
          corrections.production_status = 'fulfilled';
          needsCorrection = true;
        }
      }

      const detail = {
        order_number: orderNum,
        id: order.id,
        customer: d.customer_name || d.customer_email,
        payment_status: d.payment_status,
        production_status: d.production_status,
        operational_state: operationalState,
        has_address: hasAddress,
        corrections_applied: needsCorrection ? corrections : null,
        dry_run: dryRun,
      };

      // Apply corrections
      if (needsCorrection && !dryRun) {
        try {
          const auditEntry = {
            timestamp: now,
            action: 'ReconcileAllOperationalRecords',
            performed_by: user.email,
            before: Object.fromEntries(Object.keys(corrections).map(k => [k, d[k]])),
            after: corrections,
            reason: `Automated reconciliation — operational_state=${operationalState}`,
          };

          const existingTrail = Array.isArray(d.audit_trail) ? d.audit_trail : [];
          await base44.asServiceRole.entities.ShopifyOrder.update(order.id, {
            ...corrections,
            audit_trail: [...existingTrail, auditEntry],
          });
          report.stale_status_corrected.push({ order_number: orderNum, ...corrections });
          detail.status = 'corrected';
        } catch (err) {
          report.errors.push({ order_number: orderNum, error: err.message });
          detail.status = 'error';
        }
      } else if (needsCorrection && dryRun) {
        report.stale_status_corrected.push({ order_number: orderNum, ...corrections, dry_run: true });
        detail.status = 'would_correct';
      } else {
        report.unchanged.push(orderNum);
        detail.status = 'ok';
      }

      // Bucket
      if (operationalState === 'excluded_refunded_cancelled') {
        report.excluded_refunded_cancelled.push(orderNum);
      } else if (operationalState === 'fulfilled_delivered') {
        report.fulfilled_delivered.push(orderNum);
      } else if (operationalState === 'needs_address') {
        report.missing_address_delivery.push(orderNum);
      } else {
        report.active_valid.push(orderNum);
      }

      report.order_details.push(detail);
    }

    // ── AUDIT FULFILLMENT TASKS ──────────────────────────────────────────────
    const excludedOrderIds = new Set(
      allOrders
        .filter(o => {
          const d = o;
          return (
            d.payment_status === 'refunded' ||
            d.production_status === 'canceled' ||
            d.production_status === 'cancelled' ||
            (Array.isArray(d.tags) && d.tags.includes('excluded')) ||
            d.do_not_recover === true ||
            d.data_quality_status === 'quarantined'
          );
        })
        .map(o => o.id)
    );

    for (const task of allTasks) {
      if (!task.order_id) continue;
      if (!excludedOrderIds.has(task.order_id)) continue;
      if (task.status === 'Cancelled' || task.status === 'Completed') continue;

      // Task is active but linked to excluded/refunded order — should be cancelled
      report.task_corrections.push({
        task_id: task.id,
        customer_name: task.customer_name,
        scheduled_date: task.scheduled_date,
        current_status: task.status,
        correction: 'Cancelled',
        reason: 'Linked order is excluded/refunded',
        dry_run: dryRun,
      });

      if (!dryRun) {
        try {
          await base44.asServiceRole.entities.FulfillmentTask.update(task.id, {
            status: 'Cancelled',
            notes: (task.notes || '') + ` | AUTO-RECONCILE-${now.slice(0, 10)}: Linked order is excluded/refunded.`,
          });
        } catch (err) {
          report.errors.push({ task_id: task.id, error: err.message });
        }
      }
    }

    // ── AUDIT PRODUCTION BATCHES ─────────────────────────────────────────────
    for (const batch of allBatches) {
      if (batch.status === 'archived') continue;
      const sources = batch.order_sources || [];
      const invalidSources = sources.filter(s => s.order_id && excludedOrderIds.has(s.order_id));

      if (invalidSources.length === 0) continue;

      report.batch_corrections.push({
        batch_id: batch.batch_id,
        production_date: batch.production_date,
        invalid_sources: invalidSources.map(s => s.order_number),
        current_planned_units: batch.planned_units,
        dry_run: dryRun,
      });

      // We log but do NOT auto-modify batches — recalculate handles this
    }

    // ── SUMMARY ─────────────────────────────────────────────────────────────
    const summary = {
      total_scanned_orders: report.scanned_orders,
      total_scanned_tasks: report.scanned_tasks,
      total_scanned_batches: report.scanned_batches,
      total_active_valid: report.active_valid.length,
      total_excluded_refunded_cancelled: report.excluded_refunded_cancelled.length,
      total_fulfilled_delivered: report.fulfilled_delivered.length,
      total_missing_address_delivery: report.missing_address_delivery.length,
      total_stale_status_corrected: report.stale_status_corrected.length,
      total_tasks_to_cancel: report.task_corrections.length,
      total_batch_corrections_flagged: report.batch_corrections.length,
      total_unchanged: report.unchanged.length,
      dry_run: dryRun,
    };

    return Response.json({
      success: true,
      summary,
      active_valid_orders: report.active_valid,
      excluded_orders: report.excluded_refunded_cancelled,
      fulfilled_orders: report.fulfilled_delivered,
      missing_address_orders: report.missing_address_delivery,
      stale_corrections: report.stale_status_corrected,
      task_corrections: report.task_corrections,
      batch_corrections_flagged: report.batch_corrections,
      order_details: report.order_details,
      errors: report.errors,
    });

  } catch (error) {
    console.error('[RECONCILE-ALL]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});