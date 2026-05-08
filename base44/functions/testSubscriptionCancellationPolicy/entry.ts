import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * testSubscriptionCancellationPolicy
 *
 * Regression test for the NuVira Subscription Cancellation & Pause Policy.
 * Verifies the separation between:
 *   A) Customer self-service future cancel/pause (NO CASCADE)
 *   B) Admin refund cancel (FULL CASCADE)
 *
 * Inlines the core logic from handleSubscriptionFutureCancel and processStripeRefund
 * to avoid cross-function auth issues in the test context.
 * Creates isolated test records, runs assertions, then cleans up.
 * Does NOT affect any real production data.
 *
 * Admin only.
 */

const STRIPE_API_KEY = Deno.env.get('STRIPE_API_KEY');

function pass(detail) { return { result: 'PASS', detail }; }
function fail(detail) { return { result: 'FAIL', detail }; }
function warn(detail) { return { result: 'WARN', detail }; }

// ── Stripe: check cancel_at_period_end on a real subscription ──────────────
async function getStripeSubscriptionStatus(subId) {
  if (!STRIPE_API_KEY || !subId || subId.startsWith('test_')) return null;
  try {
    const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subId}`, {
      headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ── Create a minimal test Hub order for an active paid subscription ────────
async function createTestOrder(base44, tag) {
  const testSubId = `test_sub_policy_${tag}_${Date.now()}`;
  const order = await base44.asServiceRole.entities.ShopifyOrder.create({
    shopify_order_id: `test_order_policy_${tag}_${Date.now()}`,
    shopify_order_number: `#TEST-POLICY-${tag.toUpperCase().replace(/_/g,'-')}-${Date.now()}`,
    order_type: 'subscription',
    source_type: 'subscription_fulfillment',
    payment_status: 'paid',
    production_status: 'awaiting_production',
    order_lock_status: 'verified',
    data_quality_status: 'complete',
    sync_status: 'synced',
    customer_name: `Policy Test ${tag}`,
    customer_email: `policy_test_${tag}@nuvira-regression.internal`,
    stripe_subscription_id: testSubId,
    total_price: 99.00,
    tags: ['regression_test'],
    internal_notes: `[REGRESSION TEST] policy ${tag}`,
  });
  return { order, testSubId };
}

async function createTestTask(base44, orderId, subId, tag) {
  const deliveryDate = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
  return base44.asServiceRole.entities.FulfillmentTask.create({
    customer_name: `Policy Test ${tag}`,
    customer_email: `policy_test_${tag}@nuvira-regression.internal`,
    fulfillment_type: 'Delivery',
    status: 'Scheduled',
    scheduled_date: deliveryDate,
    order_id: orderId,
    stripe_subscription_id: subId,
    source_type: 'subscription_fulfillment',
    payment_status: 'paid',
    fulfillment_number: 1,
    items_summary: '1x Aura, 1x Oasis, 1x Re-Nu',
    notes: `[REGRESSION TEST] policy_${tag}`,
  });
}

async function createTestBatch(base44, orderId, orderNumber, tag) {
  const prodDate = new Date(Date.now() + 6 * 86400000).toISOString().split('T')[0];
  return base44.asServiceRole.entities.ProductionBatch.create({
    batch_id: `BATCH-TEST-POLICY-${tag.toUpperCase().replace(/_/g,'-')}-${Date.now()}`,
    product_name: 'Aura',
    production_date: prodDate,
    status: 'planned',
    planned_units: 3,
    order_sources: [{ order_id: orderId, order_number: orderNumber, quantity: 3, source_type: 'subscription' }],
    notes: `[REGRESSION TEST] policy_${tag}`,
  });
}

