import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const secret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
    const authHeader = req.headers.get('authorization')?.replace('Bearer ', '');
    
    if (authHeader !== secret) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const payload = await req.json();
    
    if (!payload.products || !Array.isArray(payload.products)) {
      return Response.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const results = [];
    for (const productData of payload.products) {
      try {
        // Check if product exists by SKU
        const existing = await base44.asServiceRole.entities.Product.filter({ sku: productData.sku });
        
        if (existing && existing.length > 0) {
          await base44.asServiceRole.entities.Product.update(existing[0].id, productData);
          results.push({ sku: productData.sku, action: 'updated' });
        } else {
          await base44.asServiceRole.entities.Product.create(productData);
          results.push({ sku: productData.sku, action: 'created' });
        }
      } catch (err) {
        results.push({ sku: productData.sku, action: 'failed', error: err.message });
      }
    }

    return Response.json({ status: 'success', results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});