import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * archiveAllPendingQueueItems
 * Clears out all pending queue items so new ones are visible.
 * Archives are non-operational — only affects queue visibility.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Fetch all pending items
    const pending = await base44.asServiceRole.entities.OrderReviewQueue.filter({ status: 'pending' }, '-created_date', 1000);
    const count = pending.length;
    console.log(`[ARCHIVE-PENDING] Found ${count} pending items to archive`);

    if (count === 0) {
      return Response.json({ success: true, archived_count: 0, message: 'No pending items to archive.' });
    }

    const now = new Date().toISOString();

    // Batch archive with rate limit protection (batches of 3)
    let archivedCount = 0;
    for (let i = 0; i < pending.length; i += 3) {
      const batch = pending.slice(i, i + 3);
      try {
        await Promise.all(
          batch.map(item =>
            base44.asServiceRole.entities.OrderReviewQueue.update(item.id, {
              status: 'archived',
              queue_visibility_status: 'archived',
              archived_at: now,
              archived_by: user.email,
              archived_reason: 'Bulk cleanup - historical pending items',
            })
          )
        );
        archivedCount += batch.length;
        console.log(`[ARCHIVE-PENDING] Archived batch ${Math.floor(i/3)+1}/${Math.ceil(count/3)}`);
      } catch (err) {
        console.warn(`[ARCHIVE-PENDING] Batch error at ${i}:`, err.message);
      }
      // Delay to prevent rate limiting
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    // Log to audit trail
    await base44.asServiceRole.entities.RepairAuditLog.create({
      timestamp: now,
      executed_by: user.email,
      repair_function: 'archiveAllPendingQueueItems',
      action: 'cleanup',
      records_affected: archivedCount,
      reason: 'Bulk clear pending queue to focus on new incoming items',
      changes: { archived_count: archivedCount, reason: 'Historical noise cleanup' },
    });

    console.log(`[ARCHIVE-PENDING] Complete — archived ${archivedCount} items`);

    return Response.json({
      success: true,
      archived_count: archivedCount,
      message: `Archived ${archivedCount} pending items. Queue is now clear for new incoming items.`,
    });

  } catch (error) {
    console.error('[ARCHIVE-PENDING] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});