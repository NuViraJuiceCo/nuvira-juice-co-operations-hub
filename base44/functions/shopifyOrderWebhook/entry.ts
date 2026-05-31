import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * shopifyOrderWebhook — Shopify orders/create, orders/paid, orders/updated webhook receiver
 *
 * POS classification: source_name='pos', app_id matches POS apps, or location_id present
 * POS orders are accepted with no customer name, no address, and any payment status.
 */

const POS_APP_IDS = new Set(['131', '131313', 'com.jadedpixel.pos', 'shopify_pos', 'pos']);
const ENABLE_MAY30_NATIVE_ORDER_OPS = Deno.env.get('ENABLE_MAY30_NATIVE_ORDER_OPS') === 'true';
const CUSTOMER_APP_API_URL = Deno.env.get('CUSTOMER_APP_API_URL') || '';
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET') || '';

function classifyAsPOS(order) {
  const sourceName = (order.source_name || '').toLowerCase();
  const appId = String(order.app_id || '').toLowerCase();
  const hasLocationId = !!(order.location_id);
  if (sourceName === 'pos' || sourceName.includes('pos')) return true;
  if (POS_APP_IDS.has(appId)) return true;
  if (hasLocationId) return true;
  return false;
}

async function verifyShopifyHmac(body, hmacHeader) {
  const secret = Deno.env.get('SHOPIFY_WEBHOOK_SECRET');
  if (!secret) throw new Error('SHOPIFY_WEBHOOK_SECRET not configured');
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const computed = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));
  return computed === hmacHeader;
}

// Map Shopify financial_status → Hub payment_status
function mapPaymentStatus(financialStatus) {
  const map = {
    paid: 'paid',
    partially_paid: 'paid',
    authorized: 'authorized',
    pending: 'pending',
    refunded: 'refunded',
    partially_refunded: 'refunded',
    voided: 'refunded',
  };
  return map[(financialStatus || '').toLowerCase()] || 'pending';
}

function customerAppFunctionUrl(functionName) {
  const base = CUSTOMER_APP_API_URL.replace(/\/$/, '');
  if (!base) return null;
  if (base.endsWith('/api')) return `${base}/functions/${functionName}`;
  return `${base}/api/functions/${functionName}`;
}

async function maybeMirrorPosOrderToCustomerApp({ order, orderId, orderNumber, customerName, customerEmail, customerPhone, lineItems, totalPrice, subtotal, hubPaymentStatus, sourceLabel }) {
  if (!ENABLE_MAY30_NATIVE_ORDER_OPS) return { skipped: true, reason: 'disabled' };
  const endpoint = customerAppFunctionUrl('processMay30NativeOrderOps');
  if (!endpoint || !CUSTOMER_APP_SYNC_SECRET) return { skipped: true, reason: 'customer_app_not_configured' };

  try {
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
        request_id: `shopifyOrderWebhook:${orderId || orderNumber}`,
        idempotency_key: `may30_native_order_ops:shopify_pos:${orderNumber || orderId}`,
        order: {
          id: orderId,
          shopify_order_id: orderId,
          shopify_order_number: orderNumber,
          order_number: orderNumber,
          customer_name: customerName,
          customer_email: customerEmail || `pos-${orderId || orderNumber}@nuvira.local`,
          customer_phone: customerPhone || '',
          line_items: lineItems,
          total_price: totalPrice,
          subtotal,
          payment_status: hubPaymentStatus,
          source_name: order?.source_name || 'pos',
          app_id: order?.app_id || null,
          location_id: order?.location_id || null,
          location_name: order?.location_name || null,
          event_name: order?.event_name || null,
          event_date: order?.event_date || null,
          event_location: order?.event_location || order?.location_name || null,
          order_date: order?.created_at || new Date().toISOString(),
        },
      }),
    });

    const data = await response.json().catch(() => ({}));
    console.log(`[SHOPIFY-WEBHOOK] May30 native POS mirror source=${sourceLabel} order=${orderNumber} status=${response.status} action=${data?.action || 'unknown'} success=${data?.success === true}`);
    return { attempted: true, status: response.status, success: response.ok && data?.success === true, action: data?.action || null };
  } catch (error) {
    console.warn(`[SHOPIFY-WEBHOOK] May30 native POS mirror failed safely for ${orderNumber}: ${error?.message || 'unknown error'}`);
    return { attempted: true, success: false, error_code: 'may30_native_pos_mirror_failed' };
  }
}

