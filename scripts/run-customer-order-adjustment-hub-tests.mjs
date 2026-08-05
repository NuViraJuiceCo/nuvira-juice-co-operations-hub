import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const clone = (value) => JSON.parse(JSON.stringify(value));

function store(initial = []) {
  const rows = initial.map(clone);
  let sequence = rows.length;
  return {
    rows,
    async filter(filters = {}) {
      return rows.filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value)).map(clone);
    },
    async list() {
      return rows.map(clone);
    },
    async create(payload) {
      const row = { id: payload.id || `row_${++sequence}`, ...clone(payload) };
      rows.push(row);
      return clone(row);
    },
    async update(id, payload) {
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) throw new Error(`missing row ${id}`);
      rows[index] = { ...rows[index], ...clone(payload) };
      return clone(rows[index]);
    },
    async delete(id) {
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows.splice(index, 1);
    },
  };
}

function fixture({ lockedOasis = false } = {}) {
  const order = {
    id: 'hub_order_lee',
    shopify_order_number: 'NV-TEST-LEE',
    order_type: 'one_time',
    payment_status: 'paid',
    production_status: 'awaiting_production',
    order_lock_status: 'verified',
    assigned_delivery_date: '2026-08-05',
    selected_delivery_date: '2026-08-05',
    production_date: '2026-08-04',
    customer_name: 'Synthetic Customer',
    customer_email: 'customer@example.test',
    address_line1: '1 Test Way',
    address_city: 'Testville',
    address_state: 'MO',
    address_postal_code: '00000',
    delivery_window_label: 'Wednesday 5 PM - 8 PM',
    line_items: [
      { title: 'The NuVira Trio', quantity: 1, price: 36 },
      { title: 'Radiance Shot', quantity: 1, price: 6 },
    ],
  };
  const products = ['Re-Nu', 'Aura', 'Oasis', 'Radiance Shot'];
  const stores = {
    ShopifyOrder: store([order]),
    FulfillmentTask: store([{
      id: 'hub_task_lee',
      order_id: order.id,
      order_number: order.shopify_order_number,
      customer_name: order.customer_name,
      customer_email: order.customer_email,
      fulfillment_type: 'Delivery',
      fulfillment_number: 1,
      status: 'Scheduled',
      scheduled_date: '2026-08-05',
      production_date: '2026-08-04',
      items_summary: '1x The NuVira Trio, 1x Radiance Shot',
    }]),
    ProductionBatch: store(products.map((product, index) => ({
      id: `batch_${index + 1}`,
      batch_id: `BATCH-20260804-${product.replace(/\s/g, '').toUpperCase()}`,
      product_name: product,
      production_date: '2026-08-04',
      status: product === 'Oasis' && lockedOasis ? 'in_production' : 'planned',
      is_locked: product === 'Oasis' && lockedOasis,
      planned_units: 1,
      order_sources: [{
        order_id: order.id,
        order_number: order.shopify_order_number,
        quantity: 1,
        source_type: 'bundle',
        source_item: 'The NuVira Trio',
      }],
    }))),
    OrderSyncLog: store(),
  };
  const invocations = [];
  const base44 = {
    asServiceRole: {
      entities: stores,
      functions: {
        async invoke(name, payload) {
          invocations.push({ name, payload: clone(payload) });
          if (name === 'safeSyncOrderUpdate') {
            await stores.ShopifyOrder.update(payload.matchBy.internal_id, payload.incomingData);
            return { data: { status: 'success', action: 'updated', order_id: payload.matchBy.internal_id } };
          }
          if (name === 'triggerBatchDemandForDates') {
            let created = 0;
            let updated = 0;
            let deduped = 0;
            for (const fulfillment of payload.fulfillments) {
              for (const item of fulfillment.items) {
                const existing = stores.ProductionBatch.rows.find((batch) =>
                  batch.production_date === fulfillment.production_date
                  && batch.product_name.toLowerCase().replace(/[^a-z0-9]/g, '') === item.title.toLowerCase().replace(/[^a-z0-9]/g, ''));
                if (existing) {
                  if (existing.order_sources.some((source) => source.order_id === payload.order_id)) {
                    deduped += 1;
                  } else {
                    existing.order_sources.push({ order_id: payload.order_id, order_number: payload.order_number, quantity: item.quantity });
                    existing.planned_units += item.quantity;
                    updated += 1;
                  }
                } else {
                  await stores.ProductionBatch.create({
                    batch_id: `BATCH-${fulfillment.production_date.replace(/-/g, '')}-${item.title.replace(/\s/g, '').toUpperCase()}`,
                    product_name: item.title,
                    production_date: fulfillment.production_date,
                    status: 'planned',
                    planned_units: item.quantity,
                    is_locked: false,
                    order_sources: [{ order_id: payload.order_id, order_number: payload.order_number, quantity: item.quantity }],
                  });
                  created += 1;
                }
              }
            }
            return { data: { status: 'success', created, updated, deduped, errors: 0 } };
          }
          throw new Error(`unexpected function invocation: ${name}`);
        },
      },
    },
  };
  return { base44, stores, invocations };
}

