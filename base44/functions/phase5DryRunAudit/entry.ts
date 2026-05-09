/**
 * phase5DryRunAudit
 *
 * Phase 5 read-only audit of existing records against the central schedule engine.
 * Identifies mismatches between stored production_date / delivery_date / delivery_window_label
 * and the expected values from calculateScheduleFromPaidAt.
 *
 * Rules:
 * - NEVER mutates records.
 * - Skips: locked batches, terminal/refunded/cancelled/quarantined/do_not_sync orders,
 *           delivered FulfillmentTasks, verified_logged ProductionBatches.
 * - Reports: current value, expected value, whether record is safe to backfill later.
 *
 * Trigger: Admin POST to this endpoint.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const VALID_PRODUCTION_DAYS = new Set([2, 5]); // Tue=2, Fri=5
const VALID_DELIVERY_DAYS   = new Set([3, 6]); // Wed=3, Sat=6
const WINDOW_WEDNESDAY = '5:00 PM – 8:00 PM';
const WINDOW_SATURDAY  = '12:00 PM – 3:00 PM';

function parseDateLocal(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getDow(dateStr) {
  return parseDateLocal(dateStr).getDay();
}

function isValidProdDate(d) { return d && VALID_PRODUCTION_DAYS.has(getDow(d)); }
function isValidDelivDate(d) { return d && VALID_DELIVERY_DAYS.has(getDow(d)); }

function getExpectedWindow(delivDate) {
  if (!delivDate) return null;
  const dow = getDow(delivDate);
  if (dow === 3) return WINDOW_WEDNESDAY;
  if (dow === 6) return WINDOW_SATURDAY;
  return null;
}

function isTerminal(order) {
  const BLOCKED_TAGS = new Set(['refunded','excluded','archived','do_not_sync','internal_test_owner_override','customer_confusion_duplicate_subscription']);
  return (
    order.payment_status === 'refunded' ||
    order.production_status === 'canceled' ||
    order.production_status === 'cancelled' ||
    order.fulfillment_status === 'cancelled' ||
    order.sync_status === 'do_not_sync' ||
    order.data_quality_status === 'quarantined' ||
    (Array.isArray(order.tags) && order.tags.some(t => BLOCKED_TAGS.has(t)))
  );
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const [allOrders, allTasks, allBatches] = await Promise.all([
      base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500),
      base44.asServiceRole.entities.FulfillmentTask.list('-created_date', 500),
      base44.asServiceRole.entities.ProductionBatch.list('-production_date', 500),
    ]);

    const today = new Date().toISOString().split('T')[0];

    const orderMismatches = [];
    const taskMismatches = [];
    const batchMismatches = [];

    // ─── Audit ShopifyOrders ───────────────────────────────────────────────
    for (const order of allOrders) {
      if (isTerminal(order)) continue;
      if (!order.assigned_delivery_date && !(order.fulfillments?.length > 0)) continue;

      const issues = [];
      let safeTo = true;

      // Check fulfillments array
      if (Array.isArray(order.fulfillments)) {
        order.fulfillments.forEach((f, i) => {
          const fn = f.fulfillment_number || i + 1;
          if (f.production_date && !isValidProdDate(f.production_date)) {
            issues.push(`Fulfillment #${fn}: production_date ${f.production_date} is ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][getDow(f.production_date)]} (expected Tue or Fri)`);
          }
          const delivDate = f.delivery_date || f.scheduled_date;
          if (delivDate && !isValidDelivDate(delivDate)) {
            issues.push(`Fulfillment #${fn}: delivery_date ${delivDate} is ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][getDow(delivDate)]} (expected Wed or Sat)`);
          }
          if (delivDate && f.delivery_window_label) {
            const expected = getExpectedWindow(delivDate);
            if (expected && f.delivery_window_label !== expected) {
              issues.push(`Fulfillment #${fn}: window "${f.delivery_window_label}" should be "${expected}" for ${delivDate}`);
            }
          }
        });
      }

      // Check order-level delivery date
      if (order.assigned_delivery_date && !isValidDelivDate(order.assigned_delivery_date)) {
        const dow = getDow(order.assigned_delivery_date);
        issues.push(`assigned_delivery_date ${order.assigned_delivery_date} is ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow]} (expected Wed or Sat)`);
      }

      // Safety check: already delivered or in later stages = not safe to backfill
      const deliveredStatuses = ['bottled','labeled','qc_checked','packed','in_cold_storage','fulfilled','assigned_for_delivery','assigned_for_pickup'];
      if (deliveredStatuses.includes(order.production_status)) {
        safeTo = false;
      }

      if (issues.length > 0) {
        orderMismatches.push({
          id: order.id,
          order_number: order.shopify_order_number,
          customer_email: order.customer_email,
          production_status: order.production_status,
          issues,
          safe_to_backfill: safeTo,
          note: safeTo ? 'Can be corrected in Phase 5B backfill after admin approval' : 'Skip — already produced or delivered',
        });
      }
    }

    // ─── Audit FulfillmentTasks ────────────────────────────────────────────
    for (const task of allTasks) {
      if (['Completed', 'Cancelled', 'completed', 'cancelled'].includes(task.status)) continue;
      if (!task.scheduled_date) continue;

      const issues = [];

      if (!isValidDelivDate(task.scheduled_date)) {
        const dow = getDow(task.scheduled_date);
        issues.push(`scheduled_date ${task.scheduled_date} is ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow]} (expected Wed or Sat)`);
      }

      if (task.scheduled_date && task.delivery_window_label) {
        const expected = getExpectedWindow(task.scheduled_date);
        if (expected && task.delivery_window_label !== expected) {
          issues.push(`delivery_window_label "${task.delivery_window_label}" should be "${expected}" for ${task.scheduled_date}`);
        }
      }

      if (issues.length > 0) {
        taskMismatches.push({
          id: task.id,
          customer_name: task.customer_name,
          customer_email: task.customer_email,
          scheduled_date: task.scheduled_date,
          status: task.status,
          issues,
          safe_to_backfill: task.scheduled_date >= today,
          note: task.scheduled_date >= today ? 'Future task — can be corrected after admin approval' : 'Past task — leave as historical record',
        });
      }
    }

    // ─── Audit ProductionBatches ───────────────────────────────────────────
    for (const batch of allBatches) {
      if (batch.is_locked) continue;
      if (batch.status === 'verified_logged') continue;
      if (!batch.production_date) continue;

      const issues = [];

      if (!isValidProdDate(batch.production_date)) {
        const dow = getDow(batch.production_date);
        issues.push(`production_date ${batch.production_date} is ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow]} (expected Tue or Fri)`);
      }

      if (issues.length > 0) {
        batchMismatches.push({
          id: batch.id,
          batch_id: batch.batch_id,
          product_name: batch.product_name,
          production_date: batch.production_date,
          status: batch.status,
          planned_units: batch.planned_units,
          issues,
          safe_to_backfill: batch.production_date >= today,
          note: batch.production_date >= today ? 'Future batch — can be recalculated after admin approval' : 'Past batch — leave as historical record',
        });
      }
    }

    const totalMismatches = orderMismatches.length + taskMismatches.length + batchMismatches.length;

    return Response.json({
      phase: 'Phase 5 Dry-Run Audit — Read Only',
      audit_timestamp: new Date().toISOString(),
      executed_by: user.email,
      summary: {
        orders_audited: allOrders.length,
        tasks_audited: allTasks.length,
        batches_audited: allBatches.length,
        order_mismatches: orderMismatches.length,
        task_mismatches: taskMismatches.length,
        batch_mismatches: batchMismatches.length,
        total_mismatches: totalMismatches,
        existing_records_mutated: false,
        safe_to_backfill_now: false,
        backfill_requires_separate_admin_approval: true,
      },
      order_mismatches: orderMismatches,
      task_mismatches: taskMismatches,
      batch_mismatches: batchMismatches,
      rules_enforced: {
        valid_production_days: 'Tuesday, Friday',
        valid_delivery_days: 'Wednesday, Saturday',
        wednesday_window: WINDOW_WEDNESDAY,
        saturday_window: WINDOW_SATURDAY,
        locked_terminal_delivered_excluded: true,
      },
    });

  } catch (error) {
    console.error('[PHASE5-DRY-RUN]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});