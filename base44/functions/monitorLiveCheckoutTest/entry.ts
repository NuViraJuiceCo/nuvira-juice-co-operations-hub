import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY'), { apiVersion: '2023-10-16' });

/**
 * MONITOR-ONLY: Live Checkout Retest Observability Function
 *
 * READ-ONLY. Makes zero writes. Zero deletions. Zero repairs.
 * Call this after a live test checkout to get the full checkpoint report.
 *
 * Usage: POST with { order_number, customer_email, stripe_session_id? }
 * Returns: Full checkpoint snapshot across Stripe, Hub, OrderSyncLog, OrderReviewQueue, ProductionBatch, FulfillmentTask
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const { order_number, customer_email, stripe_session_id } = await req.json();

    if (!order_number && !customer_email && !stripe_session_id) {
      return Response.json({ error: 'Provide at least one of: order_number, customer_email, stripe_session_id' }, { status: 400 });
    }

    const report = {
      generated_at: new Date().toISOString(),
      test_inputs: { order_number, customer_email, stripe_session_id },
      checkpoints: {},
      pass: null,
      fail_reasons: [],
      summary: '',
    };

    // ── CHECKPOINT 1: STRIPE ─────────────────────────────────────────────────
    let stripeSession = null;
    let stripePaymentIntent = null;

    try {
      if (stripe_session_id) {
        stripeSession = await stripe.checkout.sessions.retrieve(stripe_session_id, {
          expand: ['payment_intent', 'customer'],
        });
      } else if (order_number) {
        // Search sessions by metadata order_number
        const sessions = await stripe.checkout.sessions.list({ limit: 20 });
        stripeSession = sessions.data.find(s =>
          s.metadata?.order_number === order_number ||
          s.metadata?.order_intent_id?.includes(order_number)
        );
      }

      if (stripeSession) {
        stripePaymentIntent = typeof stripeSession.payment_intent === 'object'
          ? stripeSession.payment_intent
          : (stripeSession.payment_intent ? await stripe.paymentIntents.retrieve(stripeSession.payment_intent) : null);

        report.checkpoints.stripe = {
          found: true,
          session_id: stripeSession.id,
          payment_status: stripeSession.payment_status,
          amount_total: stripeSession.amount_total / 100,
          currency: stripeSession.currency,
          customer_email: stripeSession.customer_details?.email,
          customer_name: stripeSession.customer_details?.name,
          created_at: new Date(stripeSession.created * 1000).toISOString(),
          metadata: stripeSession.metadata || {},
          payment_intent_id: typeof stripeSession.payment_intent === 'string'
            ? stripeSession.payment_intent
            : stripeSession.payment_intent?.id,
          payment_intent_status: stripePaymentIntent?.status,
          payment_intent_amount: stripePaymentIntent ? stripePaymentIntent.amount / 100 : null,
        };

        if (stripeSession.payment_status !== 'paid') {
          report.fail_reasons.push(`Stripe session payment_status is "${stripeSession.payment_status}" (expected "paid")`);
        }
      } else {
        report.checkpoints.stripe = { found: false, note: 'No matching Stripe session found' };
        report.fail_reasons.push('Stripe session not found');
      }
    } catch (err) {
      report.checkpoints.stripe = { found: false, error: err.message };
      report.fail_reasons.push(`Stripe lookup error: ${err.message}`);
    }

    // ── CHECKPOINT 2: HUB ORDER (ShopifyOrder) ───────────────────────────────
    let hubOrders = [];
    try {
      const queries = [];
      if (order_number) queries.push(base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_number: order_number }));
      if (stripe_session_id) queries.push(base44.asServiceRole.entities.ShopifyOrder.filter({ stripe_checkout_session_id: stripe_session_id }));
      if (customer_email) queries.push(base44.asServiceRole.entities.ShopifyOrder.filter({ customer_email }));

      const results = await Promise.all(queries);
      const seen = new Set();
      for (const batch of results) {
        for (const o of (batch || [])) {
          if (!seen.has(o.id)) { seen.add(o.id); hubOrders.push(o); }
        }
      }

      // Find the specific order for this test
      const testOrder = hubOrders.find(o =>
        (order_number && o.shopify_order_number === order_number) ||
        (stripe_session_id && o.stripe_checkout_session_id === stripe_session_id)
      );

      const allEmailOrders = customer_email
        ? hubOrders.filter(o => o.customer_email === customer_email)
        : [];

      report.checkpoints.hub_order = {
        test_order_found: !!testOrder,
        test_order: testOrder ? {
          id: testOrder.id,
          order_number: testOrder.shopify_order_number,
          payment_status: testOrder.payment_status,
          production_status: testOrder.production_status,
          data_quality_status: testOrder.data_quality_status,
          order_lock_status: testOrder.order_lock_status,
          customer_name: testOrder.customer_name,
          customer_email: testOrder.customer_email,
          total_price: testOrder.total_price,
          address_line1: testOrder.address_line1,
          address_city: testOrder.address_city,
          address_state: testOrder.address_state,
          address_postal_code: testOrder.address_postal_code,
          line_items: testOrder.line_items,
          fulfillment_method: testOrder.fulfillment_method,
          fulfillment_mode: testOrder.fulfillment_mode,
          stripe_checkout_session_id: testOrder.stripe_checkout_session_id,
          stripe_payment_intent_id: testOrder.stripe_payment_intent_id,
          created_date: testOrder.created_date,
          last_sync_at: testOrder.last_sync_at,
        } : null,
        all_orders_for_email_count: allEmailOrders.length,
        all_orders_for_email: allEmailOrders.map(o => ({
          id: o.id,
          order_number: o.shopify_order_number,
          payment_status: o.payment_status,
          created_date: o.created_date,
          stripe_checkout_session_id: o.stripe_checkout_session_id,
        })),
      };

      // Validate pass conditions
      if (!testOrder) {
        report.fail_reasons.push('Hub order not found — not created or not matched');
      } else {
        if (testOrder.payment_status !== 'paid') report.fail_reasons.push(`Hub order payment_status is "${testOrder.payment_status}" (expected "paid")`);
        if (!testOrder.address_line1 || !testOrder.address_city || !testOrder.address_state || !testOrder.address_postal_code) report.fail_reasons.push('Hub order missing complete address');
        if (!testOrder.line_items || testOrder.line_items.length === 0) report.fail_reasons.push('Hub order has no line_items');
        if (!testOrder.stripe_checkout_session_id || testOrder.stripe_checkout_session_id.includes('UNIQUE') || testOrder.stripe_checkout_session_id.includes('fake')) report.fail_reasons.push('Hub order has fake/missing Stripe session ID');
        if (testOrder.data_quality_status === 'incomplete') report.fail_reasons.push('Hub order data_quality_status is incomplete');
      }

      // Check for same-email merge (should be SEPARATE records)
      if (allEmailOrders.length > 1) {
        const sameNumberOrders = allEmailOrders.filter(o => o.shopify_order_number === order_number);
        if (sameNumberOrders.length > 1) {
          report.fail_reasons.push(`Duplicate orders detected: ${sameNumberOrders.length} records with order_number ${order_number}`);
        }
      }

    } catch (err) {
      report.checkpoints.hub_order = { error: err.message };
      report.fail_reasons.push(`Hub order lookup error: ${err.message}`);
    }

    // ── CHECKPOINT 3: ORDER SYNC LOG ─────────────────────────────────────────
    try {
      const syncLogs = order_number
        ? await base44.asServiceRole.entities.OrderSyncLog.filter({ order_number })
        : [];
      const emailLogs = customer_email
        ? await base44.asServiceRole.entities.OrderSyncLog.filter({ customer_email })
        : [];

      const allLogs = [...syncLogs, ...emailLogs].reduce((acc, l) => {
        if (!acc.find(x => x.id === l.id)) acc.push(l);
        return acc;
      }, []);

      const successLogs = allLogs.filter(l => l.success && l.action === 'created');
      const failedLogs = allLogs.filter(l => !l.success);
      const rejectedLogs = allLogs.filter(l => l.action === 'rejected');

      report.checkpoints.order_sync_log = {
        total_entries: allLogs.length,
        success_creates: successLogs.length,
        failures: failedLogs.length,
        rejections: rejectedLogs.length,
        entries: allLogs.map(l => ({
          id: l.id,
          sync_source: l.sync_source,
          action: l.action,
          success: l.success,
          reason: l.reason,
          error: l.error,
          sync_timestamp: l.sync_timestamp,
          order_number: l.order_number,
        })),
      };

      if (successLogs.length === 0) {
        report.fail_reasons.push('No successful "created" entry in OrderSyncLog');
      }
      if (failedLogs.length > 0) {
        report.fail_reasons.push(`${failedLogs.length} failed sync log entries detected`);
      }
    } catch (err) {
      report.checkpoints.order_sync_log = { error: err.message };
    }

    // ── CHECKPOINT 4: ORDER REVIEW QUEUE ─────────────────────────────────────
    try {
      const queueEntries = customer_email
        ? await base44.asServiceRole.entities.OrderReviewQueue.filter({ customer_email, status: 'pending' })
        : [];
      const orderQueueEntries = order_number
        ? await base44.asServiceRole.entities.OrderReviewQueue.filter({ existing_order_number: order_number, status: 'pending' })
        : [];

      const allQueue = [...queueEntries, ...orderQueueEntries].reduce((acc, e) => {
        if (!acc.find(x => x.id === e.id)) acc.push(e);
        return acc;
      }, []);

      report.checkpoints.order_review_queue = {
        pending_entries: allQueue.length,
        entries: allQueue.map(e => ({
          id: e.id,
          incident_type: e.incident_type,
          issue_description: e.issue_description,
          recommended_action: e.recommended_action,
          status: e.status,
          created_date: e.created_date,
        })),
      };

      if (allQueue.length > 0) {
        report.fail_reasons.push(`${allQueue.length} pending OrderReviewQueue entries for this order/customer`);
      }
    } catch (err) {
      report.checkpoints.order_review_queue = { error: err.message };
    }

    // ── CHECKPOINT 5: PRODUCTION BATCH ───────────────────────────────────────
    try {
      const allBatches = await base44.asServiceRole.entities.ProductionBatch.list('-production_date', 50);
      const relatedBatches = allBatches.filter(b =>
        b.order_sources?.some(s =>
          s.order_number === order_number || s.customer_email === customer_email
        )
      );

      report.checkpoints.production_batch = {
        related_batches_count: relatedBatches.length,
        batches: relatedBatches.map(b => ({
          id: b.id,
          batch_id: b.batch_id,
          product_name: b.product_name,
          status: b.status,
          planned_units: b.planned_units,
          production_date: b.production_date,
          order_sources: b.order_sources,
        })),
      };
    } catch (err) {
      report.checkpoints.production_batch = { error: err.message };
    }

    // ── CHECKPOINT 6: FULFILLMENT TASK / DRIVER ELIGIBILITY ─────────────────
    try {
      const hubOrderId = report.checkpoints.hub_order?.test_order?.id;
      const tasks = hubOrderId
        ? await base44.asServiceRole.entities.FulfillmentTask.filter({ order_id: hubOrderId })
        : [];

      const testOrder = report.checkpoints.hub_order?.test_order;
      const hasCompleteAddress = testOrder && testOrder.address_line1 && testOrder.address_city && testOrder.address_state && testOrder.address_postal_code;
      const isDelivery = testOrder?.fulfillment_method === 'delivery';
      const driverEligible = isDelivery ? hasCompleteAddress : true;

      report.checkpoints.fulfillment = {
        fulfillment_tasks_count: tasks.length,
        driver_eligible: driverEligible,
        driver_eligible_reason: !isDelivery ? 'Not a delivery order' : hasCompleteAddress ? 'Complete address present' : 'Missing address — not eligible for Driver Portal',
        tasks: tasks.map(t => ({
          id: t.id,
          status: t.status,
          scheduled_date: t.scheduled_date,
          fulfillment_type: t.fulfillment_type,
          address: t.address,
        })),
      };

      if (isDelivery && !hasCompleteAddress) {
        report.fail_reasons.push('Order not Driver Portal eligible — missing delivery address');
      }
    } catch (err) {
      report.checkpoints.fulfillment = { error: err.message };
    }

    // ── OVERALL PASS/FAIL ────────────────────────────────────────────────────
    report.pass = report.fail_reasons.length === 0;
    report.summary = report.pass
      ? '✅ PASS — All checkpoints passed. Order is real, paid, addressed, and clean downstream.'
      : `❌ FAIL — ${report.fail_reasons.length} issue(s): ${report.fail_reasons.join(' | ')}`;

    console.log(`[MONITOR] Test result: ${report.summary}`);

    return Response.json(report);

  } catch (error) {
    console.error('[MONITOR] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});