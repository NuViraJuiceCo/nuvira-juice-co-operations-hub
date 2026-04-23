import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { targetDate } = await req.json();

    if (!targetDate) {
      return Response.json({ error: 'targetDate required' }, { status: 400 });
    }

    // Fetch all batches
    const allBatches = await base44.asServiceRole.entities.ProductionBatch.list('-created_date', 500);

    // Update each batch
    let updated = 0;
    for (const batch of allBatches) {
      await base44.asServiceRole.entities.ProductionBatch.update(batch.id, {
        production_date: targetDate,
      });
      updated++;
    }

    return Response.json({ status: 'success', updated });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});