function uniqueTags(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map(value => (value || '').toString().trim())
    .filter(Boolean)));
}

async function cancelLinkedFulfillmentTasksForShopifyRefund(base44, orderId, orderNumber) {
  const tasks = await base44.asServiceRole.entities.FulfillmentTask.filter({ order_id: orderId }, '-created_date', 50).catch(() => []);
  let cancelled = 0;
  for (const task of tasks || []) {
    const status = String(task.status || '').toLowerCase();
    if (['cancelled', 'canceled', 'completed', 'delivered'].includes(status)) continue;
    await base44.asServiceRole.entities.FulfillmentTask.update(task.id, {
      status: 'Cancelled',
      delivery_status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      notes: `${task.notes || ''}\nCancelled by Shopify refund webhook for ${orderNumber}.`.trim(),
    });
    cancelled += 1;
  }
  return cancelled;
}

async function applyShopifyRefundToExistingOrder({ base44, existingOrder, orderNumber, orderId, topic, refundAmount, financialStatus }) {
  const now = new Date().toISOString();
  const alreadyRefunded = existingOrder.payment_status === 'refunded' &&
    ['canceled', 'cancelled', 'refunded'].includes(String(existingOrder.production_status || existingOrder.order_status || '').toLowerCase());
  const tags = uniqueTags([...(existingOrder.tags || []), 'refunded', 'excluded']);

  if (!alreadyRefunded) {
    await base44.asServiceRole.entities.ShopifyOrder.update(existingOrder.id, {
      payment_status: 'refunded',
      production_status: 'canceled',
      fulfillment_status: 'cancelled',
      order_status: 'refunded',
      operational_visibility: 'archived',
      sync_status: 'do_not_sync',
      tags,
      refunded_at: now,
      cancel_type: 'shopify_refund',
      last_sync_at: now,
      internal_notes: `${existingOrder.internal_notes || ''}\n[SHOPIFY_REFUND] ${topic} financial_status=${financialStatus || 'unknown'} amount=${refundAmount ?? 'unknown'} on ${now}`.trim(),
      audit_trail: [
        ...(existingOrder.audit_trail || []),
        {
          timestamp: now,
          action: 'ShopifyRefundWebhook',
          performed_by: 'shopifyOrderWebhook',
          before: {
            payment_status: existingOrder.payment_status || null,
            production_status: existingOrder.production_status || null,
          },
          after: { payment_status: 'refunded', production_status: 'canceled' },
          reason: `Shopify ${topic} webhook`,
        },
      ],
    });
  }

  const cancelledTasks = alreadyRefunded
    ? 0
    : await cancelLinkedFulfillmentTasksForShopifyRefund(base44, existingOrder.id, orderNumber);

  await base44.asServiceRole.entities.OrderSyncLog.create({
    sync_timestamp: now,
    sync_source: 'shopify_webhook',
    event_type: `shopify_webhook:${topic}`,
    order_id: existingOrder.id,
    order_number: orderNumber,
    customer_email: existingOrder.customer_email || '',
    action: alreadyRefunded ? 'skipped' : 'refund_processed',
    reason: alreadyRefunded
      ? 'Shopify refund webhook replay skipped; order already refunded/canceled.'
      : `Shopify refund webhook processed. Cancelled ${cancelledTasks} fulfillment tasks.`,
    success: true,
    idempotency_key: `shopify_refund:${orderId || orderNumber}:${topic}`,
  }).catch(() => null);

  console.log(`[SHOPIFY-WEBHOOK] Shopify refund ${alreadyRefunded ? 'skipped duplicate' : 'processed'} for ${orderNumber}; tasks_cancelled=${cancelledTasks}`);
  return { alreadyRefunded, cancelledTasks };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const rawBody = await req.text();
  const hmacHeader = req.headers.get('X-Shopify-Hmac-Sha256');
  const topic = req.headers.get('X-Shopify-Topic') || 'unknown';
  const shopDomain = req.headers.get('X-Shopify-Shop-Domain') || 'unknown';

  console.log(`[SHOPIFY-WEBHOOK] Received POST — topic=${topic} shop=${shopDomain} hmac_present=${!!hmacHeader} body_length=${rawBody.length}`);

  // ── Signature verification ──
  if (!hmacHeader) {
    console.error('[SHOPIFY-WEBHOOK] REJECTED — missing X-Shopify-Hmac-Sha256 header');
    return Response.json({ error: 'Unauthorized — missing HMAC' }, { status: 401 });
  }

  let verified = false;
  try {
    verified = await verifyShopifyHmac(rawBody, hmacHeader);
  } catch (err) {
    console.error('[SHOPIFY-WEBHOOK] HMAC verification error:', err.message);
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!verified) {
    console.error('[SHOPIFY-WEBHOOK] REJECTED — HMAC signature mismatch. Check SHOPIFY_WEBHOOK_SECRET matches Shopify signing secret exactly.');
    return Response.json({ error: 'Unauthorized — signature mismatch' }, { status: 401 });
  }

  console.log(`[SHOPIFY-WEBHOOK] HMAC verified OK — topic=${topic}`);

  let processingError = null;

  await (async () => {
    try {
      const base44 = createClientFromRequest(req);
      const order = JSON.parse(rawBody);

      const orderId = String(order.id || '');
      const orderNumber = order.name || `#${order.order_number}` || orderId;
      const financialStatus = order.financial_status || '';
      const fulfillmentStatus = order.fulfillment_status || '';
      const isPOS = classifyAsPOS(order);

      // Build customer info — POS orders may have none
      const customerEmail = order.email || order.customer?.email || '';
      const firstName = order.billing_address?.first_name || order.shipping_address?.first_name || order.customer?.first_name || '';
      const lastName = order.billing_address?.last_name || order.shipping_address?.last_name || order.customer?.last_name || '';
      const customerName = [firstName, lastName].join(' ').trim() || (isPOS ? 'POS Customer' : customerEmail || 'Unknown');
      const customerPhone = order.phone || order.billing_address?.phone || order.shipping_address?.phone || order.customer?.phone || '';

      const lineItems = (order.line_items || []).map(item => ({
        title: item.title || item.name || 'Item',
        quantity: item.quantity || 1,
        price: parseFloat(item.price || 0),
      }));

      const totalPrice = parseFloat(order.total_price || order.subtotal_price || 0);
      const subtotal = parseFloat(order.subtotal_price || order.total_price || 0);
      const hubPaymentStatus = mapPaymentStatus(financialStatus);

      console.log(`[SHOPIFY-WEBHOOK] Processing order=${orderNumber} id=${orderId} financial_status=${financialStatus} fulfillment_status=${fulfillmentStatus} isPOS=${isPOS} customer="${customerName}" email="${customerEmail}" items=${lineItems.length} total=${totalPrice}`);

      // ── Idempotency: check existing by Shopify order ID ──
      const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_id: orderId });
      const existingOrder = existing?.[0] || null;

      if (topic === 'orders/refunded' || hubPaymentStatus === 'refunded') {
        if (existingOrder) {
          await applyShopifyRefundToExistingOrder({
            base44,
            existingOrder,
            orderNumber,
            orderId,
            topic,
            refundAmount: totalPrice,
            financialStatus,
          });
        } else {
          console.warn(`[SHOPIFY-WEBHOOK] Refund received for unknown Shopify order ${orderNumber}; queued safe sync log only`);
          await base44.asServiceRole.entities.OrderSyncLog.create({
            sync_timestamp: new Date().toISOString(),
            sync_source: 'shopify_webhook',
            event_type: `shopify_webhook:${topic}`,
            order_number: orderNumber,
            customer_email: customerEmail || '',
            action: 'rejected',
            reason: 'Shopify refund webhook received before operational order record existed.',
            success: false,
            error_code: 'shopify_refund_order_not_found',
            idempotency_key: `shopify_refund:${orderId || orderNumber}:${topic}:missing`,
          }).catch(() => null);
        }
        return;
      }

      // ── POS path ──
      if (isPOS) {
        if (existingOrder) {
          // Update payment status if it changed (e.g. authorized → paid)
          if (existingOrder.payment_status !== hubPaymentStatus && hubPaymentStatus === 'paid') {
            await base44.asServiceRole.entities.ShopifyOrder.update(existingOrder.id, {
              payment_status: 'paid',
              last_sync_at: new Date().toISOString(),
            });
            console.log(`[SHOPIFY-WEBHOOK] POS order ${orderNumber} payment updated to paid`);
          } else {
            console.log(`[SHOPIFY-WEBHOOK] POS order ${orderNumber} already exists (id=${existingOrder.id}) — skipping duplicate`);
          }
          await maybeMirrorPosOrderToCustomerApp({
            order,
            orderId,
            orderNumber,
            customerName,
            customerEmail,
            customerPhone,
            lineItems,
            totalPrice,
            subtotal,
            hubPaymentStatus,
            sourceLabel: 'shopify_webhook_existing',
          });
          return;
        }

        // Create new POS order — no address or customer name required
        const posPayload = {
          shopify_order_id: orderId,
          shopify_order_number: orderNumber,
          customer_name: customerName,
          customer_email: customerEmail || `pos-${orderId}@nuvira.local`,
          customer_phone: customerPhone,
          // No address for POS — intentionally blank
          address_line1: '', address_line2: '', address_city: '',
          address_state: '', address_postal_code: '', address_country: 'US',
          delivery_address: '',
          line_items: lineItems,
          total_price: totalPrice,
          subtotal: subtotal,
          payment_status: hubPaymentStatus,
          fulfillment_status: 'fulfilled',
          production_status: 'not_required',
          order_lock_status: 'fulfilled',
          data_quality_status: 'complete',
          source_channel: 'pos',
          source_type: 'shopify_pos',
          order_type: 'pos',
          fulfillment_method: 'pos',
          fulfillment_mode: 'single_delivery',
          internal_notes: `POS Sale via Shopify Webhook | location_id: ${order.location_id || 'N/A'} | source_name: ${order.source_name || 'pos'} | financial_status: ${financialStatus}`,
          tags: ['pos_sale', 'event_sale', 'no_delivery', 'no_production'],
          sync_status: 'synced',
          last_sync_at: new Date().toISOString(),
          customer_order_date: order.created_at || new Date().toISOString(),
        };

        const created = await base44.asServiceRole.entities.ShopifyOrder.create(posPayload);
        console.log(`[SHOPIFY-WEBHOOK] POS order CREATED: ${orderNumber} → hub_id=${created.id} payment_status=${hubPaymentStatus}`);

        await maybeMirrorPosOrderToCustomerApp({
          order,
          orderId,
          orderNumber,
          customerName,
          customerEmail,
          customerPhone,
          lineItems,
          totalPrice,
          subtotal,
          hubPaymentStatus,
          sourceLabel: 'shopify_webhook_created',
        });

        await base44.asServiceRole.entities.OrderSyncLog.create({
          sync_timestamp: new Date().toISOString(),
          sync_source: 'stripe_webhook',
          event_type: `shopify_webhook:${topic}:pos`,
          order_id: created.id,
          order_number: orderNumber,
          customer_email: customerEmail || '',
          action: 'created',
          reason: `Shopify POS order via webhook — source_name=${order.source_name} location_id=${order.location_id} financial_status=${financialStatus}`,
          success: true,
        }).catch(() => null);

        return;
      }

      // ── Online order path ──
      console.log(`[SHOPIFY-WEBHOOK] Online order ${orderNumber} — routing to safeSyncOrderUpdate`);

      const shippingAddr = order.shipping_address || order.billing_address || {};
      const onlinePayload = {
        shopify_order_id: orderId,
        shopify_order_number: orderNumber,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        line_items: lineItems,
        total_price: totalPrice,
        subtotal: subtotal,
        payment_status: hubPaymentStatus,
        fulfillment_status: fulfillmentStatus,
        source_channel: 'online',
        source_type: 'stripe_checkout',
        order_type: 'one_time',
        fulfillment_mode: 'single_delivery',
        fulfillment_method: 'delivery',
        address_line1: shippingAddr.address1 || '',
        address_line2: shippingAddr.address2 || '',
        address_city: shippingAddr.city || '',
        address_state: shippingAddr.province || '',
        address_postal_code: shippingAddr.zip || '',
        address_country: shippingAddr.country_code || 'US',
        address_last_synced_from: 'shopify_webhook',
        address_last_synced_at: new Date().toISOString(),
        sync_status: 'synced',
        last_sync_at: new Date().toISOString(),
        customer_order_date: order.created_at || new Date().toISOString(),
      };

      const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');
      await base44.asServiceRole.functions.invoke('safeSyncOrderUpdate', {
        _internalSecret: internalSecret,
        incomingData: onlinePayload,
        source: 'stripe_webhook',
        matchBy: { shopify_order_id: orderId },
      });

      console.log(`[SHOPIFY-WEBHOOK] Online order ${orderNumber} synced OK`);

  } catch (err) {
    processingError = err;
    console.error('[SHOPIFY-WEBHOOK] Processing error:', err.message, err.stack);
  }
  })();

  if (processingError) {
    return Response.json({
      received: false,
      error: 'processing_failed',
      retryable: true,
    }, { status: 500 });
  }

  return Response.json({ received: true }, { status: 200 });
});
