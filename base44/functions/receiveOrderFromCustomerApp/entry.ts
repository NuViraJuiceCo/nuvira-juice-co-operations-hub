import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * receiveOrderFromCustomerApp — Rehabilitated endpoint (was deprecated 2026-04-26)
 *
 * Root cause of 405: Previously this endpoint returned 410 for POST and 405 for all other methods.
 * Customer App still calls this URL after every paid checkout.
 *
 * Fix: This endpoint now accepts POST and transparently proxies to ingestCustomerAppOrder
 * which routes all writes through safeSyncOrderUpdate with full idempotency and lock protection.
 *
 * No Customer App changes required.
 */

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  // Authenticate
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token || token !== SYNC_SECRET) {
    console.warn('[RECEIVE-ORDER] Unauthorized request — invalid or missing Bearer token');
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    console.log('[RECEIVE-ORDER] Received order sync request:', {
      order_number: body.order_number,
      stripe_checkout_session_id: body.stripe_checkout_session_id,
      stripe_payment_intent_id: body.stripe_payment_intent_id,
      customer_email: body.customer_email,
      total_price: body.total_price,
    });

    // ── VALIDATION ────────────────────────────────────────────────────────────
    const errors = [];
    if (!body.order_number) errors.push('order_number required');
    if (!body.customer_email) errors.push('customer_email required');
    if (!body.line_items || !Array.isArray(body.line_items) || body.line_items.length === 0) {
      errors.push('line_items required (non-empty array)');
    }
    if (!body.total_price || body.total_price <= 0) errors.push('total_price required (> 0)');
    if (body.payment_status !== 'paid') errors.push('payment_status must be "paid"');
    if (!body.stripe_checkout_session_id && !body.stripe_payment_intent_id && !body.order_intent_id) {
      errors.push('At least one idempotency key required: stripe_checkout_session_id, stripe_payment_intent_id, or order_intent_id');
    }

    if (errors.length > 0) {
      console.warn('[RECEIVE-ORDER] Validation failed:', errors);
      return Response.json({ status: 'rejected', reason: 'validation_failed', errors }, { status: 400 });
    }

    // ── BUILD INCOMING DATA ───────────────────────────────────────────────────
    const incomingData = {
      shopify_order_number: body.order_number,
      customer_name: body.customer_name || '',
      customer_email: body.customer_email,
      customer_phone: body.customer_phone || '',
      address_line1: body.address_line1 || '',
      address_line2: body.address_line2 || '',
      address_city: body.address_city || '',
      address_state: body.address_state || '',
      address_postal_code: body.address_postal_code || '',
      address_country: body.address_country || 'US',
      delivery_address: body.delivery_address || `${body.address_line1 || ''}, ${body.address_city || ''}, ${body.address_state || ''} ${body.address_postal_code || ''}`.trim(),
      line_items: body.line_items || [],
      total_price: body.total_price,
      subtotal: body.subtotal || body.total_price,
      payment_status: 'paid',
      fulfillment_method: body.fulfillment_method || 'delivery',
      fulfillment_mode: body.fulfillment_mode || 'single_delivery',
      delivery_notes: body.delivery_notes || '',
      customer_notes: body.customer_notes || '',
      requested_delivery_date: body.requested_delivery_date || '',
      stripe_checkout_session_id: body.stripe_checkout_session_id || null,
      stripe_payment_intent_id: body.stripe_payment_intent_id || null,
      stripe_customer_id: body.stripe_customer_id || null,
      source_channel: 'online',
      source_type: body.stripe_checkout_session_id ? 'stripe_checkout' : 'stripe_payment',
      order_type: body.order_type || 'one_time',
      sync_status: 'synced',
      last_sync_at: new Date().toISOString(),
      customer_order_date: body.created_at || new Date().toISOString(),
      production_status: 'new',
      data_quality_status: 'complete',
    };

    // ── IDEMPOTENCY MATCH KEYS ────────────────────────────────────────────────
    const matchBy = {};
    if (body.stripe_checkout_session_id) matchBy.stripe_checkout_session_id = body.stripe_checkout_session_id;
    if (body.stripe_payment_intent_id) matchBy.stripe_payment_intent_id = body.stripe_payment_intent_id;
    if (body.order_intent_id) matchBy.order_intent_id = body.order_intent_id;
    matchBy.shopify_order_number = body.order_number;

    // ── ROUTE THROUGH SAFESYNCORDERUPDATE ────────────────────────────────────
    const safeResult = await base44.asServiceRole.functions.invoke('safeSyncOrderUpdate', {
      incomingData,
      source: 'customer_app',
      stripeEventId: body.stripe_checkout_session_id || body.stripe_payment_intent_id || body.order_intent_id || null,
      matchBy,
    });

    const { status: safeStatus, action, order_id } = safeResult?.data || {};

    console.log('[RECEIVE-ORDER] safeSyncOrderUpdate result:', { status: safeStatus, action, order_id });

    if (safeStatus === 'success') {
      // If a new order was created, write address snapshot back and create FulfillmentTask
      if (action === 'created' && order_id) {
        const hasAddress = !!(body.address_line1 && body.address_city);
        const fullAddressStr = [body.address_line1, body.address_line2, body.address_city, body.address_state, body.address_postal_code]
          .filter(Boolean).join(', ');

        const postCreateTasks = [];

        // Atomic address snapshot write-back to ShopifyOrder
        if (hasAddress) {
          postCreateTasks.push(
            base44.asServiceRole.entities.ShopifyOrder.update(order_id, {
              address_line1: body.address_line1 || '',
              address_line2: body.address_line2 || '',
              address_city: body.address_city || '',
              address_state: body.address_state || '',
              address_postal_code: body.address_postal_code || '',
              address_country: body.address_country || 'US',
              delivery_address: fullAddressStr,
              address_last_synced_from: 'receive_order_from_customer_app',
              address_last_synced_at: new Date().toISOString(),
            }).catch(err => console.warn('[RECEIVE-ORDER] Address snapshot write-back failed:', err.message))
          );
        }

        // Create FulfillmentTask if delivery date is present
        const deliveryDate = body.selected_delivery_date || body.requested_delivery_date || body.assigned_delivery_date;
        if (deliveryDate && (body.fulfillment_method || 'delivery') === 'delivery') {
          const itemsSummary = (body.line_items || []).map(i => `${i.quantity}x ${i.title}`).join(', ');
          postCreateTasks.push(
            base44.asServiceRole.entities.FulfillmentTask.create({
              customer_name: body.customer_name || body.customer_email,
              customer_email: body.customer_email || '',
              customer_phone: body.customer_phone || '',
              fulfillment_type: 'Delivery',
              time_window: body.delivery_window_label || '5 PM – 8 PM',
              delivery_window_label: body.delivery_window_label || '5 PM – 8 PM',
              status: 'Scheduled',
              scheduled_date: deliveryDate,
              address: fullAddressStr,
              address_line1: body.address_line1 || '',
              address_line2: body.address_line2 || '',
              address_city: body.address_city || '',
              address_state: body.address_state || '',
              address_postal_code: body.address_postal_code || '',
              delivery_address: fullAddressStr,
              items_summary: itemsSummary,
              order_id: order_id,
              order_number: body.order_number,
              source_type: 'order_derived',
              notes: `One-time order auto-fulfillment task created from customer_app checkout`,
            }).catch(err => console.warn('[RECEIVE-ORDER] FulfillmentTask creation failed:', err.message))
          );
        }

        await Promise.all(postCreateTasks);
      }

      return Response.json({
        status: 'success',
        action: action || 'created',
        order_id,
        order_number: body.order_number,
      }, { status: 200 });
    } else if (safeStatus === 'skipped' && action === 'duplicate_event') {
      return Response.json({
        status: 'success',
        action: 'duplicate_skipped',
        order_id,
        order_number: body.order_number,
        reason: 'Idempotent duplicate — order already synced',
      }, { status: 200 });
    } else if (safeStatus === 'rejected') {
      return Response.json({
        status: 'rejected',
        reason: safeResult?.data?.reason || 'unknown_rejection',
        order_number: body.order_number,
      }, { status: 422 });
    } else {
      console.error('[RECEIVE-ORDER] Unexpected safeSyncOrderUpdate response:', safeResult?.data);
      return Response.json({
        status: 'error',
        reason: 'gateway_error',
        message: 'safeSyncOrderUpdate returned unexpected response',
      }, { status: 500 });
    }

  } catch (error) {
    console.error('[RECEIVE-ORDER] Error:', error.message);
    return Response.json({
      status: 'error',
      reason: 'server_error',
      message: error.message,
    }, { status: 500 });
  }
});