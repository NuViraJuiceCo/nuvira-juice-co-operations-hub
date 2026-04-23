import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get all batches
    const batches = await base44.asServiceRole.entities.ProductionBatch.list('-updated_date', 100);
    
    // Find and delete NuVira Trio batch
    const trioBatch = batches.find(b => b.product_name === 'The NuVira Trio');
    if (trioBatch) {
      await base44.asServiceRole.entities.ProductionBatch.delete(trioBatch.id);
    }

    // Create base product batches for May 1, 2026
    const newBatches = await base44.asServiceRole.entities.ProductionBatch.bulkCreate([
      {
        batch_id: 'BATCH-2026-AURA-001',
        product_name: 'AURA',
        status: 'Planned',
        planned_units: 4,
        production_date: '2026-05-01',
        notes: 'From orders: 3 direct + 1 from NuVira Trio',
      },
      {
        batch_id: 'BATCH-2026-OASIS-001',
        product_name: 'Oasis',
        status: 'Planned',
        planned_units: 1,
        production_date: '2026-05-01',
        notes: 'From NuVira Trio bundle',
      },
      {
        batch_id: 'BATCH-2026-RENU-001',
        product_name: 'Re-Nu',
        status: 'Planned',
        planned_units: 1,
        production_date: '2026-05-01',
        notes: 'From NuVira Trio bundle',
      },
    ]);

    return Response.json({
      success: true,
      deleted: trioBatch ? 1 : 0,
      created: newBatches.length,
      batches: newBatches,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});