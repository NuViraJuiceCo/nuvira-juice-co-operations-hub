/**
 * reconcileRealtimeOperationalState
 *
 * Derives each order's true operational_state from the actual related records
 * (payment_status, tags, ProductionBatch state, FulfillmentTask state, address, manual_override)
 * and corrects downstream records when they are stale.
 *
 * Safe to run frequently. Supports dry_run=true (report only) and dry_run=false (apply corrections).
 * Never changes payment_status without Stripe evidence.
 * Never activates refunded/canceled/excluded orders.
 * Never deletes audit history.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── Exclusion checks ─────────────────────────────────────────────────────────
function isExcluded(order) {
  if (!order) return false;
  if (order.payment_status === 'refunded') return true;
  if (order.production_status === 'canceled' || order.production_status === 'cancelled') return true;
  if (order.data_quality_status === 'quarantined') return true;
  if (Array.isArray(order.tags) && order.tags.includes('excluded')) return true;
  if (order.do_not_recover === true) return true;
  return false;
}

function isFulfilled(order) {
  return (
    order.production_status === 'fulfilled' ||
    order.fulfillment_status === 'fulfilled' ||
    order.delivered_at != null
  );
}

// ── Derive operational_state from actual record state ────────────────────────
function deriveOperationalState(order, relatedBatches, relatedTasks) {
  if (isExcluded(order)) return 'excluded';
  if (isFulfilled(order)) return 'fulfilled';

  const isPaid = order.payment_status === 'paid' || order.payment_status === 'captured';
  if (!isPaid) return 'pending_payment';

  const isDelivery = !order.fulfillment_method || order.fulfillment_method === 'delivery';
  const hasAddress = !!(order.address_line1 || (order.fulfillments?.[0]?.address_line1));
  if (isDelivery && !hasAddress) return 'needs_address';

  // Check FulfillmentTask state
  const activeTasks = relatedTasks.filter(t => {
    const s = (t.status || '').toLowerCase();
    return !['cancelled', 'canceled', 'completed', 'delivered'].includes(s);
  });
  const completedTasks = relatedTasks.filter(t => {
    const s = (t.status || '').toLowerCase();
    return ['completed', 'delivered'].includes(s);
  });

  if (completedTasks.length > 0 && activeTasks.length === 0) return 'fulfilled';

  // Check production batch state
  const batchStatuses = relatedBatches.map(b => b.status);
  const allVerified = batchStatuses.length > 0 && batchStatuses.every(s => ['verified_logged', 'archived'].includes(s));
  const anyInProd = batchStatuses.some(s => ['in_production', 'completed_pending_verification'].includes(s));

  if (allVerified) return 'production_completed';
  if (anyInProd) return 'in_production';
  if (batchStatuses.length > 0) return 'awaiting_production';

  // Fallback to production_status field
  const ps = order.production_status || '';
  if (['assigned_for_delivery', 'out_for_delivery'].includes(ps)) return 'ready_for_delivery';
  if (['in_production', 'bottled', 'labeled', 'qc_checked', 'packed', 'in_cold_storage'].includes(ps)) return 'in_production';
  if (['awaiting_production', 'scheduled_for_production'].includes(ps)) return 'awaiting_production';

  return 'awaiting_production';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false; // default to dry_run=true for safety
    const now = new Date().toISOString();

    console.log(`[RECONCILE-RT] Starting reconciliation. dry_run=${dryRun}`);

    // ── Load all records ─────────────────────────────────────────────────────
    const [allOrders, allTasks, allBatches] = await Promise.all([
      base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500),
      base44.asServiceRole.entities.FulfillmentTask.list('-updated_date', 500),
      base44.asServiceRole.entities.ProductionBatch.list('-production_date', 500),
    ]);

    // ── Build lookup indexes ─────────────────────────────────────────────────
    // Tasks by order_id
    const tasksByOrderId = {};
    for (const t of allTasks) {
      if (!t.order_id) continue;
      if (!tasksByOrderId[t.order_id]) tasksByOrderId[t.order_id] = [];
      tasksByOrderId[t.order_id].push(t);
    }

    // Batches by order_id (via order_sources)
    const batchesByOrderId = {};
    for (const b of allBatches) {
      for (const src of (b.order_sources || [])) {
        if (!src.order_id) continue;
        if (!batchesByOrderId[src.order_id]) batchesByOrderId[src.order_id] = [];
        batchesByOrderId[src.order_id].push(b);
      }
    }

    // Deduplicate orders
    const seenIds = new Set();
    const uniqueOrders = allOrders.filter(o => {
      if (seenIds.has(o.id)) return false;
      seenIds.add(o.id);
      return true;
    });

    // ── Results containers ───────────────────────────────────────────────────
    const mismatches = [];
    const corrections = [];
    const taskCancellations = [];
    const errors = [];

    // ── Pass 1: Audit every order ────────────────────────────────────────────
    for (const order of uniqueOrders) {
      const relatedTasks = tasksByOrderId[order.id] || [];
      const relatedBatches = batchesByOrderId[order.id] || [];
      const derivedState = deriveOperationalState(order, relatedBatches, relatedTasks);

      const currentPS = order.production_status || '';
      const orderExcluded = isExcluded(order);

      // ── Check 1: Excluded orders with active production_status ─────────────
      if (orderExcluded && !['canceled', 'cancelled', 'refunded', 'fulfilled'].includes(currentPS)) {
        const mismatch = {
          order_id: order.id,
          order_number: order.shopify_order_number,
          issue: 'excluded_order_has_active_production_status',
          current_production_status: currentPS,
          correction: { production_status: 'canceled' },
        };
        mismatches.push(mismatch);
        if (!dryRun) {
          try {
            const trail = Array.isArray(order.audit_trail) ? order.audit_trail : [];
            await base44.asServiceRole.entities.ShopifyOrder.update(order.id, {
              production_status: 'canceled',
              audit_trail: [...trail, {
                timestamp: now, action: 'ReconcileRealtimeOperationalState',
                performed_by: user.email,
                before: { production_status: currentPS },
                after: { production_status: 'canceled' },
                reason: `Automated reconciliation — derived_state=${derivedState}`,
              }],
            });
            corrections.push({ ...mismatch, applied: true });
          } catch (err) {
            errors.push({ order_id: order.id, error: err.message });
          }
        } else {
          corrections.push({ ...mismatch, applied: false, dry_run: true });
        }
      }

      // ── Check 2: Awaiting production but all batches verified ──────────────
      if (!orderExcluded && ['awaiting_production', 'new', 'in_production'].includes(currentPS)) {
        const allVerified = relatedBatches.length > 0 &&
          relatedBatches.every(b => ['verified_logged', 'archived'].includes(b.status));
        if (allVerified && derivedState === 'production_completed') {
          const mismatch = {
            order_id: order.id,
            order_number: order.shopify_order_number,
            issue: 'order_stuck_awaiting_production_but_all_batches_verified',
            current_production_status: currentPS,
            derived_state: derivedState,
            correction: { production_status: 'packed' },
          };
          mismatches.push(mismatch);
          if (!dryRun && !order.manual_override) {
            try {
              const trail = Array.isArray(order.audit_trail) ? order.audit_trail : [];
              await base44.asServiceRole.entities.ShopifyOrder.update(order.id, {
                production_status: 'packed',
                audit_trail: [...trail, {
                  timestamp: now, action: 'ReconcileRealtimeOperationalState',
                  performed_by: user.email,
                  before: { production_status: currentPS },
                  after: { production_status: 'packed' },
                  reason: 'All related batches are verified_logged — advancing status to packed',
                }],
              });
              corrections.push({ ...mismatch, applied: true });
            } catch (err) {
              errors.push({ order_id: order.id, error: err.message });
            }
          } else {
            corrections.push({ ...mismatch, applied: false, dry_run: dryRun, manual_override_skipped: order.manual_override });
          }
        }
      }

      // ── Check 3: Fulfilled/delivered task but order still active ──────────
      if (!orderExcluded) {
        const allDelivered = relatedTasks.length > 0 &&
          relatedTasks.every(t => ['completed', 'delivered', 'Completed'].includes(t.status));
        if (allDelivered && !isFulfilled(order)) {
          const mismatch = {
            order_id: order.id,
            order_number: order.shopify_order_number,
            issue: 'all_tasks_delivered_but_order_not_fulfilled',
            current_production_status: currentPS,
            correction: { production_status: 'fulfilled' },
          };
          mismatches.push(mismatch);
          if (!dryRun && !order.manual_override) {
            try {
              const trail = Array.isArray(order.audit_trail) ? order.audit_trail : [];
              await base44.asServiceRole.entities.ShopifyOrder.update(order.id, {
                production_status: 'fulfilled',
                fulfillment_status: 'fulfilled',
                audit_trail: [...trail, {
                  timestamp: now, action: 'ReconcileRealtimeOperationalState',
                  performed_by: user.email,
                  before: { production_status: currentPS },
                  after: { production_status: 'fulfilled' },
                  reason: 'All FulfillmentTasks are Completed/Delivered — marking order fulfilled',
                }],
              });
              corrections.push({ ...mismatch, applied: true });
            } catch (err) {
              errors.push({ order_id: order.id, error: err.message });
            }
          } else {
            corrections.push({ ...mismatch, applied: false, dry_run: dryRun, manual_override_skipped: order.manual_override });
          }
        }
      }
    }

    // ── Pass 2: Audit every FulfillmentTask ──────────────────────────────────
    const orderById = {};
    for (const o of uniqueOrders) orderById[o.id] = o;

    for (const task of allTasks) {
      if (!task.order_id) continue;
      const currentStatus = task.status || '';
      if (['Cancelled', 'Canceled', 'cancelled', 'canceled', 'Completed', 'delivered'].includes(currentStatus)) continue;

      const linkedOrder = orderById[task.order_id];
      if (!linkedOrder) {
        mismatches.push({
          task_id: task.id,
          customer_name: task.customer_name,
          scheduled_date: task.scheduled_date,
          issue: 'task_linked_to_missing_order',
          order_id: task.order_id,
        });
        continue;
      }

      if (isExcluded(linkedOrder)) {
        const mismatch = {
          task_id: task.id,
          customer_name: task.customer_name,
          scheduled_date: task.scheduled_date,
          order_number: linkedOrder.shopify_order_number,
          issue: 'active_task_linked_to_excluded_refunded_canceled_order',
          current_task_status: currentStatus,
          correction: { status: 'Cancelled' },
        };
        mismatches.push(mismatch);
        taskCancellations.push(mismatch);
        if (!dryRun) {
          try {
            await base44.asServiceRole.entities.FulfillmentTask.update(task.id, {
              status: 'Cancelled',
            });
            mismatch.applied = true;
            corrections.push(mismatch);
          } catch (err) {
            errors.push({ task_id: task.id, error: err.message });
          }
        } else {
          mismatch.applied = false;
          mismatch.dry_run = true;
          corrections.push(mismatch);
        }
      }
    }

    // ── Summary ──────────────────────────────────────────────────────────────
    const summary = {
      dry_run: dryRun,
      orders_scanned: uniqueOrders.length,
      tasks_scanned: allTasks.length,
      batches_scanned: allBatches.length,
      total_mismatches: mismatches.length,
      total_corrections: corrections.length,
      task_cancellations: taskCancellations.length,
      errors: errors.length,
    };

    console.log(`[RECONCILE-RT] Done. mismatches=${mismatches.length}, corrections=${corrections.length}, errors=${errors.length}`);

    return Response.json({
      success: true,
      summary,
      mismatches,
      corrections,
      task_cancellations: taskCancellations,
      errors,
    });

  } catch (error) {
    console.error('[RECONCILE-RT] Fatal error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});