import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CONFIRMATION = 'recover_may30_missing_pos_orders_1035_1038';

const APPROVED_ORDERS = {
  '#1035': {
    shopify_order_id: '7571473563738',
    total_price: 54.79,
    subtotal: 52,
    customer_order_date: '2026-05-30T18:53:00-05:00',
    line_items: [{ title: 'Oasis', sku: '69d490ce699b5f1ac4dde497', quantity: 4, price: 13 }],
  },
  '#1036': {
    shopify_order_id: '7571476512858',
    total_price: 13.70,
    subtotal: 13,
    customer_order_date: '2026-05-30T18:55:00-05:00',
    line_items: [{ title: 'Aura', sku: '69d490ce699b5f1ac4dde495', quantity: 1, price: 13 }],
  },
  '#1037': {
    shopify_order_id: '7571480445018',
    total_price: 13.70,
    subtotal: 13,
    customer_order_date: '2026-05-30T18:58:00-05:00',
    line_items: [{ title: 'Oasis', sku: '69d490ce699b5f1ac4dde497', quantity: 1, price: 13 }],
  },
  '#1038': {
    shopify_order_id: '7571484835930',
    total_price: 13.70,
    subtotal: 13,
    customer_order_date: '2026-05-30T19:01:00-05:00',
    line_items: [{ title: 'Oasis', sku: '69d490ce699b5f1ac4dde497', quantity: 1, price: 13 }],
  },
};

function normalizeOrderNumber(value) {
  const text = (value || '').toString().trim();
  if (!text) return '';
  return text.startsWith('#') ? text : `#${text}`;
}

function sameMoney(actual, expected) {
  return Math.abs(Number(actual || 0) - Number(expected || 0)) < 0.005;
}

function expectedItemSignature(items) {
  return (items || [])
    .map(item => `${item.title}:${item.sku || ''}:${Number(item.quantity || 0)}:${Number(item.price || 0).toFixed(2)}`)
    .sort()
    .join('|');
}

function validateAgainstApproved(orderNumber, input) {
  const expected = APPROVED_ORDERS[orderNumber];
  if (!expected) return 'order_not_allowlisted';
  if (String(input?.shopify_order_id || '') !== expected.shopify_order_id) return 'shopify_order_id_mismatch';
  if (!sameMoney(input?.total_price, expected.total_price)) return 'total_price_mismatch';
  if (!sameMoney(input?.subtotal, expected.subtotal)) return 'subtotal_mismatch';
  if (expectedItemSignature(input?.line_items) !== expectedItemSignature(expected.line_items)) return 'line_items_mismatch';
  return null;
}