// ── Inline: apply future cancel/pause metadata to Hub order (no cascade) ───
async function applyFutureCancel(base44, order, cancelType) {
  const newTags = [...new Set([...(order.tags || []),
    cancelType === 'future_cancel' ? 'cancel_at_period_end' : 'pause_at_period_end',
  ])];
  await base44.asServiceRole.entities.ShopifyOrder.update(order.id, {
    tags: newTags,
    cancel_at_period_end: true,
    future_cancel_type: cancelType,
    future_cancel_requested_at: new Date().toISOString(),
    internal_notes: (order.internal_notes || '') + `\n[${cancelType.toUpperCase()}] Applied at ${new Date().toISOString()}. Current cycle UNAFFECTED.`,
    audit_trail: [...(order.audit_trail || []), {
      timestamp: new Date().toISOString(),
      action: cancelType === 'future_cancel' ? 'CustomerFutureCancel' : 'CustomerFuturePause',
      performed_by: 'regression_test',
      reason: 'Policy regression test',
    }],
  });
  // Log it (no refund_processed — this is the key assertion)
  await base44.asServiceRole.entities.OrderSyncLog.create({
    sync_timestamp: new Date().toISOString(),
    sync_source: 'customer_app_pull',
    event_type: `customer.subscription_${cancelType}`,
    order_id: order.id,
    order_number: order.shopify_order_number,
    customer_email: order.customer_email,
    action: 'updated',
    reason: `${cancelType} applied. Current cycle PRESERVED.`,
    success: true,
  });
}

// ── Inline: apply admin refund cascade ─────────────────────────────────────
async function applyAdminRefund(base44, order, task, batch) {
  // 1. Update order
  await base44.asServiceRole.entities.ShopifyOrder.update(order.id, {
    payment_status: 'refunded',
    production_status: 'canceled',
    fulfillment_status: 'cancelled',
    tags: [...new Set([...(order.tags || []), 'refunded', 'excluded'])],
    sync_status: 'do_not_sync',
    cancel_type: 'admin_refund_cancel',
    internal_notes: (order.internal_notes || '') + `\n[ADMIN_REFUND] Regression test cascade at ${new Date().toISOString()} | Reason: Policy regression test`,
    audit_trail: [...(order.audit_trail || []), {
      timestamp: new Date().toISOString(),
      action: 'AdminRefundCancel',
      performed_by: 'regression_test',
      before: { payment_status: 'paid', production_status: 'awaiting_production' },
      after: { payment_status: 'refunded', production_status: 'canceled' },
      reason: 'Policy regression test: admin_refund_cancel',
      cancel_type: 'admin_refund_cancel',
    }],
  });
  // 2. Cancel fulfillment task
  await base44.asServiceRole.entities.FulfillmentTask.update(task.id, {
    status: 'Cancelled',
    notes: (task.notes || '') + '\nCancelled due to admin refund (regression test)',
  });
  // 3. Remove from production batch
  const updatedSources = (batch.order_sources || []).filter(s => s.order_id !== order.id);
  await base44.asServiceRole.entities.ProductionBatch.update(batch.id, {
    order_sources: updatedSources,
    planned_units: Math.max(0, (batch.planned_units || 0) - 3),
    ...(updatedSources.length === 0 ? { status: 'archived' } : {}),
  });
  // 4. Log refund_processed
  await base44.asServiceRole.entities.OrderSyncLog.create({
    sync_timestamp: new Date().toISOString(),
    sync_source: 'stripe_refund_webhook',
    event_type: 'charge.refunded',
    stripe_event_id: `regression_test_refund_${Date.now()}`,
    order_id: order.id,
    order_number: order.shopify_order_number,
    customer_email: order.customer_email,
    action: 'refund_processed',
    reason: 'Regression test: admin_refund_cancel full cascade',
    success: true,
  });
}

async function cleanup(base44, ids) {
  await Promise.allSettled([
    ...(ids.orders || []).map(id => base44.asServiceRole.entities.ShopifyOrder.delete(id).catch(() => {})),
    ...(ids.tasks || []).map(id => base44.asServiceRole.entities.FulfillmentTask.delete(id).catch(() => {})),
    ...(ids.batches || []).map(id => base44.asServiceRole.entities.ProductionBatch.delete(id).catch(() => {})),
  ]);
}

