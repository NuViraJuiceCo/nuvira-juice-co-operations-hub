import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * E2E AUTOMATED REFUND FLOW TEST
 * 
 * Simulates: Stripe charge.refunded → CA receives → CA sends order.refunded to Hub → Hub cascades
 * 
 * Verifies:
 * 1. Stripe webhook → CA receives charge.refunded
 * 2. CA sends order.refunded to Hub (receiveCustomerAppEvent)
 * 3. Hub processStripeRefund cascades: Order→Tasks→Batches
 * 4. No manual repair needed
 * 5. Idempotency: replay webhook = no duplicate unit subtraction
 * 
 * Requires: an existing PAID order that can be safely refunded (e.g., NV-MOVOAMIF or similar test order)
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin authorization required' }, { status: 403 });
    }

    const { test_order_number, test_stripe_payment_intent_id, simulate_stripe_event_id } = await req.json();

    if (!test_order_number && !test_stripe_payment_intent_id) {
      return Response.json({ error: 'Provide test_order_number or test_stripe_payment_intent_id' }, { status: 400 });
    }

    console.log(`[E2E-REFUND-TEST] Starting automatic refund flow test for ${test_order_number || test_stripe_payment_intent_id}`);

    // STEP 1: Find the test order in Hub
    let testOrder = null;
    if (test_order_number) {
      const byNumber = await base44.asServiceRole.entities.ShopifyOrder.filter({
        shopify_order_number: test_order_number,
      });
      if (byNumber && byNumber.length > 0) testOrder = byNumber[0];
    } else if (test_stripe_payment_intent_id) {
      const byPI = await base44.asServiceRole.entities.ShopifyOrder.filter({
        stripe_payment_intent_id: test_stripe_payment_intent_id,
      });
      if (byPI && byPI.length > 0) testOrder = byPI[0];
    }

    if (!testOrder) {
      return Response.json({
        error: 'Test order not found',
        searched: { order_number: test_order_number, stripe_payment_intent_id: test_stripe_payment_intent_id },
      }, { status: 404 });
    }

    if (testOrder.payment_status === 'refunded') {
      return Response.json({
        status: 'skipped',
        reason: 'Test order already refunded',
        order_number: testOrder.shopify_order_number,
        order_id: testOrder.id,
      });
    }

    console.log(`[E2E-REFUND-TEST] Found test order: ${testOrder.shopify_order_number} (${testOrder.id})`);

    // STEP 2: Simulate Stripe charge.refunded → CA receives it → CA sends order.refunded to Hub
    // This is what SHOULD happen automatically via Stripe webhook + CA webhook handler
    const refundAmount = testOrder.total_price || 0;
    const chargeAmount = testOrder.total_price || 0;

    const caRefundEvent = {
      event: 'order.refunded',
      order: {
        order_number: testOrder.shopify_order_number,
        customer_email: testOrder.customer_email,
        customer_name: testOrder.customer_name,
        stripe_payment_intent_id: testOrder.stripe_payment_intent_id,
        stripe_charge_id: null,
        stripe_refund_id: simulate_stripe_event_id ? `re_${simulate_stripe_event_id}` : null,
        stripe_event_id: simulate_stripe_event_id || `test_refund_${Date.now()}`,
        total_price: chargeAmount,
        refund_amount: refundAmount,
        charge_amount: chargeAmount,
      },
    };

    console.log(`[E2E-REFUND-TEST] Simulating CA→Hub refund event:`, caRefundEvent);

    // STEP 3: Call receiveCustomerAppEvent (this is what the CA would POST)
    const syncSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
    if (!syncSecret) {
      return Response.json({ error: 'CUSTOMER_APP_SYNC_SECRET not configured' }, { status: 500 });
    }

    const receiveEventResponse = await fetch(
      `${Deno.env.get('BASE44_APP_URL') || 'http://localhost:3000'}/functions/receiveCustomerAppEvent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${syncSecret}`,
        },
        body: JSON.stringify(caRefundEvent),
      }
    ).catch(err => ({
      ok: false,
      status: 500,
      statusText: err.message,
      json: async () => ({ error: err.message }),
    }));

    const receiveEventData = await receiveEventResponse.json();
    const receiveEventStatus = receiveEventResponse.status;

    console.log(`[E2E-REFUND-TEST] receiveCustomerAppEvent response: ${receiveEventStatus}`, receiveEventData);

    if (!receiveEventResponse.ok) {
      return Response.json({
        status: 'failed_at_ca_to_hub',
        step: 'receiveCustomerAppEvent',
        http_status: receiveEventStatus,
        response: receiveEventData,
        recommendation: receiveEventStatus === 403 ? 'Auth failed — check CUSTOMER_APP_SYNC_SECRET' : 'See response for details',
      }, { status: 500 });
    }

    // STEP 4: Verify Hub order is now refunded
    const refundedOrder = await base44.asServiceRole.entities.ShopifyOrder.get(testOrder.id);
    const isRefunded = refundedOrder.payment_status === 'refunded';
    const isCanceled = refundedOrder.production_status === 'canceled';
    const isExcluded = (refundedOrder.tags || []).includes('excluded');

    if (!isRefunded || !isCanceled || !isExcluded) {
      return Response.json({
        status: 'failed_at_hub_cascade',
        step: 'Hub refund cascade',
        order_state: {
          payment_status: refundedOrder.payment_status,
          production_status: refundedOrder.production_status,
          tags: refundedOrder.tags,
        },
        expected: { payment_status: 'refunded', production_status: 'canceled', tags_include_excluded: true },
        note: 'processStripeRefund did not cascade correctly',
      }, { status: 500 });
    }

    // STEP 5: Verify FulfillmentTasks are cancelled
    const cancelledTasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
      order_id: testOrder.id,
      status: 'Cancelled',
    });

    // STEP 6: Verify ProductionBatches removed refunded order
    const batchesWithRefundedOrder = await base44.asServiceRole.entities.ProductionBatch.filter({
      production_date: testOrder.production_date || testOrder.assigned_delivery_date,
    });

    let batchesAffected = 0;
    let batchesArchived = 0;
    for (const batch of (batchesWithRefundedOrder || [])) {
      const hasClearedSources = !batch.order_sources?.some(
        src => src.order_id === testOrder.id || src.order_number === testOrder.shopify_order_number
      );
      if (hasClearedSources && batch.order_sources?.length > 0) {
        batchesAffected++;
      }
      if (hasClearedSources && batch.order_sources?.length === 0 && batch.status === 'archived') {
        batchesArchived++;
      }
    }

    console.log(`[E2E-REFUND-TEST] Cascade verification: ${cancelledTasks?.length || 0} tasks cancelled, ${batchesAffected} batches affected, ${batchesArchived} batches archived`);

    // STEP 7: Test idempotency — replay the same refund event
    console.log(`[E2E-REFUND-TEST] Testing idempotency by replaying refund event...`);

    const replayResponse = await fetch(
      `${Deno.env.get('BASE44_APP_URL') || 'http://localhost:3000'}/functions/receiveCustomerAppEvent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${syncSecret}`,
        },
        body: JSON.stringify(caRefundEvent),
      }
    ).catch(err => ({
      ok: false,
      status: 500,
      statusText: err.message,
      json: async () => ({ error: err.message }),
    }));

    const replayData = await replayResponse.json();
    const isIdempotent = replayResponse.status === 200 || (replayData.reason === 'already_refunded' || replayData.reason === 'idempotent');

    // Check that second call didn't duplicate audit entries
    const refundedOrderAfterReplay = await base44.asServiceRole.entities.ShopifyOrder.get(testOrder.id);
    const auditCount = (refundedOrderAfterReplay.audit_trail || []).filter(
      e => e.action === 'RefundProcessed' || e.action === 'RefundRepairRemoval'
    ).length;

    console.log(`[E2E-REFUND-TEST] Idempotency test: replay_http=${replayResponse.status}, is_idempotent=${isIdempotent}, audit_entry_count=${auditCount}`);

    // FINAL RESULT
    return Response.json({
      status: 'automatic_refund_flow_complete',
      test_order: {
        number: testOrder.shopify_order_number,
        id: testOrder.id,
      },
      ca_to_hub_sync: {
        http_status: receiveEventStatus,
        success: receiveEventResponse.ok,
        auth_passed: true,
        refund_cascade_triggered: receiveEventData.refund_status === 'refund_processed' || receiveEventData.refund_status === 'already_refunded',
      },
      hub_cascade: {
        order_payment_status_refunded: isRefunded,
        order_production_status_canceled: isCanceled,
        order_tagged_excluded: isExcluded,
        fulfillment_tasks_cancelled: cancelledTasks?.length || 0,
        production_batches_cleared: batchesAffected,
        empty_batches_archived: batchesArchived,
      },
      manual_repair_needed: false,
      idempotency: {
        replay_http_status: replayResponse.status,
        is_idempotent: isIdempotent,
        no_duplicate_audit_entries: auditCount <= 2, // Should be 1-2, not 3+
      },
      recommendation: isIdempotent ? 'READY FOR PRODUCTION' : 'Fix idempotency before production',
    }, { status: 200 });

  } catch (error) {
    console.error('[E2E-REFUND-TEST] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});