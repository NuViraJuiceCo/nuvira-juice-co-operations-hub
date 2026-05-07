import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * receiveCustomerAppEvent — Hub inbound endpoint for customer app push events
 *
 * Accepts events pushed by the customer app's syncCustomerToHub function.
 * This is the canonical HUB_API_URL target for all customer-side push events.
 *
 * Auth: Authorization: Bearer <CUSTOMER_APP_SYNC_SECRET>
 *
 * Supported event types:
 *   customer.profile_updated      — update customer name/phone on existing orders
 *   customer.bag_return           — create/update BagReturn record
 *   customer.onboarding_complete  — no-op, acknowledged
 *   customer.subscription_created — trigger order pull for this customer
 *   order.created / order.paid    — sync paid order to Hub
 *   order.refunded                — cascade refund through Hub (cancel order, tasks, batches)
 *   order.status_updated          — acknowledged (hub owns status, not customer app)
 */

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  // Authenticate
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token || token !== SYNC_SECRET) {
    console.warn('[RECEIVE-CUSTOMER-EVENT] Unauthorized request — invalid or missing Bearer token');
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { event } = body;
    // Customer App sends order data under body.order OR body.data — support both
    const data = body.order || body.data || {};

    if (!event) {
      return Response.json({ error: 'Missing event type' }, { status: 400 });
    }

    console.log(`[RECEIVE-CUSTOMER-EVENT] event=${event}, email=${data?.customer_email || 'unknown'}`);

    // ── customer.profile_updated ──────────────────────────────────────────────
    if (event === 'customer.profile_updated') {
      if (!data?.customer_email) {
        return Response.json({ error: 'Missing customer_email' }, { status: 400 });
      }
      // Update customer name/phone on any existing orders for this email
      const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({ customer_email: data.customer_email });
      let updated = 0;
      for (const order of (orders || [])) {
        const patch = {};
        if (data.customer_name && !order.customer_name) patch.customer_name = data.customer_name;
        if (data.customer_phone && !order.customer_phone) patch.customer_phone = data.customer_phone;
        if (Object.keys(patch).length > 0) {
          await base44.asServiceRole.entities.ShopifyOrder.update(order.id, patch);
          updated++;
        }
      }
      return Response.json({ status: 'success', event, updated_orders: updated });
    }

    // ── customer.bag_return ───────────────────────────────────────────────────
    if (event === 'customer.bag_return') {
      if (!data?.customer_email || !data?.order_id) {
        return Response.json({ error: 'Missing customer_email or order_id' }, { status: 400 });
      }
      const existing = await base44.asServiceRole.entities.BagReturn.filter({
        order_id: data.order_id,
        customer_email: data.customer_email,
      });
      const returnData = {
        order_id: data.order_id,
        customer_email: data.customer_email,
        small_bags_requested: data.small_bags_requested || 0,
        tote_bags_requested: data.tote_bags_requested || 0,
        verification_status: 'requested',
        sync_status: 'synced',
      };
      if (existing && existing.length > 0) {
        // Only update if still in requested state — don't overwrite driver verifications
        if (existing[0].verification_status === 'requested') {
          await base44.asServiceRole.entities.BagReturn.update(existing[0].id, returnData);
        }
        return Response.json({ status: 'success', event, action: 'updated' });
      } else {
        await base44.asServiceRole.entities.BagReturn.create(returnData);
        return Response.json({ status: 'success', event, action: 'created' });
      }
    }

    // ── customer.subscription_created ────────────────────────────────────────
    // Acknowledged — the 30-min scheduled pull will pick up the new subscription order
    if (event === 'customer.subscription_created') {
      console.log(`[RECEIVE-CUSTOMER-EVENT] Subscription created for ${data?.customer_email} — will be picked up on next scheduled pull`);
      return Response.json({ status: 'success', event, note: 'Order will sync on next scheduled pull (every 30 min)' });
    }

    // ── order.created / order.paid ───────────────────────────────────────────
    // Customer App pushes paid orders via syncOrderToHub using event=order.created
    // Route directly into safeSyncOrderUpdate — same logic as ingestCustomerAppOrder
    if (event === 'order.created' || event === 'order.paid') {
      // Support both body.order and body.data as the order payload container
      const orderData = body.order || body.data || {};

      // Validate minimum required fields
      const errors = [];
      if (!orderData.order_number) errors.push('order_number required');
      if (!orderData.customer_email) errors.push('customer_email required');
      // Accept line_items OR items (CA sends either field name)
      const resolvedLineItems = (orderData.line_items && orderData.line_items.length > 0)
        ? orderData.line_items
        : (orderData.items && orderData.items.length > 0 ? orderData.items : []);
      if (resolvedLineItems.length === 0) errors.push('line_items required (non-empty array)');
      const resolvedTotal = orderData.total_price || orderData.total || 0;
      if (!resolvedTotal || resolvedTotal <= 0) errors.push('total_price required (> 0)');
      if (orderData.payment_status !== 'paid') errors.push('payment_status must be "paid"');
      const hasStripeId = orderData.stripe_checkout_session_id || orderData.stripe_payment_intent_id || orderData.order_intent_id;
      if (!hasStripeId) errors.push('At least one of stripe_checkout_session_id, stripe_payment_intent_id, or order_intent_id required');

      if (errors.length > 0) {
        console.warn('[RECEIVE-CUSTOMER-EVENT] order.created validation failed:', errors);
        return Response.json({ status: 'rejected', reason: 'validation_failed', errors }, { status: 400 });
      }

      const incomingData = {
        shopify_order_number: orderData.order_number,
        customer_name: orderData.customer_name || '',
        customer_email: orderData.customer_email,
        customer_phone: orderData.customer_phone || '',
        address_line1: orderData.address_line1 || '',
        address_line2: orderData.address_line2 || '',
        address_city: orderData.address_city || '',
        address_state: orderData.address_state || '',
        address_postal_code: orderData.address_postal_code || '',
        address_country: orderData.address_country || 'US',
        line_items: resolvedLineItems,
        total_price: resolvedTotal,
        subtotal: orderData.subtotal || resolvedTotal,
        payment_status: 'paid',
        fulfillment_method: orderData.fulfillment_method || 'delivery',
        fulfillment_mode: 'single_delivery',
        order_type: 'one_time',
        delivery_notes: orderData.delivery_notes || '',
        customer_notes: orderData.customer_notes || '',
        requested_delivery_date: orderData.requested_delivery_date || orderData.assigned_delivery_date || '',
        selected_delivery_date: orderData.selected_delivery_date || orderData.assigned_delivery_date || null,
        assigned_delivery_date: orderData.assigned_delivery_date || orderData.selected_delivery_date || null,
        delivery_window_label: orderData.delivery_window_label || '5 PM – 8 PM',
        stripe_checkout_session_id: orderData.stripe_checkout_session_id || null,
        stripe_payment_intent_id: orderData.stripe_payment_intent_id || null,
        stripe_customer_id: orderData.stripe_customer_id || null,
        source_channel: 'online',
        source_type: orderData.stripe_checkout_session_id ? 'stripe_checkout' : orderData.stripe_payment_intent_id ? 'stripe_payment_intent' : 'customer_app',
        sync_status: 'synced',
        last_sync_at: new Date().toISOString(),
        customer_order_date: orderData.created_at || new Date().toISOString(),
        production_status: 'awaiting_production',
        order_lock_status: 'verified',
        data_quality_status: 'complete',
      };

      // Auto-generate shopify_order_id
      if (orderData.stripe_checkout_session_id) {
        incomingData.shopify_order_id = `stripe_checkout:${orderData.stripe_checkout_session_id}`;
      } else if (orderData.stripe_payment_intent_id) {
        incomingData.shopify_order_id = `stripe_payment_intent:${orderData.stripe_payment_intent_id}`;
      } else {
        incomingData.shopify_order_id = `customer_app:${orderData.order_number}`;
      }

      const matchBy = {};
      if (orderData.stripe_checkout_session_id) matchBy.stripe_checkout_session_id = orderData.stripe_checkout_session_id;
      if (orderData.stripe_payment_intent_id) matchBy.stripe_payment_intent_id = orderData.stripe_payment_intent_id;
      if (orderData.order_intent_id) matchBy.order_intent_id = orderData.order_intent_id;
      matchBy.shopify_order_number = orderData.order_number;

      console.log('[RECEIVE-CUSTOMER-EVENT] Routing order.created to safeSyncOrderUpdate:', {
        order_number: orderData.order_number,
        stripe_payment_intent_id: orderData.stripe_payment_intent_id,
        stripe_checkout_session_id: orderData.stripe_checkout_session_id,
        customer_email: orderData.customer_email,
      });

      const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');
      const safeResult = await base44.asServiceRole.functions.invoke('safeSyncOrderUpdate', {
        incomingData,
        source: 'customer_app',
        stripeEventId: orderData.stripe_checkout_session_id || orderData.stripe_payment_intent_id || null,
        matchBy,
        _internalSecret: internalSecret,
      });

      const { status: safeStatus, action, order_id } = safeResult?.data || {};
      console.log('[RECEIVE-CUSTOMER-EVENT] safeSyncOrderUpdate result:', { status: safeStatus, action, order_id });

      if (safeStatus === 'success') {
        return Response.json({
          status: 'success',
          action: action || 'created',
          hub_order_id: order_id,
          order_id,
          order_number: orderData.order_number,
        }, { status: 200 });
      } else if (safeStatus === 'skipped') {
        // Dedupe — order already exists, find its hub_order_id
        let existingId = order_id;
        if (!existingId) {
          const found = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_number: orderData.order_number });
          existingId = found?.[0]?.id || null;
        }
        return Response.json({
          status: 'success',
          action: 'dedupe_exact_match',
          hub_order_id: existingId,
          order_id: existingId,
          order_number: orderData.order_number,
          reason: 'Idempotent duplicate — order already exists in Hub',
        }, { status: 200 });
      } else if (safeStatus === 'rejected') {
        return Response.json({
          status: 'rejected',
          action: 'rejected',
          reason: safeResult?.data?.reason || 'unknown_rejection',
          order_number: orderData.order_number,
        }, { status: 422 });
      } else {
        return Response.json({
          status: 'error',
          action: 'error',
          reason: 'gateway_error',
          order_number: orderData.order_number,
        }, { status: 500 });
      }
    }

    // ── order.refunded ──────────────────────────────────────────────────────────
    // Customer App notifies Hub of full or partial refund
    if (event === 'order.refunded') {
      if (!data?.order_number && !data?.stripe_payment_intent_id) {
        return Response.json({ error: 'Missing order_number or stripe_payment_intent_id' }, { status: 400 });
      }

      console.log(`[RECEIVE-CUSTOMER-EVENT] Processing order.refunded: ${data.order_number}, refund_amount=$${data.refund_amount}`);

      // Route to processStripeRefund with CA-provided context
      const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');
      const refundResult = await base44.asServiceRole.functions.invoke('processStripeRefund', {
        stripe_charge_id: data.stripe_charge_id || null,
        stripe_payment_intent_id: data.stripe_payment_intent_id || null,
        stripe_refund_id: data.stripe_refund_id || null,
        stripe_event_id: data.stripe_event_id || `ca_refund_${data.order_number}_${Date.now()}`,
        refund_amount: data.refund_amount || 0,
        charge_amount: data.charge_amount || data.total_price || 0,
        manual_order_number: data.order_number,
        _internalSecret: internalSecret,
      });

      const { status: refundStatus } = refundResult?.data || {};
      console.log(`[RECEIVE-CUSTOMER-EVENT] Refund cascade result: ${refundStatus}`);

      return Response.json({
        status: 'success',
        event,
        refund_status: refundStatus,
        order_number: data.order_number,
      }, { status: 200 });
    }

    // ── customer.onboarding_complete / order.status_updated / others ──────────
    // Acknowledge but no action — hub owns these states
    return Response.json({ status: 'acknowledged', event, note: 'Event received, no action required' });

  } catch (error) {
    console.error('[RECEIVE-CUSTOMER-EVENT] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});