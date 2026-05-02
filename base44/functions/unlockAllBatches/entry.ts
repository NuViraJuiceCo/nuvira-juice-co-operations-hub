import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Get all batches
    const allBatches = await base44.asServiceRole.entities.ProductionBatch.list('-production_date', 500);
    
    // Unlock all locked batches
    let unlockedCount = 0;
    for (const batch of allBatches) {
      if (batch.is_locked) {
        await base44.asServiceRole.entities.ProductionBatch.update(batch.id, { is_locked: false });
        unlockedCount++;
      }
    }

    return Response.json({
      success: true,
      message: `Unlocked ${unlockedCount} batches`,
      total_batches: allBatches.length,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});