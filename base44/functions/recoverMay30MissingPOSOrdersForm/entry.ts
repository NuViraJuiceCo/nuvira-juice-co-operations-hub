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

const htmlResponse = (body, status = 200) =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const itemCount = (lineItems) =>
  (lineItems || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);

async function findExistingOrder(base44, orderNumber, expected) {
  const existingById = await base44.asServiceRole.entities.ShopifyOrder
    .filter({ shopify_order_id: expected.shopify_order_id }, '-created_date', 1)
    .catch(() => []);
  const existingByNumber = await base44.asServiceRole.entities.ShopifyOrder
    .filter({ shopify_order_number: orderNumber }, '-created_date', 1)
    .catch(() => []);
  return existingById?.[0] || existingByNumber?.[0] || null;
}

function buildPosOrderPayload(orderNumber, expected) {
  return {
    shopify_order_id: expected.shopify_order_id,
    shopify_order_number: orderNumber,
    customer_name: 'Walk-in Customer',
    customer_email: `pos-${expected.shopify_order_id}@nuvira.local`,
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

async function previewOrders(base44) {
  const rows = [];

  for (const [orderNumber, expected] of Object.entries(APPROVED_ORDERS)) {
    const existing = await findExistingOrder(base44, orderNumber, expected);
    rows.push({
      order_number: orderNumber,
      status: existing ? 'skipped' : 'preview',
      reason: existing ? 'already_exists' : 'would_create',
      hub_order_id: existing?.id || '',
      total_price: expected.total_price,
      item_count: itemCount(expected.line_items),
    });
  }

  return rows;
}

async function recoverOrders(base44) {
  const results = [];

  for (const [orderNumber, expected] of Object.entries(APPROVED_ORDERS)) {
    const existing = await findExistingOrder(base44, orderNumber, expected);
    if (existing) {
      results.push({
        order_number: orderNumber,
        status: 'skipped',
        reason: 'already_exists',
        hub_order_id: existing.id,
        total_price: expected.total_price,
        item_count: itemCount(expected.line_items),
      });
      continue;
    }

    const created = await base44.asServiceRole.entities.ShopifyOrder.create(
      buildPosOrderPayload(orderNumber, expected)
    );

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
      item_count: itemCount(expected.line_items),
    });
  }

  return results;
}

function renderPage({ mode, rows, message = '', status = 200 }) {
  const createdCount = rows.filter((row) => row.status === 'created').length;
  const skippedCount = rows.filter((row) => row.status === 'skipped').length;
  const previewCount = rows.filter((row) => row.status === 'preview').length;
  const total = rows.reduce((sum, row) => sum + Number(row.total_price || 0), 0);

  const tableRows = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.order_number)}</td>
      <td>${escapeHtml(row.status)}</td>
      <td>${escapeHtml(row.reason || '')}</td>
      <td>${escapeHtml(row.hub_order_id || '')}</td>
      <td>${escapeHtml(row.item_count)}</td>
      <td>$${Number(row.total_price || 0).toFixed(2)}</td>
    </tr>
  `).join('');

  return htmlResponse(`<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>May 30 POS Recovery</title>
        <style>
          body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #0f172a; }
          code, input { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
          table { border-collapse: collapse; width: 100%; margin: 20px 0; }
          th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
          th { background: #e2e8f0; }
          .summary { display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0; }
          .pill { border: 1px solid #94a3b8; border-radius: 999px; padding: 6px 10px; }
          .warning { background: #fff7ed; border: 1px solid #fdba74; padding: 12px; border-radius: 6px; }
          button { background: #14532d; color: white; border: 0; border-radius: 6px; padding: 10px 14px; font-weight: 700; }
          input { width: min(100%, 560px); padding: 10px; margin: 8px 0 12px; }
        </style>
      </head>
      <body>
        <h1>May 30 POS Recovery</h1>
        <p>Admin-only helper for exactly four missing Shopify POS orders: <strong>#1035-#1038</strong>.</p>
        ${message ? `<p class="warning">${escapeHtml(message)}</p>` : ''}
        <div class="summary">
          <span class="pill">mode: ${escapeHtml(mode)}</span>
          <span class="pill">preview: ${previewCount}</span>
          <span class="pill">created: ${createdCount}</span>
          <span class="pill">skipped: ${skippedCount}</span>
          <span class="pill">scope total: $${total.toFixed(2)}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Status</th>
              <th>Reason</th>
              <th>Hub order id</th>
              <th>Items</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
        <form method="post">
          <label for="confirmation">Exact confirmation required for live recovery</label><br />
          <input id="confirmation" name="confirmation" autocomplete="off" placeholder="${escapeHtml(CONFIRMATION)}" />
          <br />
          <button type="submit">Run Scoped Recovery</button>
        </form>
        <p>No delivery tasks, production batches, inventory deductions, purchase orders, customer notifications, provider calls, or sync/retry actions are created by this helper.</p>
      </body>
    </html>`, status);
}

Deno.serve(async (req) => {
  try {
    if (!['GET', 'POST'].includes(req.method)) {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user || user.role !== 'admin') {
      return htmlResponse('<h1>Admin access required</h1>', 403);
    }

    if (req.method === 'GET') {
      return renderPage({ mode: 'preview', rows: await previewOrders(base44) });
    }

    const form = await req.formData().catch(() => null);
    const confirmation = form?.get('confirmation')?.toString() || '';
    if (confirmation !== CONFIRMATION) {
      return renderPage({
        mode: 'blocked',
        rows: await previewOrders(base44),
        message: 'Blocked: exact confirmation did not match.',
        status: 409,
      });
    }

    return renderPage({
      mode: 'live',
      rows: await recoverOrders(base44),
      message: 'Scoped recovery completed. Re-submit to verify idempotent skip behavior.',
    });
  } catch (error) {
    console.error('[recoverMay30MissingPOSOrdersForm] Error:', error.message);
    return htmlResponse('<h1>Unable to recover May 30 POS orders</h1>', 500);
  }
});
