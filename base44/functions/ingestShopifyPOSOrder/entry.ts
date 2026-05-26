import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * ingestShopifyPOSOrder — Dedicated POS / Event Sale Ingestion Endpoint
 *
 * Handles Shopify POS orders from live events. POS sales are:
 *   - COMPLETED on-site at time of sale (no delivery, no production demand)
 *   - Stored for revenue reporting, inventory reconciliation, and audit
 *   - NOT routed through fulfillment, production planning, or driver portal
 *
 * Classification rules (any match → POS):
 *   - source_name === 'pos' or contains 'pos'
 *   - app_id matches Shopify POS apps
 *   - location_id present (POS location)
 *   - channel === 'pos'
 *
 * Security: CUSTOMER_APP_SYNC_SECRET or INTERNAL_FUNCTION_SECRET
 */

const POS_APP_IDS = new Set([
  'shopify_pos',
  'com.jadedpixel.pos',
  'pos',
  '131', // Shopify POS numeric app ID
  '131313', // Shopify POS Go
]);
const ENABLE_MAY30_NATIVE_ORDER_OPS = Deno.env.get('ENABLE_MAY30_NATIVE_ORDER_OPS') === 'true';
const CUSTOMER_APP_API_URL = Deno.env.get('CUSTOMER_APP_API_URL') || '';
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET') || '';

function classifyAsPOS(payload) {
  const sourceName = (payload.source_name || '').toLowerCase();
  const appId = (payload.app_id || '').toLowerCase();
  const channel = (payload.channel || payload.sales_channel || payload.source_channel || '').toLowerCase();
  const hasLocationId = !!(payload.location_id || payload.pos_location_id);

  if (sourceName === 'pos' || sourceName.includes('pos')) return true;
  if (POS_APP_IDS.has(appId)) return true;
  if (channel === 'pos' || channel === 'pos_sale' || channel === 'event_pos') return true;
  if (hasLocationId) return true;

  return false;
}

function customerAppFunctionUrl(functionName) {
  const base = CUSTOMER_APP_API_URL.replace(/\/$/, '');
  if (!base) return null;
  if (base.endsWith('/api')) return `${base}/functions/${functionName}`;
  return `${base}/api/functions/${functionName}`;
}

