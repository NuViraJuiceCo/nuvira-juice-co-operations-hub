import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    if (!CUSTOMER_APP_API) {
      return Response.json({ error: 'CUSTOMER_APP_API_URL secret not set' }, { status: 500 });
    }

    // Fetch products from customer app
    const response = await fetch(`${CUSTOMER_APP_API}/functions/getProductsForSync`, {
      headers: {
        'Authorization': `Bearer ${SYNC_SECRET}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Customer app responded with ${response.status}`);
    }

    const { products } = await response.json();

    if (!Array.isArray(products)) {
      return Response.json({ error: 'Invalid response from customer app' }, { status: 500 });
    }

    const results = [];
    for (const productData of products) {
      const existing = await base44.asServiceRole.entities.Product.filter({ sku: productData.sku });
      if (existing && existing.length > 0) {
        await base44.asServiceRole.entities.Product.update(existing[0].id, productData);
        results.push({ sku: productData.sku, action: 'updated' });
      } else {
        await base44.asServiceRole.entities.Product.create(productData);
        results.push({ sku: productData.sku, action: 'created' });
      }
    }

    console.log(`[PULL-PRODUCTS] Synced ${results.length} products`);
    return Response.json({ status: 'success', count: results.length, results });
  } catch (error) {
    console.error('[PULL-PRODUCTS] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});