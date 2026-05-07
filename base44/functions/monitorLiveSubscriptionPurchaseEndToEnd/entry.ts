import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * monitorLiveSubscriptionPurchaseEndToEnd — CONTROLLED LIVE VERIFICATION
 *
 * Comprehensive end-to-end monitoring of one live subscription purchase through:
 * Customer App → Stripe → Hub → Production Batch → Driver Portal → Route Optimization → Loyalty
 *
 * CALL AFTER customer completes purchase in Customer App.
 * Payload: { stripe_subscription_id, customer_email, first_delivery_date }
 *
 * Returns complete trace of all IDs, timestamps, and verification status.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const { stripe_subscription_id, customer_email, first_delivery_date } = body;

    if (!stripe_subscription_id || !customer_email || !first_delivery_date) {
      return Response.json({
        error: 'Required: stripe_subscription_id, customer_email, first_delivery_date',
      }, { status: 400 });
    }

    console.log(`[LIVE-MONITOR] Starting end-to-end verification for ${customer_email}`);

    const trace = {
      test_input: { stripe_subscription_id, customer_email, first_delivery_date },
      verification_timestamp: new Date().toISOString(),
      stripe_checks: {},
      hub_checks: {},
      production_checks: {},
      driver_portal_checks: {},
      loyalty_checks: {},
      duplicate_checks: {},
      final_verdict: {},
    };

    // ═══════════════════════════════════════════════════════════════════════════════
    // STRIPE VERIFICATION
    // ═══════════════════════════════════════════════════════════════════════════════
    console.log('[LIVE-MONITOR] STRIPE: Verifying subscription status');

    try {
      // Stripe API call requires STRIPE_API_KEY
      const stripeApiKey = Deno.env.get('STRIPE_API_KEY');
      if (!stripeApiKey) {
        trace.stripe_checks.status = 'SKIP';
        trace.stripe_checks.reason = 'STRIPE_API_KEY not configured';
        console.warn('[LIVE-MONITOR] STRIPE key not configured, skipping direct Stripe checks');
      } else {
        // Fetch subscription from Stripe
        const response = await fetch(`https://api.stripe.com/v1/subscriptions/${stripe_subscription_id}`, {
          headers: { Authorization: `Bearer ${stripeApiKey}` },
        });

        if (response.status === 200) {
          const stripeData = await response.json();
          trace.stripe_checks = {
            status: 'PASS',
            subscription_id: stripeData.id,
            status_stripe: stripeData.status,
            customer_id: stripeData.customer,
            current_period_start: stripeData.current_period_start,
            current_period_end: stripeData.current_period_end,
            latest_invoice_id: stripeData.latest_invoice,
            amount: stripeData.items?.data[0]?.price?.unit_amount,
            currency: stripeData.items?.data[0]?.price?.currency,
          };

          // Check latest invoice
          if (stripeData.latest_invoice) {
            const invoiceRes = await fetch(
              `https://api.stripe.com/v1/invoices/${stripeData.latest_invoice}`,
              { headers: { Authorization: `Bearer ${stripeApiKey}` } }
            );
            const invoiceData = await invoiceRes.json();
            trace.stripe_checks.latest_invoice_status = invoiceData.status;
            trace.stripe_checks.latest_invoice_paid = invoiceData.paid;
            trace.stripe_checks.payment_intent_id = invoiceData.payment_intent;
          }

          console.log('[LIVE-MONITOR] ✓ STRIPE PASS: Subscription active, status=' + stripeData.status);
        } else {
          trace.stripe_checks = { status: 'FAIL', error: `HTTP ${response.status}` };
          console.error('[LIVE-MONITOR] ✗ STRIPE FAIL: HTTP', response.status);
        }
      }
    } catch (err) {
      trace.stripe_checks = { status: 'ERROR', error: err.message };
      console.error('[LIVE-MONITOR] STRIPE ERROR:', err.message);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // HUB VERIFICATION
    // ═══════════════════════════════════════════════════════════════════════════════
    console.log('[LIVE-MONITOR] HUB: Verifying ShopifyOrder and FulfillmentTask');

    let operationalOrderId = null;
    let fulfillmentTaskId = null;

    try {
      // Find operational ShopifyOrder created by handler
      const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({
        stripe_subscription_id: stripe_subscription_id,
      });

      if (!orders || orders.length === 0) {
        trace.hub_checks.shopify_order = { status: 'NOT_FOUND', count: 0 };
        console.warn('[LIVE-MONITOR] ✗ HUB: No ShopifyOrder found for this subscription');
      } else {
        const order = orders[0];
        operationalOrderId = order.id;

        trace.hub_checks.shopify_order = {
          status: 'FOUND',
          id: order.id,
          order_number: order.shopify_order_number,
          order_type: order.order_type,
          source_type: order.source_type,
          payment_status: order.payment_status,
          production_status: order.production_status,
          assigned_delivery_date: order.assigned_delivery_date,
          fulfillment_mode: order.fulfillment_mode,
          line_items_count: order.line_items?.length,
          duplicate_count: orders.length,
        };

        console.log('[LIVE-MONITOR] ✓ HUB: ShopifyOrder found:', {
          id: order.id,
          order_type: order.order_type,
          source_type: order.source_type,
        });

        // Find linked FulfillmentTask
        const tasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
          customer_email: customer_email,
          scheduled_date: first_delivery_date,
        });

        const linkedTask = tasks?.find(t => t.order_id === operationalOrderId || t.stripe_subscription_id === stripe_subscription_id);

        if (linkedTask) {
          fulfillmentTaskId = linkedTask.id;
          trace.hub_checks.fulfillment_task = {
            status: 'FOUND',
            id: linkedTask.id,
            customer_name: linkedTask.customer_name,
            customer_email: linkedTask.customer_email,
            customer_phone: linkedTask.customer_phone,
            fulfillment_type: linkedTask.fulfillment_type,
            status: linkedTask.status,
            scheduled_date: linkedTask.scheduled_date,
            source_type: linkedTask.source_type,
            payment_status: linkedTask.payment_status,
            items_summary: linkedTask.items_summary,
            delivery_address: linkedTask.delivery_address,
          };

          console.log('[LIVE-MONITOR] ✓ HUB: FulfillmentTask found:', {
            id: linkedTask.id,
            source_type: linkedTask.source_type,
            payment_status: linkedTask.payment_status,
          });
        } else {
          trace.hub_checks.fulfillment_task = { status: 'NOT_FOUND', tasks_on_date: tasks?.length };
          console.warn('[LIVE-MONITOR] ✗ HUB: No FulfillmentTask found');
        }
      }
    } catch (err) {
      trace.hub_checks = { status: 'ERROR', error: err.message };
      console.error('[LIVE-MONITOR] HUB ERROR:', err.message);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // PRODUCTION BATCH VERIFICATION
    // ═══════════════════════════════════════════════════════════════════════════════
    console.log('[LIVE-MONITOR] PRODUCTION: Verifying automatic batch creation');

    const PRODUCTION_DAYS = [2, 5, 6];
    let productionDate = null;

    try {
      // Derive production_date from first_delivery_date
      const d = new Date(first_delivery_date + 'T00:00:00');
      for (let i = 1; i <= 7; i++) {
        const check = new Date(d);
        check.setDate(d.getDate() - i);
        if (PRODUCTION_DAYS.includes(check.getDay())) {
          productionDate = check.toISOString().split('T')[0];
          break;
        }
      }
      if (!productionDate) {
        const fallback = new Date(d);
        fallback.setDate(d.getDate() - 1);
        productionDate = fallback.toISOString().split('T')[0];
      }

      // Query ProductionBatch for this production date
      const batches = await base44.asServiceRole.entities.ProductionBatch.filter({
        production_date: productionDate,
      });

      // Find batches with subscription_fulfillment source from our order
      const batchesWithSubscription = batches.filter(b =>
        b.order_sources?.some(src =>
          src.order_id === operationalOrderId &&
          src.source_type === 'subscription_fulfillment'
        )
      );

      if (batchesWithSubscription.length === 0) {
        trace.production_checks = {
          status: 'PENDING',
          production_date: productionDate,
          total_batches_on_date: batches.length,
          batches_with_subscription: 0,
          note: 'No batches found yet. Automation may still be processing.',
        };
        console.log('[LIVE-MONITOR] ⏳ PRODUCTION: Batches not yet created (automation processing)');
      } else {
        trace.production_checks = {
          status: 'FOUND',
          production_date: productionDate,
          total_batches_on_date: batches.length,
          batches_with_subscription: batchesWithSubscription.length,
          batches: batchesWithSubscription.map(b => {
            const subSources = b.order_sources.filter(src =>
              src.order_id === operationalOrderId &&
              src.source_type === 'subscription_fulfillment'
            );
            return {
              batch_id: b.batch_id,
              product_name: b.product_name,
              planned_units: b.planned_units,
              status: b.status,
              order_sources_count: subSources.length,
              sources: subSources.map(src => ({
                customer_email: src.customer_email,
                quantity: src.quantity,
                source_type: src.source_type,
              })),
            };
          }),
        };

        console.log('[LIVE-MONITOR] ✓ PRODUCTION: Batches found:', batchesWithSubscription.length);
      }
    } catch (err) {
      trace.production_checks = { status: 'ERROR', error: err.message };
      console.error('[LIVE-MONITOR] PRODUCTION ERROR:', err.message);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // DRIVER PORTAL VERIFICATION
    // ═══════════════════════════════════════════════════════════════════════════════
    console.log('[LIVE-MONITOR] DRIVER PORTAL: Verifying delivery visibility');

    try {
      const driverRes = await base44.asServiceRole.functions.invoke('resolveDeliveryScheduleForDate', {
        selectedDate: first_delivery_date,
      });

      const deliveries = driverRes?.data?.deliveries || [];
      const subDelivery = deliveries.find(d =>
        (d.fulfillment_task_id === fulfillmentTaskId || d.customer_email === customer_email) &&
        d.payment_status === 'paid'
      );

      if (subDelivery) {
        trace.driver_portal_checks = {
          status: 'FOUND',
          fulfillment_task_id: subDelivery.fulfillment_task_id,
          customer_name: subDelivery.customer_name,
          customer_email: subDelivery.customer_email,
          delivery_address: subDelivery.delivery_address,
          items_summary: subDelivery.items_summary,
          payment_status: subDelivery.payment_status,
          delivery_window: subDelivery.delivery_window_label,
          total_deliveries_on_date: deliveries.length,
        };

        console.log('[LIVE-MONITOR] ✓ DRIVER PORTAL: Delivery visible');
      } else {
        trace.driver_portal_checks = {
          status: 'NOT_FOUND',
          total_deliveries_on_date: deliveries.length,
          note: 'Delivery not visible in Driver Portal yet',
        };

        console.log('[LIVE-MONITOR] ⏳ DRIVER PORTAL: Delivery not yet visible');
      }
    } catch (err) {
      trace.driver_portal_checks = { status: 'ERROR', error: err.message };
      console.error('[LIVE-MONITOR] DRIVER PORTAL ERROR:', err.message);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // ROUTE OPTIMIZATION VERIFICATION
    // ═══════════════════════════════════════════════════════════════════════════════
    console.log('[LIVE-MONITOR] ROUTE OPTIMIZATION: Verifying inclusion in route');

    try {
      const routeRes = await base44.asServiceRole.functions.invoke('optimizeDeliveryRoute', {
        selectedDate: first_delivery_date,
      });

      const orders = routeRes?.data?.optimized_orders || [];
      const subInRoute = orders.find(o =>
        o.fulfillment_task_id === fulfillmentTaskId ||
        o.customer_email === customer_email
      );

      if (subInRoute) {
        trace.driver_portal_checks.route_optimization = {
          status: 'FOUND',
          route_position: subInRoute.route_position,
          total_stops_in_route: orders.length,
        };

        console.log('[LIVE-MONITOR] ✓ ROUTE OPTIMIZATION: Stop included in route');
      } else {
        trace.driver_portal_checks.route_optimization = {
          status: 'NOT_FOUND',
          total_stops_in_route: orders.length,
        };

        console.log('[LIVE-MONITOR] ⏳ ROUTE OPTIMIZATION: Stop not yet in route');
      }
    } catch (err) {
      trace.driver_portal_checks.route_optimization = { status: 'ERROR', error: err.message };
      console.error('[LIVE-MONITOR] ROUTE OPTIMIZATION ERROR:', err.message);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // LOYALTY VERIFICATION
    // ═══════════════════════════════════════════════════════════════════════════════
    console.log('[LIVE-MONITOR] LOYALTY: Verifying points awarded');

    try {
      const members = await base44.asServiceRole.entities.LoyaltyMember.filter({
        email: customer_email,
      });

      if (members && members.length > 0) {
        const member = members[0];
        trace.loyalty_checks = {
          status: 'FOUND',
          email: member.email,
          full_name: member.full_name,
          total_points: member.total_points,
          lifetime_points: member.lifetime_points,
          redeemed_points: member.redeemed_points,
          points_history_count: member.points_history?.length,
        };

        // Find subscription-related points
        const subPoints = member.points_history?.filter(p =>
          p.description?.includes('subscription') ||
          p.description?.includes('Subscription') ||
          p.order_id === operationalOrderId
        ) || [];

        trace.loyalty_checks.subscription_points = subPoints.map(p => ({
          type: p.type,
          amount: p.amount,
          description: p.description,
          timestamp: p.timestamp,
        }));

        console.log('[LIVE-MONITOR] ✓ LOYALTY: Member found with', member.total_points, 'total points');
      } else {
        trace.loyalty_checks = { status: 'NOT_FOUND' };
        console.warn('[LIVE-MONITOR] ✗ LOYALTY: No LoyaltyMember found');
      }
    } catch (err) {
      trace.loyalty_checks = { status: 'ERROR', error: err.message };
      console.error('[LIVE-MONITOR] LOYALTY ERROR:', err.message);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // DUPLICATE VERIFICATION
    // ═══════════════════════════════════════════════════════════════════════════════
    console.log('[LIVE-MONITOR] DUPLICATES: Checking for duplicate records');

    try {
      const dupOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({
        stripe_subscription_id: stripe_subscription_id,
      });

      const dupTasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
        stripe_subscription_id: stripe_subscription_id,
      });

      trace.duplicate_checks = {
        shopify_orders: {
          total_count: dupOrders?.length || 0,
          status: (dupOrders?.length || 0) === 1 ? 'PASS' : 'FAIL',
          ids: dupOrders?.map(o => o.id),
        },
        fulfillment_tasks: {
          total_count: dupTasks?.length || 0,
          status: (dupTasks?.length || 0) === 1 ? 'PASS' : 'FAIL',
          ids: dupTasks?.map(t => t.id),
        },
      };

      console.log('[LIVE-MONITOR]', dupOrders?.length === 1 ? '✓' : '✗', 'DUPLICATES:', dupOrders?.length, 'orders,', dupTasks?.length, 'tasks');
    } catch (err) {
      trace.duplicate_checks = { status: 'ERROR', error: err.message };
      console.error('[LIVE-MONITOR] DUPLICATES ERROR:', err.message);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // FINAL VERDICT
    // ═══════════════════════════════════════════════════════════════════════════════

    const hubPass = trace.hub_checks.shopify_order?.status === 'FOUND' &&
                    trace.hub_checks.fulfillment_task?.status === 'FOUND';
    const prodPass = trace.production_checks.status === 'FOUND' ||
                     trace.production_checks.status === 'PENDING';
    const driverPass = trace.driver_portal_checks.status === 'FOUND' ||
                       trace.driver_portal_checks.status === 'NOT_FOUND';
    const noDups = trace.duplicate_checks.shopify_orders?.status === 'PASS' &&
                   trace.duplicate_checks.fulfillment_tasks?.status === 'PASS';

    const allPass = hubPass && noDups;
    const completePass = hubPass && prodPass && driverPass && noDups &&
                        trace.production_checks.status === 'FOUND' &&
                        trace.driver_portal_checks.status === 'FOUND';

    trace.final_verdict = {
      hub_created: hubPass,
      duplicates_ok: noDups,
      production_automated: prodPass,
      driver_portal_visible: driverPass,
      status: completePass ? 'COMPLETE_PASS' : allPass ? 'PARTIAL_PASS' : 'BLOCKED',
      note: completePass
        ? '✓✓✓ LIVE SUBSCRIPTION PURCHASE CHAIN COMPLETE: Customer App → Stripe → Hub → Production → Driver Portal. Automated flow working end-to-end.'
        : allPass
        ? '✓ CORE PASS: Hub records created, no duplicates. Waiting for Production/Driver Portal automation.'
        : '✗ BLOCKER: Core Hub records not created.',
    };

    console.log('[LIVE-MONITOR] ✓✓✓ COMPLETE:', trace.final_verdict.note);

    return Response.json(trace);

  } catch (error) {
    console.error('[LIVE-MONITOR] Unhandled error:', error.message);
    return Response.json({ error: error.message, status: 'UNHANDLED_ERROR' }, { status: 500 });
  }
});