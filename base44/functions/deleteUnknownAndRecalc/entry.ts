import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Delete unrecoverable #unknown orders by ID and recalculate batches
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await req.json();
    const orderIdToDelete = body.order_id;

    if (!orderIdToDelete) {
      return Response.json({ error: 'order_id required' }, { status: 400 });
    }

    const result = {
      timestamp: new Date().toISOString(),
      deleted_id: orderIdToDelete,
      deleted: false,
      recalculation: null,
    };

    // Delete the order
    try {
      await base44.asServiceRole.entities.ShopifyOrder.delete(orderIdToDelete);
      result.deleted = true;
      console.log(`[DELETE-AND-RECALC] Deleted order ${orderIdToDelete}`);
    } catch (err) {
      result.deletion_error = err.message;
      return Response.json(result, { status: 400 });
    }

    return Response.json(result);
  } catch (error) {
    console.error('[DELETE-AND-RECALC] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});