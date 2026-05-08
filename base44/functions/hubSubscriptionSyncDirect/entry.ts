/**
 * hubSubscriptionSyncDirect
 *
 * Direct internal subscription sync handler (NO HTTP auth validation).
 * 
 * This is the core subscription sync logic extracted from receiveCustomerAppEvent.
 * Used by:
 *   1. customerAppEventPublicGateway (public wrapper) → calls this internally
 *   2. receiveCustomerAppEvent (direct HTTP) → could also route here
 *
 * Auth: INTERNAL_FUNCTION_SECRET only (verified by caller)
 * 
 * This solves the problem where receiveCustomerAppEvent has HTTP Bearer auth
 * that conflicts with SDK internal auth.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const INTERNAL_SECRET = Deno.env.get('INTERNAL_FUNCTION_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let body;
    try {
      body = await req.json();
    } catch (jsonErr) {
      console.error('[HUB-SYNC-DIRECT] REJECT: Invalid JSON:', jsonErr.message);
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { _internalSecret, event, customer_email } = body;
    const data = body.data || body;

    // ───────────────────────────────────────────────────────────────────────────
    // INTERNAL SECURITY CHECK
    // ───────────────────────────────────────────────────────────────────────────
    console.log('[HUB-SYNC-DIRECT] Checking internal secret...');
    console.log('[HUB-SYNC-DIRECT] Received:', _internalSecret ? 'present' : 'missing');
    console.log('[HUB-SYNC-DIRECT] Expected:', INTERNAL_SECRET ? 'loaded' : 'not loaded');
    
    if (!_internalSecret || _internalSecret !== INTERNAL_SECRET) {
      console.error('[HUB-SYNC-DIRECT] REJECT: Internal secret mismatch or missing');
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    console.log('[HUB-SYNC-DIRECT] ════════════════════════════════════════');
    console.log('[HUB-SYNC-DIRECT] PROCESSING SUBSCRIPTION EVENT');
    console.log('[HUB-SYNC-DIRECT] Event:', event);
    console.log('[HUB-SYNC-DIRECT] Customer Email:', customer_email);
    console.log('[HUB-SYNC-DIRECT] Payload Keys:', Object.keys(body).join(', '));

    // Only handle subscription.created for now
    if (event !== 'customer.subscription_created') {
      return Response.json({
        status: 'acknowledged',
        event,
        note: 'Event acknowledged but not processed by hubSubscriptionSyncDirect',
      });
    }

    // Validate required fields
    if (!customer_email || !data.stripe_subscription_id || !data.first_delivery_date) {
      return Response.json({
        error: 'Missing required fields',
        detail: 'Expected: customer_email, stripe_subscription_id, first_delivery_date',
      }, { status: 400 });
    }

    // Validate payment status
    const paymentStatus = data.payment_status || data.financial_status || '';
    if (paymentStatus !== 'paid') {
      console.log(`[HUB-SYNC-DIRECT] Subscription not paid yet (${paymentStatus}) — acknowledged but not created`);
      return Response.json({
        status: 'acknowledged',
        event,
        note: `Subscription acknowledged but not yet paid (payment_status=${paymentStatus})`,
      });
    }

    console.log('[HUB-SYNC-DIRECT] ✅ VALIDATION PASSED');

    // ───────────────────────────────────────────────────────────────────────────
    // SYNC SUBSCRIPTION TO HUB
    // ───────────────────────────────────────────────────────────────────────────
    try {
      const PRODUCTION_DAYS = [2, 5, 6]; // 0=Sun, 2=Tue, 5=Fri, 6=Sat

      // Derive production_date from first_delivery_date
      const d = new Date(data.first_delivery_date + 'T00:00:00');
      let productionDate = null;
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

      // Build fulfillment items
      const fulfillmentItems = Array.isArray(data.products) && data.products.length > 0
        ? data.products.map(p => ({ title: p.product_name, quantity: p.quantity, price: 0 }))
        : [];

      if (fulfillmentItems.length === 0) {
        return Response.json({
          error: 'Missing products',
          detail: 'No products provided for subscription',
        }, { status: 400 });
      }

      // Check for existing operational order
      const existingOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({
        stripe_subscription_id: data.stripe_subscription_id,
      });

      const activeExisting = (existingOrders || []).filter(o =>
        o.data_quality_status !== 'quarantined' &&
        o.order_type === 'subscription' &&
        o.source_type === 'subscription_fulfillment'
      );

      let operationalOrderId = null;

      if (activeExisting.length > 0) {
        // Reuse existing order
        operationalOrderId = activeExisting[0].id;
        console.log(`[HUB-SYNC-DIRECT] Deduped: reusing existing order ${operationalOrderId}`);
      } else {
        // Create new operational order
        const createdOrder = await base44.asServiceRole.entities.ShopifyOrder.create({
          shopify_order_id: `sub_operational_${data.stripe_subscription_id}`,
          shopify_order_number: `#SUB-${data.stripe_subscription_id.slice(-10)}`,
          order_type: 'subscription',
          source_type: 'subscription_fulfillment',
          source_channel: 'subscription',
          fulfillment_method: 'delivery',
          fulfillment_mode: 'single_delivery',
          payment_status: 'paid',
          production_status: 'awaiting_production',
          order_lock_status: 'verified',
          data_quality_status: 'complete',
          sync_status: 'synced',
          customer_name: data.customer_name || '',
          customer_email: data.customer_email,
          customer_phone: data.phone || data.customer_phone || '',
          address_line1: data.address_line1 || '',
          address_line2: data.address_line2 || '',
          address_city: data.address_city || '',
          address_state: data.address_state || '',
          address_postal_code: data.address_postal_code || '',
          address_country: data.address_country || 'US',
          delivery_notes: data.delivery_notes || '',
          customer_notes: `Subscription: ${data.stripe_subscription_id} | Plan: ${data.plan_name || 'N/A'}`,
          line_items: fulfillmentItems,
          fulfillments: [
            {
              fulfillment_number: 1,
              production_date: productionDate,
              delivery_date: data.first_delivery_date,
              items: fulfillmentItems,
              status: 'pending',
              address_line1: data.address_line1 || '',
              address_line2: data.address_line2 || '',
              address_city: data.address_city || '',
              address_state: data.address_state || '',
              address_postal_code: data.address_postal_code || '',
              address_country: data.address_country || 'US',
              delivery_notes: data.delivery_notes || '',
            },
          ],
          assigned_delivery_date: data.first_delivery_date,
          delivery_window_label: data.delivery_window_label || '5 PM – 8 PM',
          total_price: 0,
          subtotal: 0,
          stripe_subscription_id: data.stripe_subscription_id,
          customer_app_subscription_id: data.customer_app_subscription_id || null,
          customer_order_date: new Date().toISOString(),
        });

        operationalOrderId = createdOrder.id;
        console.log(`[HUB-SYNC-DIRECT] Created new operational order ${operationalOrderId}`);
      }

      // Check for existing fulfillment task
      const existingTasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
        stripe_subscription_id: data.stripe_subscription_id,
      });

      let matchingTask = null;
      if (existingTasks && existingTasks.length > 0) {
        matchingTask = existingTasks.find(t => {
          const sameDate = t.scheduled_date === data.first_delivery_date;
          const sameFulfillment = t.fulfillment_number === 1;
          return sameDate && sameFulfillment;
        });
      }

      let fulfillmentTaskId = null;

      if (matchingTask) {
        fulfillmentTaskId = matchingTask.id;
        console.log(`[HUB-SYNC-DIRECT] Deduped: reusing existing fulfillment task ${fulfillmentTaskId}`);
      } else {
        const itemsSummary = fulfillmentItems.map(i => `${i.quantity}x ${i.title}`).join(', ');
        const createdTask = await base44.asServiceRole.entities.FulfillmentTask.create({
          customer_name: data.customer_name || '',
          customer_email: customer_email,
          phone: data.phone || data.customer_phone || '',
          fulfillment_type: 'Delivery',
          status: 'Scheduled',
          scheduled_date: data.first_delivery_date,
          address_line1: data.address_line1 || '',
          address_city: data.address_city || '',
          address_state: data.address_state || '',
          address_postal_code: data.address_postal_code || '',
          time_window: data.delivery_window_label || '5 PM – 8 PM',
          delivery_window_label: data.delivery_window_label || '5 PM – 8 PM',
          items_summary: itemsSummary,
          order_id: operationalOrderId,
          source_type: 'subscription_fulfillment',
          stripe_subscription_id: data.stripe_subscription_id,
          customer_app_subscription_id: data.customer_app_subscription_id || null,
          payment_status: 'paid',
          fulfillment_number: 1,
          plan_name: data.plan_name || null,
          notes: `Subscription: ${data.stripe_subscription_id} | Plan: ${data.plan_name || 'N/A'} | Fulfillment #1`,
        });

        fulfillmentTaskId = createdTask.id;
        console.log(`[HUB-SYNC-DIRECT] Created new fulfillment task ${fulfillmentTaskId}`);
      }

      console.log('[HUB-SYNC-DIRECT] ════════════════════════════════════════');

      return Response.json({
        status: 'success',
        action: activeExisting.length > 0 || matchingTask ? 'dedupe' : 'created',
        event,
        operational_order_id: operationalOrderId,
        fulfillment_task_id: fulfillmentTaskId,
        customer_email,
        stripe_subscription_id: data.stripe_subscription_id,
      }, { status: 200 });

    } catch (err) {
      console.error('[HUB-SYNC-DIRECT] Sync error:', err.message);
      return Response.json({
        status: 'error',
        error: err.message,
        event,
      }, { status: 500 });
    }

  } catch (error) {
    console.error('[HUB-SYNC-DIRECT] Handler error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});