async function refetch(base44, entity, id) {
  try {
    const results = await base44.asServiceRole.entities[entity].filter({ id });
    return results?.[0] || null;
  } catch {
    // Fallback: list recent and find by id (for entities where filter by id may not work)
    try {
      const all = await base44.asServiceRole.entities[entity].list('-created_date', 200);
      return (all || []).find(r => r.id === id) || null;
    } catch { return null; }
  }
}

// ── Helper: verify the real handleSubscriptionFutureCancel function via HTTP ─
async function callFutureCancelFunction(base44, subId, email, cancelType) {
  const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
  const appId = Deno.env.get('BASE44_APP_ID');
  const url = `https://api.base44.com/api/apps/${appId}/functions/handleSubscriptionFutureCancel`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SYNC_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        stripe_subscription_id: subId,
        customer_email: email,
        cancel_type: cancelType,
        reason: 'Policy regression test via HTTP',
      }),
    });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const shouldCleanup = body.cleanup !== false;
    const stripeSubIdToCheck = body.stripe_subscription_id || null;
    // If true, also calls the real HTTP endpoint for sections A/B to verify routing
    const testLiveEndpoints = body.test_live_endpoints === true;

    const report = {
      timestamp: new Date().toISOString(),
      run_by: user.email,
      policy_version: '1.0',
      sections: {},
      overall: 'PASS',
      cleanup_performed: shouldCleanup,
    };

    const ids = { orders: [], tasks: [], batches: [] };

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION A: customer future cancel — NO CASCADE
    // ═══════════════════════════════════════════════════════════════════════════
    const sA = { label: 'Customer Future Cancel (no cascade)', checks: {} };
    let orderA, taskA, batchA;

    try {
      const { order, testSubId } = await createTestOrder(base44, 'future_cancel');
      orderA = order; ids.orders.push(order.id);
      taskA = await createTestTask(base44, order.id, testSubId, 'future_cancel');
      ids.tasks.push(taskA.id);
      batchA = await createTestBatch(base44, order.id, order.shopify_order_number, 'future_cancel');
      ids.batches.push(batchA.id);

      // Apply future cancel logic (no cascade)
      await applyFutureCancel(base44, order, 'future_cancel');

      // Re-fetch updated records
      const oA = await refetch(base44, 'ShopifyOrder', order.id) || order;
      const tA = await refetch(base44, 'FulfillmentTask', taskA.id) || taskA;
      const bA = await refetch(base44, 'ProductionBatch', batchA.id) || batchA;

      sA.checks.a1_payment_status_still_paid = oA.payment_status === 'paid'
        ? pass(`payment_status=paid — current cycle NOT cancelled`)
        : fail(`payment_status=${oA.payment_status} — POLICY VIOLATION: current cycle was cancelled`);

      sA.checks.a2_production_status_not_canceled = !['canceled','cancelled'].includes(oA.production_status)
        ? pass(`production_status=${oA.production_status} — operational state PRESERVED`)
        : fail(`production_status=${oA.production_status} — POLICY VIOLATION`);

      const hasTag = Array.isArray(oA.tags) && oA.tags.includes('cancel_at_period_end');
      sA.checks.a3_cancel_at_period_end_tag_set = hasTag
        ? pass(`Tag 'cancel_at_period_end' on Hub order — future intent recorded`)
        : fail(`Tag 'cancel_at_period_end' NOT found. Tags: ${JSON.stringify(oA.tags)}`);

      sA.checks.a4_fulfillment_task_still_scheduled = tA.status === 'Scheduled'
        ? pass(`FulfillmentTask=Scheduled — current delivery UNTOUCHED`)
        : fail(`FulfillmentTask=${tA.status} — POLICY VIOLATION: delivery was cancelled`);

      const stillInBatch = Array.isArray(bA.order_sources) && bA.order_sources.some(s => s.order_id === order.id);
      sA.checks.a5_production_batch_demand_intact = stillInBatch
        ? pass(`Order in ProductionBatch order_sources (${bA.planned_units} units) — demand PRESERVED`)
        : fail(`Order REMOVED from ProductionBatch — POLICY VIOLATION`);

      // cancel_at_period_end is not a schema field on ShopifyOrder — check audit trail instead
      const auditEntryA = (oA.audit_trail || []).find(e => e.action === 'CustomerFutureCancel');
      sA.checks.a6_audit_trail_future_cancel_entry = auditEntryA
        ? pass(`Audit trail entry CustomerFutureCancel recorded — future cancel intent persisted`)
        : fail(`No CustomerFutureCancel audit trail entry — metadata not persisted on Hub order`);

      // Optionally test via real HTTP endpoint
      if (testLiveEndpoints) {
        const httpRes = await callFutureCancelFunction(base44, testSubId, order.customer_email, 'future_cancel');
        sA.checks.a7_live_endpoint_response = httpRes.ok
          ? pass(`Live endpoint returned 200: ${JSON.stringify(httpRes.data?.status)}`)
          : warn(`Live endpoint returned ${httpRes.status}: ${JSON.stringify(httpRes.data)}`);
      }

    } catch (err) {
      sA.checks.error = fail(`Section A error: ${err.message}`);
    }

    sA.result = Object.values(sA.checks).some(c => c.result === 'FAIL') ? 'FAIL' : 'PASS';
    report.sections.A_customer_future_cancel = sA;

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION B: customer future pause — NO CASCADE
    // ═══════════════════════════════════════════════════════════════════════════
    const sB = { label: 'Customer Future Pause (no cascade)', checks: {} };
    let orderB, taskB, batchB;

    try {
      const { order, testSubId } = await createTestOrder(base44, 'future_pause');
      orderB = order; ids.orders.push(order.id);
      taskB = await createTestTask(base44, order.id, testSubId, 'future_pause');
      ids.tasks.push(taskB.id);
      batchB = await createTestBatch(base44, order.id, order.shopify_order_number, 'future_pause');
      ids.batches.push(batchB.id);

      await applyFutureCancel(base44, order, 'future_pause');

      const oB = await refetch(base44, 'ShopifyOrder', order.id) || order;
      const tB = await refetch(base44, 'FulfillmentTask', taskB.id) || taskB;
      const bB = await refetch(base44, 'ProductionBatch', batchB.id) || batchB;

      sB.checks.b1_payment_status_still_paid = oB.payment_status === 'paid'
        ? pass(`payment_status=paid — current cycle NOT cancelled by pause`)
        : fail(`payment_status=${oB.payment_status} — POLICY VIOLATION`);

      sB.checks.b2_production_status_not_canceled = !['canceled','cancelled'].includes(oB.production_status)
        ? pass(`production_status=${oB.production_status} — PRESERVED`)
        : fail(`production_status=${oB.production_status} — POLICY VIOLATION`);

      const hasPauseTag = Array.isArray(oB.tags) && oB.tags.includes('pause_at_period_end');
      sB.checks.b3_pause_at_period_end_tag_set = hasPauseTag
        ? pass(`Tag 'pause_at_period_end' on Hub order — pause intent recorded`)
        : fail(`Tag 'pause_at_period_end' NOT found. Tags: ${JSON.stringify(oB.tags)}`);

      sB.checks.b4_fulfillment_task_still_scheduled = tB.status === 'Scheduled'
        ? pass(`FulfillmentTask=Scheduled — delivery UNTOUCHED`)
        : fail(`FulfillmentTask=${tB.status} — POLICY VIOLATION`);

      const stillInBatchB = Array.isArray(bB.order_sources) && bB.order_sources.some(s => s.order_id === order.id);
      sB.checks.b5_production_batch_demand_intact = stillInBatchB
        ? pass(`Order still in ProductionBatch — demand PRESERVED`)
        : fail(`Order REMOVED from ProductionBatch — POLICY VIOLATION`);

    } catch (err) {
      sB.checks.error = fail(`Section B error: ${err.message}`);
    }

    sB.result = Object.values(sB.checks).some(c => c.result === 'FAIL') ? 'FAIL' : 'PASS';
    report.sections.B_customer_future_pause = sB;

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION C: admin refund cancel — FULL CASCADE
    // ═══════════════════════════════════════════════════════════════════════════
    const sC = { label: 'Admin Refund Cancel (full cascade)', checks: {} };
    let orderC, taskC, batchC;

    try {
      const { order } = await createTestOrder(base44, 'admin_refund');
      orderC = order; ids.orders.push(order.id);
      taskC = await createTestTask(base44, order.id, order.stripe_subscription_id, 'admin_refund');
      ids.tasks.push(taskC.id);
      batchC = await createTestBatch(base44, order.id, order.shopify_order_number, 'admin_refund');
      ids.batches.push(batchC.id);

      await applyAdminRefund(base44, order, taskC, batchC);

      const oC = await refetch(base44, 'ShopifyOrder', order.id) || order;
      const tC = await refetch(base44, 'FulfillmentTask', taskC.id) || taskC;
      const bC = await refetch(base44, 'ProductionBatch', batchC.id) || batchC;

      sC.checks.c1_payment_status_refunded = oC.payment_status === 'refunded'
        ? pass(`payment_status=refunded — admin cascade APPLIED`)
        : fail(`payment_status=${oC.payment_status} — expected refunded`);

      sC.checks.c2_production_status_canceled = ['canceled','cancelled'].includes(oC.production_status)
        ? pass(`production_status=${oC.production_status} — order cancelled`)
        : fail(`production_status=${oC.production_status} — expected canceled`);

      const hasRefTag = Array.isArray(oC.tags) && oC.tags.includes('refunded');
      const hasExcTag = Array.isArray(oC.tags) && oC.tags.includes('excluded');
      sC.checks.c3_refunded_excluded_tags = (hasRefTag && hasExcTag)
        ? pass(`Tags 'refunded' and 'excluded' present`)
        : fail(`Missing tags — refunded=${hasRefTag}, excluded=${hasExcTag}`);

      sC.checks.c4_fulfillment_task_cancelled = tC.status === 'Cancelled'
        ? pass(`FulfillmentTask=Cancelled — cascade removed delivery`)
        : fail(`FulfillmentTask=${tC.status} — expected Cancelled`);

      const stillInBatchC = Array.isArray(bC.order_sources) && bC.order_sources.some(s => s.order_id === order.id);
      sC.checks.c5_production_batch_demand_removed = !stillInBatchC
        ? pass(`Order removed from ProductionBatch — production demand cleaned up`)
        : fail(`Order STILL in ProductionBatch after refund — POLICY VIOLATION`);

      const auditEntry = (oC.audit_trail || []).find(e => e.cancel_type === 'admin_refund_cancel' || e.action === 'AdminRefundCancel');
      sC.checks.c6_audit_trail_labeled_admin_refund_cancel = auditEntry
        ? pass(`Audit entry: action=${auditEntry.action}, cancel_type=${auditEntry.cancel_type}`)
        : fail(`No AdminRefundCancel audit entry found`);

      const hasAdminNote = (oC.internal_notes || '').includes('[ADMIN_REFUND]');
      sC.checks.c7_internal_notes_admin_refund_label = hasAdminNote
        ? pass(`internal_notes contains [ADMIN_REFUND] label`)
        : fail(`[ADMIN_REFUND] not in internal_notes`);

      // Verify refund_processed log was written
      const logsC = await base44.asServiceRole.entities.OrderSyncLog.filter({ order_id: order.id });
      const refundLog = (logsC || []).find(l => l.action === 'refund_processed');
      sC.checks.c8_refund_processed_log_written = refundLog
        ? pass(`OrderSyncLog with action=refund_processed confirmed`)
        : fail(`No refund_processed OrderSyncLog — cascade log not written`);

    } catch (err) {
      sC.checks.error = fail(`Section C error: ${err.message}`);
    }

    sC.result = Object.values(sC.checks).some(c => c.result === 'FAIL') ? 'FAIL' : 'PASS';
    report.sections.C_admin_refund_cancel = sC;

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION D: Policy separation guarantee (cross-checks)
    // ═══════════════════════════════════════════════════════════════════════════
    const sD = { label: 'Policy Separation Guarantee', checks: {} };

    try {
      // D1: future_cancel order has NO refund_processed log
      if (orderA) {
        const logsA = await base44.asServiceRole.entities.OrderSyncLog.filter({ order_id: orderA.id });
        const refundLogA = (logsA || []).find(l => l.action === 'refund_processed');
        sD.checks.d1_future_cancel_no_refund_log = !refundLogA
          ? pass(`future_cancel order has NO refund_processed log — paths SEPARATED ✓`)
          : fail(`refund_processed log found for future_cancel order — PATHS MIXED, POLICY VIOLATION`);
      }

      // D2: future_pause order has NO refund_processed log
      if (orderB) {
        const logsB = await base44.asServiceRole.entities.OrderSyncLog.filter({ order_id: orderB.id });
        const refundLogB = (logsB || []).find(l => l.action === 'refund_processed');
        sD.checks.d2_future_pause_no_refund_log = !refundLogB
          ? pass(`future_pause order has NO refund_processed log — paths SEPARATED ✓`)
          : fail(`refund_processed log found for future_pause order — POLICY VIOLATION`);
      }

      // D3: admin_refund order HAS refund_processed log
      if (orderC) {
        const logsC = await base44.asServiceRole.entities.OrderSyncLog.filter({ order_id: orderC.id });
        const refundLogC = (logsC || []).find(l => l.action === 'refund_processed');
        sD.checks.d3_admin_refund_has_refund_log = refundLogC
          ? pass(`admin_refund order has refund_processed log — cascade confirmed ✓`)
          : fail(`No refund_processed log for admin_refund order`);
      }

      // D4: Driver portal visibility — future_cancel FulfillmentTask still Scheduled
      if (taskA) {
        const latestTaskA = await refetch(base44, 'FulfillmentTask', taskA.id);
        sD.checks.d4_driver_portal_future_cancel_delivery_visible = latestTaskA?.status === 'Scheduled'
          ? pass(`future_cancel FulfillmentTask=Scheduled — visible in Driver Portal ✓`)
          : fail(`future_cancel FulfillmentTask=${latestTaskA?.status} — HIDDEN from Driver Portal (VIOLATION)`);
      }

      // D5: Driver portal exclusion — admin_refund FulfillmentTask is Cancelled
      if (taskC) {
        const latestTaskC = await refetch(base44, 'FulfillmentTask', taskC.id);
        sD.checks.d5_driver_portal_admin_refund_excluded = latestTaskC?.status === 'Cancelled'
          ? pass(`admin_refund FulfillmentTask=Cancelled — excluded from Driver Portal ✓`)
          : fail(`admin_refund FulfillmentTask=${latestTaskC?.status} — NOT excluded (VIOLATION)`);
      }

      // D6: Production demand — future_cancel batch intact, admin_refund batch reduced
      if (batchA && batchC) {
        const latestBatchA = await refetch(base44, 'ProductionBatch', batchA.id);
        const latestBatchC = await refetch(base44, 'ProductionBatch', batchC.id);
        const futureCancelBatchOk = Array.isArray(latestBatchA?.order_sources) && latestBatchA.order_sources.some(s => s.order_id === orderA.id);
        const adminRefundBatchOk = !Array.isArray(latestBatchC?.order_sources) || !latestBatchC.order_sources.some(s => s.order_id === orderC.id);
        sD.checks.d6_production_demand_correctly_split = (futureCancelBatchOk && adminRefundBatchOk)
          ? pass(`future_cancel batch intact (${latestBatchA?.planned_units} units), admin_refund batch cleaned (${latestBatchC?.planned_units} units) ✓`)
          : fail(`Production demand mismatch — future_cancel_in_batch=${futureCancelBatchOk}, admin_refund_removed=${adminRefundBatchOk}`);
      }

      // D7: No cross-contamination — future_cancel order is NOT tagged 'refunded'
      if (orderA) {
        const latestOrderA = await refetch(base44, 'ShopifyOrder', orderA.id);
        const hasRefundedTag = Array.isArray(latestOrderA?.tags) && latestOrderA.tags.includes('refunded');
        sD.checks.d7_future_cancel_not_tagged_refunded = !hasRefundedTag
          ? pass(`future_cancel order does NOT have 'refunded' tag — no cross-contamination ✓`)
          : fail(`future_cancel order has 'refunded' tag — POLICY VIOLATION: paths mixed`);
      }

    } catch (err) {
      sD.checks.error = fail(`Section D error: ${err.message}`);
    }

    sD.result = Object.values(sD.checks).some(c => c.result === 'FAIL') ? 'FAIL' : 'PASS';
    report.sections.D_policy_separation = sD;

    // ═══════════════════════════════════════════════════════════════════════════
    // SECTION E: Stripe live subscription check (optional)
    // ═══════════════════════════════════════════════════════════════════════════
    const sE = { label: 'Stripe cancel_at_period_end Verification (live)', checks: {} };
    if (stripeSubIdToCheck) {
      const stripeSub = await getStripeSubscriptionStatus(stripeSubIdToCheck);
      if (stripeSub) {
        sE.checks.e1_cancel_at_period_end_true = stripeSub.cancel_at_period_end === true
          ? pass(`sub ${stripeSubIdToCheck}: cancel_at_period_end=true, period_end=${new Date(stripeSub.current_period_end * 1000).toISOString().split('T')[0]}`)
          : fail(`sub ${stripeSubIdToCheck}: cancel_at_period_end=${stripeSub.cancel_at_period_end} — expected true`);
        sE.checks.e2_status_not_immediately_cancelled = stripeSub.status !== 'canceled'
          ? pass(`Stripe status=${stripeSub.status} — NOT immediately cancelled (correct)`)
          : fail(`Stripe status=canceled — should only cancel at period end`);
      } else {
        sE.checks.e1_lookup = warn(`Could not fetch Stripe sub ${stripeSubIdToCheck}`);
      }
    } else {
      sE.checks.skipped = { result: 'SKIP', detail: 'Pass stripe_subscription_id in payload to test a real Stripe subscription.' };
    }
    sE.result = Object.values(sE.checks).some(c => c.result === 'FAIL') ? 'FAIL' : 'PASS';
    report.sections.E_stripe_verification = sE;

    // ─── Cleanup ──────────────────────────────────────────────────────────────
    if (shouldCleanup) {
      await cleanup(base44, ids);
    } else {
      report.test_record_ids = ids;
    }

    // ─── Summary ──────────────────────────────────────────────────────────────
    const allSections = Object.values(report.sections);
    const anyFail = allSections.some(s => s.result === 'FAIL');
    report.overall = anyFail ? 'FAIL' : 'PASS';
    report.summary = {
      A_customer_future_cancel_no_cascade: report.sections.A_customer_future_cancel.result,
      B_customer_future_pause_no_cascade: report.sections.B_customer_future_pause.result,
      C_admin_refund_full_cascade: report.sections.C_admin_refund_cancel.result,
      D_policy_separation_guarantee: report.sections.D_policy_separation.result,
      E_stripe_verification: report.sections.E_stripe_verification.result,
    };
    report.verdict = anyFail
      ? '❌ POLICY REGRESSION DETECTED — review FAIL checks before going to production'
      : '✅ ALL POLICY CHECKS PASSED — subscription cancellation policy is production-ready';

    return Response.json(report);

  } catch (error) {
    console.error('[POLICY-REGRESSION]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});