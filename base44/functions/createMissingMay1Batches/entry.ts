import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const newBatches = [
      { batch_id: 'BATCH-20260501-PINEAPPLE', product_name: 'Pineapple Juice', category: 'juice' },
      { batch_id: 'BATCH-20260501-ORANGE', product_name: 'Orange Juice', category: 'juice' },
      { batch_id: 'BATCH-20260501-WATERMELON', product_name: 'Watermelon Juice', category: 'juice' },
      { batch_id: 'BATCH-20260501-HYDRATION', product_name: 'Hydration Shot', category: 'shot' },
      { batch_id: 'BATCH-20260501-RESET', product_name: 'Reset Shot', category: 'shot' },
      { batch_id: 'BATCH-20260501-RADIANCE', product_name: 'Radiance Shot', category: 'shot' },
    ];

    const created = [];
    for (const batch of newBatches) {
      const existing = await base44.asServiceRole.entities.ProductionBatch.filter({ batch_id: batch.batch_id });
      if (!existing || existing.length === 0) {
        const result = await base44.asServiceRole.entities.ProductionBatch.create({
          batch_id: batch.batch_id,
          product_name: batch.product_name,
          product_category: batch.category,
          production_date: '2026-05-01',
          status: 'planned',
          planned_units: 0,
          order_sources: [],
        });
        created.push({ batch_id: batch.batch_id, product: batch.product_name, id: result.id });
      }
    }

    return Response.json({ created, message: `Created ${created.length} batch records` });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});