async function loadHandler(base44) {
  globalThis.__BASE44_HUB_TEST_CLIENT = base44;
  globalThis.__HUB_TEST_HANDLER = null;
  globalThis.Deno = {
    env: {
      get(name) {
        if (name === 'CUSTOMER_APP_SYNC_SECRET') return 'synthetic_sync_secret';
        if (name === 'INTERNAL_FUNCTION_SECRET') return 'synthetic_internal_secret';
        return '';
      },
    },
    serve(handler) {
      globalThis.__HUB_TEST_HANDLER = handler;
    },
  };
  let source = await readFile(new URL('../base44/functions/receiveCustomerAppEvent/entry.ts', import.meta.url), 'utf8');
  source = source.replace(
    "import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';",
    'const createClientFromRequest = () => globalThis.__BASE44_HUB_TEST_CLIENT;',
  );
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Math.random()}`);
  assert.equal(typeof globalThis.__HUB_TEST_HANDLER, 'function');
  return globalThis.__HUB_TEST_HANDLER;
}

function adjustment(choice, requestId, event = 'order.adjustment_selected') {
  const available = [
    { title: 'Re-Nu', quantity: 1 },
    { title: 'Aura', quantity: 1 },
    { title: 'Radiance Shot', quantity: 1 },
  ];
  const all = [...available.slice(0, 2), { title: 'Oasis', quantity: 1 }, available[2]];
  const fulfillments = choice === 'full_order_saturday'
    ? [{ production_date: '2026-08-07', delivery_date: '2026-08-08', items: all }]
    : choice === 'oasis_saturday'
      ? [
        { production_date: '2026-08-04', delivery_date: '2026-08-05', items: available },
        { production_date: '2026-08-07', delivery_date: '2026-08-08', items: [{ title: 'Oasis', quantity: 1 }] },
      ]
      : [{ production_date: '2026-08-04', delivery_date: '2026-08-05', items: available }];
  const refund = choice === 'oasis_refund' ? {
    amount: 12,
    currency: 'usd',
    status: event === 'order.adjustment_preflight' ? 'pending' : 'succeeded',
    ...(event === 'order.adjustment_selected' ? { stripe_refund_id: 're_synthetic_oasis' } : {}),
  } : null;
  return {
    event,
    data: {
      request_id: requestId,
      order_number: 'NV-TEST-LEE',
      choice,
      fulfillments,
      refund,
    },
  };
}

async function invoke(handler, body) {
  const response = await handler(new Request('https://hub.example.test/api/functions/receiveCustomerAppEvent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic_sync_secret' },
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

let assertions = 0;
for (const choice of ['full_order_saturday', 'oasis_saturday', 'oasis_refund']) {
  const state = fixture();
  const handler = await loadHandler(state.base44);
  const requestId = `synthetic-${choice}-request`;
  const beforePreflight = JSON.stringify({
    order: state.stores.ShopifyOrder.rows,
    tasks: state.stores.FulfillmentTask.rows,
    batches: state.stores.ProductionBatch.rows,
    logs: state.stores.OrderSyncLog.rows,
  });
  const preflight = await invoke(handler, adjustment(choice, requestId, 'order.adjustment_preflight'));
  assert.equal(preflight.status, 200);
  assert.equal(preflight.body.action, 'preflight_passed');
  assert.equal(JSON.stringify({
    order: state.stores.ShopifyOrder.rows,
    tasks: state.stores.FulfillmentTask.rows,
    batches: state.stores.ProductionBatch.rows,
    logs: state.stores.OrderSyncLog.rows,
  }), beforePreflight, 'preflight must not write operational entities');
  assert.equal(state.invocations.length, 0, 'preflight must not invoke downstream functions');

  const response = await invoke(handler, adjustment(choice, requestId));
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'success');
  const order = state.stores.ShopifyOrder.rows[0];
  assert.equal(order.schedule_source, 'customer_order_adjustment');
  assert.equal(order.fulfillments.length, choice === 'oasis_saturday' ? 2 : 1);
  assert.equal(state.stores.FulfillmentTask.rows.length, choice === 'oasis_saturday' ? 2 : 1);
  assert.equal(state.stores.OrderSyncLog.rows.filter((row) => row.success).length, 1);

  if (choice === 'full_order_saturday') {
    assert.equal(order.production_date, '2026-08-07');
    assert.equal(order.assigned_delivery_date, '2026-08-08');
    assert.equal(state.stores.ProductionBatch.rows.filter((batch) => batch.production_date === '2026-08-07').length, 4);
    assert.equal(state.stores.ProductionBatch.rows.some((batch) => batch.production_date === '2026-08-04'), false);
  } else if (choice === 'oasis_saturday') {
    assert.equal(order.fulfillment_mode, 'multi_delivery');
    assert.equal(state.stores.FulfillmentTask.rows[1].items_summary, '1x Oasis');
    assert.equal(state.stores.ProductionBatch.rows.find((batch) => batch.product_name === 'Oasis').production_date, '2026-08-07');
    assert.equal(state.stores.ProductionBatch.rows.filter((batch) => batch.production_date === '2026-08-04').length, 3);
  } else {
    assert.equal(order.payment_status, 'paid');
    assert.equal(order.refund_status, 'partially_refunded');
    assert.equal(order.refund_amount, 12);
    assert.equal(state.stores.ProductionBatch.rows.some((batch) => batch.product_name === 'Oasis'), false);
    assert.equal(state.stores.FulfillmentTask.rows[0].items_summary.includes('Oasis'), false);
  }

  const counts = {
    tasks: state.stores.FulfillmentTask.rows.length,
    batches: state.stores.ProductionBatch.rows.length,
    logs: state.stores.OrderSyncLog.rows.length,
    invokes: state.invocations.length,
  };
  const replay = await invoke(handler, adjustment(choice, requestId));
  assert.equal(replay.status, 200);
  assert.equal(replay.body.action, 'skipped');
  assert.deepEqual({
    tasks: state.stores.FulfillmentTask.rows.length,
    batches: state.stores.ProductionBatch.rows.length,
    logs: state.stores.OrderSyncLog.rows.length,
    invokes: state.invocations.length,
  }, counts);
  assertions += choice === 'full_order_saturday' ? 17 : (choice === 'oasis_saturday' ? 17 : 19);
}

{
  const state = fixture({ lockedOasis: true });
  const handler = await loadHandler(state.base44);
  const before = JSON.stringify({
    order: state.stores.ShopifyOrder.rows,
    tasks: state.stores.FulfillmentTask.rows,
    batches: state.stores.ProductionBatch.rows,
  });
  const response = await invoke(handler, adjustment(
    'oasis_refund',
    'synthetic-locked-batch-request',
    'order.adjustment_preflight',
  ));
  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'locked_production_batch_requires_operator');
  assert.equal(JSON.stringify({
    order: state.stores.ShopifyOrder.rows,
    tasks: state.stores.FulfillmentTask.rows,
    batches: state.stores.ProductionBatch.rows,
  }), before);
  assert.equal(state.invocations.length, 0);
  assertions += 4;
}

for (const event of ['order.adjustment_preflight', 'order.adjustment_selected']) {
  const state = fixture();
  const handler = await loadHandler(state.base44);
  const invalid = adjustment('oasis_saturday', `synthetic-invalid-split-${event}`, event);
  invalid.data.fulfillments[1].items.push({ title: 'Aura', quantity: 1 });
  const response = await invoke(handler, invalid);
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'split_plan_follow_up_must_be_oasis_only');
  assert.equal(state.invocations.length, 0);
  assertions += 3;
}

const recalcSource = await readFile(new URL('../base44/functions/recalculateProductionBatches/entry.ts', import.meta.url), 'utf8');
assert.match(recalcSource, /schedule_source === 'customer_order_adjustment'/);
assert.match(recalcSource, /isSubscription \|\| hasCustomerAdjustmentPlan/);
assert.match(recalcSource, /customer_order_adjustment' : 'subscription_fulfillment'/);
assertions += 3;

console.log(`customer order adjustment Hub tests: ${assertions} assertions passed`);
console.log('external network requests: 0');