async function maybeMirrorPosOrderToCustomerApp({ body, orderNumber, customerName, customerEmail, customerPhone, lineItems, totalPrice, subtotal, paymentStatus, sourceLabel }) {
  if (!ENABLE_MAY30_NATIVE_ORDER_OPS) return { skipped: true, reason: 'disabled' };
  const endpoint = customerAppFunctionUrl('processMay30NativeOrderOps');
  if (!endpoint || !CUSTOMER_APP_SYNC_SECRET) return { skipped: true, reason: 'customer_app_not_configured' };

  try {
    const shopifyOrderId = body.shopify_order_id || `pos:${orderNumber}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
      body: JSON.stringify({
        mode: 'live',
        source: 'shopify_pos',
        event_type: 'pos.order.created',
        request_id: `ingestShopifyPOSOrder:${shopifyOrderId || orderNumber}`,
        idempotency_key: `may30_native_order_ops:shopify_pos:${orderNumber || shopifyOrderId}`,
        order: {
          id: shopifyOrderId,
          shopify_order_id: shopifyOrderId,
          shopify_order_number: orderNumber,
          order_number: orderNumber,
          customer_name: customerName || 'POS Customer',
          customer_email: customerEmail || `pos-${orderNumber}@event.nuvira.local`,
          customer_phone: customerPhone || '',
          line_items: lineItems || [],
          total_price: totalPrice,
          subtotal: subtotal || totalPrice,
          payment_status: paymentStatus || 'paid',
          source_name: body.source_name || 'pos',
          app_id: body.app_id || null,
          location_id: body.location_id || body.pos_location_id || null,
          location_name: body.pos_location_name || body.event_name || null,
          event_name: body.event_name || null,
          event_id: body.event_id || null,
          event_location: body.pos_location_name || body.event_name || null,
          order_date: body.order_date || new Date().toISOString(),
        },
      }),
    });

    const data = await response.json().catch(() => ({}));
    console.log(`[POS-INGEST] May30 native POS mirror source=${sourceLabel} order=${orderNumber} status=${response.status} action=${data?.action || 'unknown'} success=${data?.success === true}`);
    return { attempted: true, status: response.status, success: response.ok && data?.success === true, action: data?.action || null };
  } catch (error) {
    console.warn(`[POS-INGEST] May30 native POS mirror failed safely for ${orderNumber}: ${error?.message || 'unknown error'}`);
    return { attempted: true, success: false, error_code: 'may30_native_pos_mirror_failed' };
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);

    const authHeader = req.headers.get('Authorization');
    const providedSecret = authHeader?.replace('Bearer ', '').trim();
    const expectedSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
    const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');

    const body = await req.json();

    const isAuth = (providedSecret && expectedSecret && providedSecret === expectedSecret) ||
                   (body._internalSecret && internalSecret && body._internalSecret === internalSecret);

    if (!isAuth) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      order_number,
      customer_name,
      customer_email,
      customer_phone,
      line_items,
      total_price,
      subtotal,
      payment_status,
      source_name,
      app_id,
      location_id,
      pos_location_id,
      pos_location_name,
      event_name,
      event_id,
      channel,
      shopify_order_id,
      order_date,
      notes,
    } = body;

    // Validation
    const errors = [];
    if (!order_number) errors.push('order_number required');
    if (!customer_email && !customer_name) errors.push('customer_email or customer_name required');
    if (!line_items || !Array.isArray(line_items) || line_items.length === 0) errors.push('line_items required');
    if (!total_price || total_price <= 0) errors.push('total_price required (> 0)');

    if (errors.length > 0) {
      return Response.json({ status: 'rejected', reason: 'validation_failed', errors }, { status: 400 });
    }

    // Force POS classification
    const isPOS = classifyAsPOS(body);
    const resolvedSourceName = source_name || 'pos';
    const resolvedLocationId = location_id || pos_location_id || null;
    const resolvedLocationName = pos_location_name || event_name || 'Event POS';

    console.log(`[POS-INGEST] Processing POS order ${order_number} — classified_as_pos=${isPOS} source_name=${resolvedSourceName} location_id=${resolvedLocationId}`);

    // Idempotency: check if order already exists
    let existingOrder = null;
    if (shopify_order_id) {
      const byId = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_id });
      if (byId?.length > 0) existingOrder = byId[0];
    }
    if (!existingOrder && order_number) {
      const byNum = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_number: order_number });
      if (byNum?.length > 0) existingOrder = byNum[0];
    }

    if (existingOrder) {
      console.log(`[POS-INGEST] Duplicate POS order ${order_number} already exists as ${existingOrder.id}`);
      await maybeMirrorPosOrderToCustomerApp({
        body,
        orderNumber: order_number,
        customerName: customer_name || existingOrder.customer_name || 'Walk-in Customer',
        customerEmail: customer_email || existingOrder.customer_email || '',
        customerPhone: customer_phone || existingOrder.customer_phone || '',
        lineItems: line_items || existingOrder.line_items || [],
        totalPrice: total_price || existingOrder.total_price || 0,
        subtotal: subtotal || existingOrder.subtotal || total_price || 0,
        paymentStatus: payment_status || existingOrder.payment_status || 'paid',
        sourceLabel: 'manual_ingest_existing',
      });
      return Response.json({
        status: 'success',
        action: 'dedupe_exact_match',
        hub_order_id: existingOrder.id,
        order_number,
        message: 'POS order already exists in Hub',
      }, { status: 200 });
    }

    // Build POS order payload
    const posPayload = {
      shopify_order_id: shopify_order_id || `pos:${order_number}`,
      shopify_order_number: order_number,
      customer_name: customer_name || 'Walk-in Customer',
      customer_email: customer_email || `pos-${order_number}@event.nuvira.local`,
      customer_phone: customer_phone || '',

      // POS has no delivery address
      address_line1: '',
      address_line2: '',
      address_city: '',
      address_state: '',
      address_postal_code: '',
      address_country: 'US',
      delivery_address: '',

      line_items: line_items || [],
      total_price: total_price,
      subtotal: subtotal || total_price,

      // POS is always paid and fulfilled at point of sale
      payment_status: 'paid',
      fulfillment_status: 'fulfilled',

      // POS orders do NOT create production demand or delivery workflows
      production_status: 'not_required',
      order_lock_status: 'fulfilled',
      data_quality_status: 'complete',

      // Channel and type
      source_channel: 'pos',
      source_type: 'shopify_pos',
      order_type: 'pos',
      fulfillment_method: 'pos',
      fulfillment_mode: 'single_delivery', // not meaningful for POS but required field

      // POS metadata
      internal_notes: [
        `POS Sale — ${resolvedLocationName}`,
        resolvedLocationId ? `Location ID: ${resolvedLocationId}` : null,
        event_id ? `Event ID: ${event_id}` : null,
        notes || null,
      ].filter(Boolean).join(' | '),
      tags: ['pos_sale', 'event_sale', 'no_delivery', 'no_production'],

      // No delivery scheduling needed
      requires_delivery: false,
      requires_production: false,
      requires_fulfillment_task: false,

      // Sync metadata
      sync_status: 'synced',
      last_sync_at: new Date().toISOString(),
      customer_order_date: order_date || new Date().toISOString(),
    };

    // Create the order via service role (bypasses field ownership on creation)
    const createdOrder = await base44.asServiceRole.entities.ShopifyOrder.create(posPayload);

    console.log(`[POS-INGEST] Created POS order ${order_number} → hub_id=${createdOrder.id} location="${resolvedLocationName}"`);

    await maybeMirrorPosOrderToCustomerApp({
      body,
      orderNumber: order_number,
      customerName: customer_name || 'Walk-in Customer',
      customerEmail: customer_email || `pos-${order_number}@event.nuvira.local`,
      customerPhone: customer_phone || '',
      lineItems: line_items || [],
      totalPrice: total_price,
      subtotal: subtotal || total_price,
      paymentStatus: 'paid',
      sourceLabel: 'manual_ingest_created',
    });

    // Log the sync
    await base44.asServiceRole.entities.OrderSyncLog.create({
      sync_timestamp: new Date().toISOString(),
      sync_source: 'manual_recovery',
      event_type: 'pos_order_ingested',
      order_id: createdOrder.id,
      order_number,
      customer_email: customer_email || '',
      action: 'created',
      reason: `POS order ingested via ingestShopifyPOSOrder — ${resolvedLocationName}`,
      success: true,
    }).catch(() => null);

    return Response.json({
      status: 'success',
      action: 'created',
      hub_order_id: createdOrder.id,
      order_number,
      classified_as: 'shopify_pos',
      location: resolvedLocationName,
      production_status: 'not_required',
      fulfillment_status: 'fulfilled',
      requires_delivery: false,
      requires_production: false,
      message: 'POS order stored for reporting. No production, delivery, or fulfillment tasks created.',
    }, { status: 200 });

  } catch (error) {
    console.error('[POS-INGEST] Error:', error.message);
    return Response.json({ status: 'error', reason: 'server_error', message: error.message }, { status: 500 });
  }
});
