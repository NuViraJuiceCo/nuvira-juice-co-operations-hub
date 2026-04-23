import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const batches = await base44.asServiceRole.entities.ProductionBatch.list('-updated_date', 100);
    const toDelete = batches.filter(b => b.production_date === '2026-05-02');

    for (const batch of toDelete) {
      await base44.asServiceRole.entities.ProductionBatch.delete(batch.id);
    }

    return Response.json({
      success: true,
      deleted: toDelete.length,
      batches: toDelete.map(b => ({ id: b.id, batch_id: b.batch_id, product_name: b.product_name })),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});