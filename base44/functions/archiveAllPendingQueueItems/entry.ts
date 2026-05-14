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

    // Archive one at a time with generous delay to avoid rate limits
    let archivedCount = 0;
    for (let i = 0; i < pending.length; i++) {
      try {
        await base44.asServiceRole.entities.OrderReviewQueue.update(pending[i].id, {
          status: 'archived',
          queue_visibility_status: 'archived',
          archived_at: now,
          archived_by: user.email,
          archived_reason: 'Bulk cleanup - historical pending items',
        });
        archivedCount++;
        if (i % 10 === 0) console.log(`[ARCHIVE-PENDING] Progress: ${archivedCount}/${count}`);
      } catch (err) {
        console.warn(`[ARCHIVE-PENDING] Error at item ${i}:`, err.message);
        // On rate limit, wait longer then retry once
        await new Promise(resolve => setTimeout(resolve, 2000));
        try {
          await base44.asServiceRole.entities.OrderReviewQueue.update(pending[i].id, {
            status: 'archived',
            queue_visibility_status: 'archived',
            archived_at: now,
            archived_by: user.email,
            archived_reason: 'Bulk cleanup - historical pending items',
          });
          archivedCount++;
        } catch (retryErr) {
          console.warn(`[ARCHIVE-PENDING] Retry failed at item ${i}:`, retryErr.message);
        }
      }
      // 500ms between each update to stay well within rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
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