import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { order_id, product_name, quantity } = await req.json();

    if (!order_id || !product_name || !quantity) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Generate batch ID
    const now = new Date();
    const week = Math.ceil((now.getDate() + 6) / 7);
    const batchId = `BATCH-${now.getFullYear()}-W${String(week).padStart(2, '0')}-${Math.random().toString(36).charAt(2).toUpperCase()}`;

    const batch = await base44.asServiceRole.entities.ProductionBatch.create({
      batch_id: batchId,
      product_name,
      status: 'Planned',
      planned_units: parseInt(quantity),
      production_date: new Date().toISOString().split('T')[0],
      notes: `Order: ${order_id}`,
    });

    console.log(`[CREATE-BATCH] Created batch ${batchId} for ${product_name}`);
    return Response.json({ status: 'success', batch_id: batch.id });
  } catch (error) {
    console.error('[CREATE-BATCH] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});