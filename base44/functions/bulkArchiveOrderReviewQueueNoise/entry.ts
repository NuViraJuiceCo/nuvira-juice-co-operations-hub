import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * bulkArchiveOrderReviewQueueNoise
 *
 * SAFE, NON-OPERATIONAL cleanup for historical/duplicate queue noise.
 * Archiving ONLY affects queue visibility — does NOT modify orders, subscriptions, Stripe data, or trigger automations.
 *
 * Actions:
 * - dry_run: show what would be archived
 * - archive_old_resolved: archive all 'resolved' items older than N days
 * - archive_historical_noise: archive items from rebuild_subscriptions source with low_quality_new_order incident type
 * - archive_duplicates: archive all but newest of each duplicate group (by idempotency_key)
 * - archive_test_data: archive test/canceled/invalid customer records
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action || 'dry_run';
    const daysOld = body.days_old || 7;

    // Load all queue items
    const allItems = await base44.asServiceRole.entities.OrderReviewQueue.list('-created_date', 1000);
    console.log(`[BULK-ARCHIVE] Found ${allItems.length} total queue items`);

    const now = new Date();
    const archiveAt = new Date(now).toISOString();

    // ── Helper: decide if item should be archived ──
    const shouldArchive = (item, archiveMode) => {
      if (item.status === 'archived' || item.status === 'ignored') return false; // Already archived

      if (archiveMode === 'old_resolved') {
        // Archive resolved items older than N days
        if (item.status !== 'resolved') return false;
        const itemAge = (now - new Date(item.resolved_at || item.created_date)) / (1000 * 60 * 60 * 24);
        return itemAge > daysOld;
      }

      if (archiveMode === 'historical_noise') {
        // Archive rebuild_subscriptions low-quality attempts
        return item.incoming_source === 'rebuild_subscriptions' && 
               item.incident_type === 'low_quality_new_order';
      }

      if (archiveMode === 'duplicates') {
        // Will handle in grouping logic below
        return false; // placeholder
      }

      if (archiveMode === 'test_data') {
        // Archive obvious test orders
        const isTest = item.customer_email?.includes('test') || 
                       item.customer_email?.includes('fake') ||
                       item.customer_name?.toLowerCase().includes('test');
        return isTest && item.status === 'pending';
      }

      return false;
    };

    // ── Candidate collection ──
    let candidates = [];

    if (action === 'dry_run' || action === 'archive_old_resolved') {
      candidates = allItems.filter(item => shouldArchive(item, 'old_resolved'));
    } else if (action === 'archive_historical_noise') {
      candidates = allItems.filter(item => shouldArchive(item, 'historical_noise'));
    } else if (action === 'archive_duplicates') {
      // Group by idempotency_key, keep newest of each
      const groups = {};
      for (const item of allItems) {
        const key = item.idempotency_key || 
          `${item.incoming_source}::${item.incident_type}::${item.customer_email}::${item.existing_order_id || item.existing_order_number || 'unknown'}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
      }
      // Collect all but newest from groups with 2+ items
      for (const entries of Object.values(groups)) {
        if (entries.length > 1) {
          const sorted = entries.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
          candidates.push(...sorted.slice(1)); // All but newest
        }
      }
    } else if (action === 'archive_test_data') {
      candidates = allItems.filter(item => shouldArchive(item, 'test_data'));
    }

    const report = {
      total_items: allItems.length,
      candidates_to_archive: candidates.length,
      action: action,
    };

    if (action === 'dry_run' || !action.startsWith('archive_')) {
      // Return report without making changes
      const samples = candidates.slice(0, 5).map(c => ({
        id: c.id,
        incident_type: c.incident_type,
        customer_email: c.customer_email,
        source: c.incoming_source,
        created: c.created_date,
      }));

      return Response.json({
        success: true,
        action: 'dry_run',
        report,
        sample_candidates: samples,
        note: 'To proceed, call with action=archive_old_resolved, archive_historical_noise, archive_duplicates, or archive_test_data',
      });
    }

    // ── ARCHIVE EXECUTION ──
    if (!action.startsWith('archive_')) {
      return Response.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Determine archive reason
    let archiveReason = '';
    if (action === 'archive_old_resolved') {
      archiveReason = `Historical resolved item (${daysOld}+ days old)`;
    } else if (action === 'archive_historical_noise') {
      archiveReason = 'Historical rebuild_subscriptions noise';
    } else if (action === 'archive_duplicates') {
      archiveReason = 'Duplicate of newer entry (kept newest)';
    } else if (action === 'archive_test_data') {
      archiveReason = 'Test/fake customer data';
    }

    // Batch archive with rate limit protection
    let archivedCount = 0;
    for (let i = 0; i < candidates.length; i += 5) {
      const batch = candidates.slice(i, i + 5);
      try {
        await Promise.all(
          batch.map(item =>
            base44.asServiceRole.entities.OrderReviewQueue.update(item.id, {
              status: 'archived',
              queue_visibility_status: 'archived',
              archived_at: archiveAt,
              archived_by: user.email,
              archived_reason: archiveReason,
            })
          )
        );
        archivedCount += batch.length;
      } catch (batchErr) {
        console.warn(`[BULK-ARCHIVE] Batch ${i}-${i+5} failed, continuing...`, batchErr.message);
        // Continue with next batch even if this one fails
      }
      // Small delay between batches to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Audit log
    await base44.asServiceRole.entities.RepairAuditLog.create({
      timestamp: archiveAt,
      executed_by: user.email,
      repair_function: 'bulkArchiveOrderReviewQueueNoise',
      action: 'cleanup',
      records_affected: archivedCount,
      reason: `Bulk archived queue noise: ${action}`,
      changes: {
        archived_count: archivedCount,
        archive_reason: archiveReason,
        remaining_active: allItems.length - archivedCount,
      },
    });

    console.log(`[BULK-ARCHIVE] Archived ${archivedCount} items via ${action}`);

    return Response.json({
      success: true,
      action: action,
      archived_count: archivedCount,
      remaining_active: allItems.length - archivedCount,
      message: `Archived ${archivedCount} queue items. NOTE: No orders, subscriptions, or Stripe data were modified. Only queue visibility was changed.`,
    });

  } catch (error) {
    console.error('[BULK-ARCHIVE] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});