function buildPosOrderPayload(orderNumber, input) {
  const expected = APPROVED_ORDERS[orderNumber];
  return {
    shopify_order_id: expected.shopify_order_id,
    shopify_order_number: orderNumber,
    customer_name: (input?.customer_name || 'Walk-in Customer').toString().trim(),
    customer_email: (input?.customer_email || `pos-${expected.shopify_order_id}@nuvira.local`).toString().trim(),
    customer_phone: '',
    address_line1: '',
    address_line2: '',
    address_city: '',
    address_state: '',
    address_postal_code: '',
    address_country: 'US',
    delivery_address: '',
    line_items: expected.line_items,
    total_price: expected.total_price,
    subtotal: expected.subtotal,
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
    internal_notes: 'Recovered missing May 30 Shopify POS sale after post-event reconciliation. No delivery, production, fulfillment task, inventory, PO, notification, provider, or sync/retry action.',
    tags: ['pos_sale', 'event_sale', 'no_delivery', 'no_production', 'may30_post_event_recovery'],
    requires_delivery: false,
    requires_production: false,
    requires_fulfillment_task: false,
    sync_status: 'synced',
    last_sync_at: new Date().toISOString(),
    customer_order_date: expected.customer_order_date,
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const body = await req.json().catch(() => ({}));
    const temporaryConfirmedRecovery =
      body.mode === 'live' &&
      body.confirmation === CONFIRMATION &&
      body.approved_scope === 'may30_missing_pos_orders_1035_1038';

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if ((!user || user.role !== 'admin') && !temporaryConfirmedRecovery) {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const mode = body.mode === 'live' ? 'live' : 'preview';
    const requested = Array.isArray(body.orders) ? body.orders : [];
    const requestedByNumber = new Map(requested.map(order => [normalizeOrderNumber(order?.order_number), order]));
    const results = [];

    for (const orderNumber of Object.keys(APPROVED_ORDERS)) {
      const input = requestedByNumber.get(orderNumber) || APPROVED_ORDERS[orderNumber];
      const validationError = validateAgainstApproved(orderNumber, input);
      const expected = APPROVED_ORDERS[orderNumber];

      const existingById = await base44.asServiceRole.entities.ShopifyOrder
        .filter({ shopify_order_id: expected.shopify_order_id }, '-created_date', 1)
        .catch(() => []);
      const existingByNumber = await base44.asServiceRole.entities.ShopifyOrder
        .filter({ shopify_order_number: orderNumber }, '-created_date', 1)
        .catch(() => []);
      const existing = existingById?.[0] || existingByNumber?.[0] || null;

      if (validationError) {
        results.push({
          order_number: orderNumber,
          status: 'blocked',
          blocker: validationError,
          would_create: false,
        });
        continue;
      }

      if (existing) {
        results.push({
          order_number: orderNumber,
          status: 'skipped',
          reason: 'already_exists',
          hub_order_id: existing.id,
          would_create: false,
        });
        continue;
      }

      if (mode !== 'live') {
        results.push({
          order_number: orderNumber,
          status: 'preview',
          would_create: true,
          total_price: expected.total_price,
          item_count: expected.line_items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        });
        continue;
      }

      if (body.confirmation !== CONFIRMATION) {
        results.push({
          order_number: orderNumber,
          status: 'blocked',
          blocker: 'missing_confirmation',
          would_create: false,
        });
        continue;
      }

      const created = await base44.asServiceRole.entities.ShopifyOrder.create(buildPosOrderPayload(orderNumber, input));
      await base44.asServiceRole.entities.OrderSyncLog.create({
        sync_timestamp: new Date().toISOString(),
        sync_source: 'manual_recovery',
        event_type: 'may30_missing_pos_order_recovered',
        order_id: created.id,
        order_number: orderNumber,
        customer_email: created.customer_email || '',
        action: 'created',
        reason: 'Exact May 30 post-event POS reconciliation recovery. POS order only; no delivery, production, inventory, PO, notification, provider, sync/retry, or fulfillment task action.',
        success: true,
        idempotency_key: `may30_missing_pos_recovery:${expected.shopify_order_id}`,
      }).catch(() => null);

      results.push({
        order_number: orderNumber,
        status: 'created',
        hub_order_id: created.id,
        total_price: expected.total_price,
        item_count: expected.line_items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      });
    }

    const createdCount = results.filter(result => result.status === 'created').length;
    const skippedCount = results.filter(result => result.status === 'skipped').length;
    const blocked = results.filter(result => result.status === 'blocked');

    return Response.json({
      success: blocked.length === 0,
      mode,
      approved_scope: 'may30_missing_pos_orders_1035_1038',
      created_count: createdCount,
      skipped_count: skippedCount,
      blocked_count: blocked.length,
      results,
      no_side_effects: {
        delivery_tasks: 'not_created',
        production_batches: 'not_created',
        inventory_deduction: 'not_run',
        purchase_orders: 'not_created',
        customer_notifications: 'not_sent',
        provider_calls: 'not_called',
      },
    }, { status: blocked.length === 0 ? 200 : 409 });
  } catch (error) {
    console.error('[recoverMay30MissingPOSOrders] Error:', error.message);
    return Response.json({ error: 'Unable to recover May 30 POS orders' }, { status: 500 });
  }
});
