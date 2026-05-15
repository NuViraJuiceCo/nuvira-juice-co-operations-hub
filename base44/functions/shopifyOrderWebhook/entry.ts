import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * shopifyOrderWebhook — Shopify orders/create & orders/paid webhook receiver
 *
 * Register this URL in Shopify Admin → Settings → Notifications → Webhooks:
 *   - Event: Order creation  (orders/create)
 *   - Event: Order payment   (orders/paid)
 *   - Format: JSON
 *   - URL: <this function's URL>
 *
 * Verifies X-Shopify-Hmac-Sha256 signature before processing.
 * Routes POS orders → POS ingestion path (no production/fulfillment)
 * Routes online orders → safeSyncOrderUpdate
 *
 * POS classification: source_name='pos', app_id matches POS apps, or location_id present
 */

const POS_APP_IDS = new Set(['131', '131313', 'com.jadedpixel.pos', 'shopify_pos', 'pos']);

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

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const rawBody = await req.text();
  const hmacHeader = req.headers.get('X-Shopify-Hmac-Sha256');

  // ── Signature verification ──
  if (!hmacHeader) {
    console.error('[SHOPIFY-WEBHOOK] Missing X-Shopify-Hmac-Sha256 header');
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
    console.error('[SHOPIFY-WEBHOOK] HMAC signature mismatch — rejecting');
    return Response.json({ error: 'Unauthorized — signature mismatch' }, { status: 401 });
  }

  // Respond 200 immediately so Shopify doesn't retry
  const topic = req.headers.get('X-Shopify-Topic') || 'unknown';
  const shopDomain = req.headers.get('X-Shopify-Shop-Domain') || 'unknown';
  console.log(`[SHOPIFY-WEBHOOK] Received topic=${topic} shop=${shopDomain}`);

  // Process asynchronously
  (async () => {
    try {
      const base44 = createClientFromRequest(req);
      const order = JSON.parse(rawBody);

      const orderId = String(order.id || '');
      const orderNumber = order.name || `#${order.order_number}` || orderId;
      const isPOS = classifyAsPOS(order);

      console.log(`[SHOPIFY-WEBHOOK] order=${orderNumber} id=${orderId} source_name=${order.source_name} app_id=${order.app_id} location_id=${order.location_id} isPOS=${isPOS}`);

      // ── Build line items ──
      const lineItems = (order.line_items || []).map(item => ({
        title: item.title || item.name || 'Item',
        quantity: item.quantity || 1,
        price: parseFloat(item.price || 0),
      }));

      const totalPrice = parseFloat(order.total_price || order.subtotal_price || 0);
      const subtotal = parseFloat(order.subtotal_price || order.total_price || 0);
      const customerEmail = order.email || order.customer?.email || '';
      const customerName = [
        order.billing_address?.first_name || order.customer?.first_name || '',
        order.billing_address?.last_name || order.customer?.last_name || '',
      ].join(' ').trim() || order.customer?.email || 'Walk-in Customer';
      const customerPhone = order.phone || order.billing_address?.phone || order.customer?.phone || '';

      // ── POS path ──
      if (isPOS) {
        console.log(`[SHOPIFY-WEBHOOK] Routing POS order ${orderNumber} to POS ingestion`);

        // Idempotency check
        const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_id: orderId });
        if (existing?.length > 0) {
          console.log(`[SHOPIFY-WEBHOOK] POS order ${orderNumber} already exists — skipping`);
          return;
        }
        const existingByNum = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_number: orderNumber });
        if (existingByNum?.length > 0) {
          console.log(`[SHOPIFY-WEBHOOK] POS order ${orderNumber} already exists by number — skipping`);
          return;
        }

        const posPayload = {
          shopify_order_id: orderId,
          shopify_order_number: orderNumber,
          customer_name: customerName,
          customer_email: customerEmail || `pos-${orderId}@event.nuvira.local`,
          customer_phone: customerPhone,
          address_line1: '', address_line2: '', address_city: '',
          address_state: '', address_postal_code: '', address_country: 'US',
          delivery_address: '',
          line_items: lineItems,
          total_price: totalPrice,
          subtotal: subtotal,
          payment_status: 'paid',
          fulfillment_status: 'fulfilled',
          production_status: 'not_required',
          order_lock_status: 'fulfilled',
          data_quality_status: 'complete',
          source_channel: 'pos',
          source_type: 'shopify_pos',
          order_type: 'pos',
          fulfillment_method: 'pos',
          fulfillment_mode: 'single_delivery',
          internal_notes: `POS Sale via Shopify Webhook — location_id: ${order.location_id || 'N/A'} source_name: ${order.source_name || 'pos'}`,
          tags: ['pos_sale', 'event_sale', 'no_delivery', 'no_production'],
          sync_status: 'synced',
          last_sync_at: new Date().toISOString(),
          customer_order_date: order.created_at || new Date().toISOString(),
        };

        const created = await base44.asServiceRole.entities.ShopifyOrder.create(posPayload);
        console.log(`[SHOPIFY-WEBHOOK] POS order created: ${orderNumber} → hub_id=${created.id}`);

        await base44.asServiceRole.entities.OrderSyncLog.create({
          sync_timestamp: new Date().toISOString(),
          sync_source: 'stripe_webhook', // closest available enum for Shopify
          event_type: `shopify_webhook:${topic}:pos`,
          order_id: created.id,
          order_number: orderNumber,
          customer_email: customerEmail || '',
          action: 'created',
          reason: `Shopify POS order received via webhook — source_name=${order.source_name} location_id=${order.location_id}`,
          success: true,
        }).catch(() => null);

        return;
      }

      // ── Online order path — route through safeSyncOrderUpdate ──
      console.log(`[SHOPIFY-WEBHOOK] Routing online order ${orderNumber} to safeSyncOrderUpdate`);

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
        payment_status: order.financial_status === 'paid' ? 'paid' : 'pending',
        fulfillment_status: order.fulfillment_status || '',
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
        source: 'stripe_webhook', // closest field ownership match
        matchBy: { shopify_order_id: orderId },
      });

      console.log(`[SHOPIFY-WEBHOOK] Online order ${orderNumber} synced via safeSyncOrderUpdate`);

    } catch (err) {
      console.error('[SHOPIFY-WEBHOOK] Processing error:', err.message);
    }
  })();

  return Response.json({ received: true }, { status: 200 });
});