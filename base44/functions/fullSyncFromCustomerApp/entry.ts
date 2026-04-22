import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

async function callCustomerApp(path, method = 'POST', body = {}) {
   if (!CUSTOMER_APP_API || !SYNC_SECRET) {
     throw new Error('Customer app API not configured');
   }
   const response = await fetch(`${CUSTOMER_APP_API}/functions/${path}`, {
     method,
     headers: {
       'Authorization': `Bearer ${SYNC_SECRET}`,
       'Content-Type': 'application/json',
     },
     body: method !== 'GET' ? JSON.stringify(body) : undefined,
   });
   const text = await response.text();
   if (!response.ok) throw new Error(`${path} failed ${response.status}: ${text.slice(0, 200)}`);
   try {
     return JSON.parse(text);
   } catch {
     throw new Error(`Invalid JSON from ${path}: ${text.slice(0, 100)}`);
   }
 }

async function syncOrders(base44) {
  const data = await callCustomerApp('getOrdersForSync');
  const orders = data.orders || [];
  let created = 0, updated = 0, failed = 0;
  for (const ord of orders) {
    try {
      const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_id: ord.shopify_order_id || ord.id });
      const hubOrder = {
        shopify_order_id: ord.shopify_order_id || ord.id || '',
        shopify_order_number: ord.shopify_order_number || ord.order_number || '',
        customer_email: ord.customer_email || '',
        customer_phone: ord.customer_phone || '',
        source_channel: ord.source_channel || ord.channel || 'online',
        line_items: ord.line_items || ord.items || [],
        fulfillment_method: ord.fulfillment_method || ord.fulfillment_type || 'delivery',
        delivery_address: ord.delivery_address || '',
        requested_delivery_date: ord.requested_delivery_date || ord.delivery_date || '',
        payment_status: ord.payment_status || 'pending',
        fulfillment_status: ord.fulfillment_status || '',
        subtotal: ord.subtotal || 0,
        total_price: ord.total_price || ord.total || 0,
        customer_notes: ord.customer_notes || ord.notes || '',
        production_status: ord.production_status || 'new',
        tags: ord.tags || [],
        assigned_delivery_date: ord.assigned_delivery_date || '',
        sync_status: 'synced',
        last_sync_at: new Date().toISOString(),
      };
      if (existing?.length > 0) {
        await base44.asServiceRole.entities.ShopifyOrder.update(existing[0].id, hubOrder);
        updated++;
      } else {
        await base44.asServiceRole.entities.ShopifyOrder.create(hubOrder);
        created++;
      }
      } catch (err) { 
      console.error(`[FULL-SYNC] Order sync error for ${ord.shopify_order_id}:`, err.message);
      failed++; 
      }
      }
      return { total: orders.length, created, updated, failed };
}

async function syncProducts(base44) {
  const data = await callCustomerApp('getProductsForSync', 'POST');
  const products = data.products || [];
  let created = 0, updated = 0, failed = 0;
  for (const p of products) {
    try {
      const sku = p.shopify_product_id || p.sku || p.id;
      const hubProduct = { ...p, sku };
      const existing = await base44.asServiceRole.entities.Product.filter({ sku });
      if (existing?.length > 0) {
        await base44.asServiceRole.entities.Product.update(existing[0].id, hubProduct);
        updated++;
      } else {
        await base44.asServiceRole.entities.Product.create(hubProduct);
        created++;
      }
      } catch (err) { 
      console.error(`[FULL-SYNC] Product sync error for ${p.sku}:`, err.message);
      failed++; 
      }
      }
      return { total: products.length, created, updated, failed };
}

async function syncLoyalty(base44) {
  const data = await callCustomerApp('getLoyaltyDataForSync');
  const customers = data.customers || [];
  let created = 0, updated = 0, failed = 0;
  for (const c of customers) {
    try {
      const existing = await base44.asServiceRole.entities.CustomerLoyalty.filter({ customer_email: c.customer_email });
      if (existing?.length > 0) {
        await base44.asServiceRole.entities.CustomerLoyalty.update(existing[0].id, c);
        updated++;
      } else {
        await base44.asServiceRole.entities.CustomerLoyalty.create(c);
        created++;
      }
      } catch (err) { 
      console.error(`[FULL-SYNC] Loyalty sync error for ${c.customer_email}:`, err.message);
      failed++; 
      }
      }
      return { total: customers.length, created, updated, failed };
}

async function syncEvents(base44) {
  const data = await callCustomerApp('getEventsForSync');
  const events = data.events || [];
  // Delete all existing hub events then re-create from customer app
  const existing = await base44.asServiceRole.entities.Event.list('-created_date', 500);
  for (const e of existing) {
    await base44.asServiceRole.entities.Event.delete(e.id);
  }
  let created = 0;
  for (const e of events) {
    await base44.asServiceRole.entities.Event.create({
      name: e.name || 'Untitled Event',
      type: e.type || 'Other',
      status: e.is_active !== false ? 'Confirmed' : 'Cancelled',
      date: e.date,
      end_date: e.end_date || null,
      location: e.location || '',
      expected_attendees: e.expected_attendees || 0,
      products: e.products || '',
      contact_name: e.contact_name || '',
      contact_email: e.contact_email || '',
      revenue: e.revenue || 0,
      notes: e.description || e.notes || '',
    });
    created++;
  }
  return { total: events.length, created };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.log('[FULL-SYNC] Starting full sync from customer app...');

    const results = {};
    const errors = {};

    // Run syncs — products and events can run in parallel, orders and loyalty too
    const [ordersResult, productsResult, loyaltyResult, eventsResult] = await Promise.allSettled([
      syncOrders(base44),
      syncProducts(base44),
      syncLoyalty(base44),
      syncEvents(base44),
    ]);

    if (ordersResult.status === 'fulfilled') results.orders = ordersResult.value;
    else errors.orders = ordersResult.reason?.message;

    if (productsResult.status === 'fulfilled') results.products = productsResult.value;
    else errors.products = productsResult.reason?.message;

    if (loyaltyResult.status === 'fulfilled') results.loyalty = loyaltyResult.value;
    else errors.loyalty = loyaltyResult.reason?.message;

    if (eventsResult.status === 'fulfilled') results.events = eventsResult.value;
    else errors.events = eventsResult.reason?.message;

    const hasErrors = Object.keys(errors).length > 0;
    console.log('[FULL-SYNC] Complete:', JSON.stringify({ results, errors }));

    return Response.json({
      status: hasErrors ? 'partial' : 'success',
      synced_at: new Date().toISOString(),
      results,
      errors: hasErrors ? errors : undefined,
    });

  } catch (error) {
    console.error('[FULL-SYNC] Fatal error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});