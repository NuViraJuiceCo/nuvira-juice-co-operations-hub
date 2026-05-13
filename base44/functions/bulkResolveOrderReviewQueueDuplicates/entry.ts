import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * bulkResolveOrderReviewQueueDuplicates
 *
 * Safe admin action to bulk-resolve duplicate Order Review Queue alerts by grouping
 * them into unique issue buckets (idempotency_key) and resolving all but the most recent.
 *
 * This prevents the queue from being flooded with identical repeated alerts while
 * preserving at least one entry per unique issue for admin awareness.
 *
 * Action: dry_run (default) — report grouped duplicates
 * Action: bulk_resolve — keep latest of each group, resolve others
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action || 'dry_run'; // 'dry_run' | 'bulk_resolve'

    // Load all pending alerts
    const allPending = await base44.asServiceRole.entities.OrderReviewQueue.filter({
      status: 'pending',
    });
    console.log(`[BULK-RESOLVE] Found ${allPending.length} pending queue entries`);

    // Group by idempotency_key or synthesize one for old entries lacking it
    const groups = {};
    for (const entry of allPending) {
      let key = entry.idempotency_key;
      
      // Fallback: synthesize key for old entries
      if (!key) {
        const orderIdent = entry.existing_order_id || 
                           entry.incoming_payload?.stripe_subscription_id || 
                           entry.incoming_payload?.stripe_checkout_session_id || 
                           entry.existing_order_number || 
                           'unknown';
        key = `${entry.incoming_source || 'unknown'}::${entry.incident_type}::${entry.customer_email || 'no-email'}::${orderIdent}`;
      }

      if (!groups[key]) groups[key] = [];
      groups[key].push(entry);
    }

    console.log(`[BULK-RESOLVE] Grouped into ${Object.keys(groups).length} unique issues`);

    // Identify duplicates and singles
    const duplicateGroups = Object.entries(groups).filter(([, entries]) => entries.length > 1);
    const duplicateCount = duplicateGroups.reduce((sum, [, entries]) => sum + entries.length - 1, 0);

    const report = {
      total_pending: allPending.length,
      unique_issues: Object.keys(groups).length,
      groups_with_duplicates: duplicateGroups.length,
      duplicate_entries_to_resolve: duplicateCount,
      safe_to_resolve: duplicateCount,
    };

    if (action === 'dry_run') {
      // Show sample groupings
      const samples = duplicateGroups.slice(0, 3).map(([key, entries]) => ({
        issue_key: key,
        count: entries.length,
        customer_email: entries[0].customer_email,
        incident_type: entries[0].incident_type,
        oldest: entries.sort((a, b) => 
          new Date(a.created_date) - new Date(b.created_date)
        )[0].created_date,
        newest: entries.sort((a, b) => 
          new Date(b.created_date) - new Date(a.created_date)
        )[0].created_date,
      }));

      return Response.json({
        success: true,
        action: 'dry_run',
        report,
        sample_duplicate_groups: samples,
        note: 'To proceed with bulk resolution, call again with action=bulk_resolve',
      });
    }

    if (action === 'bulk_resolve') {
      const now = new Date().toISOString();
      let resolvedCount = 0;

      // For each duplicate group: keep latest, resolve all others
      for (const [key, entries] of Object.entries(groups)) {
        if (entries.length <= 1) continue; // Skip unique issues

        // Sort by created_date, keep the newest
        const sorted = entries.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
        const newest = sorted[0];
        const toResolve = sorted.slice(1); // All but newest

        // Batch resolve in parallel
        await Promise.all(
          toResolve.map(entry =>
            base44.asServiceRole.entities.OrderReviewQueue.update(entry.id, {
              status: 'resolved',
              resolved_action: `Bulk resolved by bulkResolveOrderReviewQueueDuplicates — kept newer entry ${newest.id}`,
              resolved_at: now,
              resolved_by: user.email,
            })
          )
        );

        resolvedCount += toResolve.length;
        console.log(`[BULK-RESOLVE] Resolved ${toResolve.length} duplicates for key: ${key.substring(0, 50)}...`);
      }

      // Audit log
      await base44.asServiceRole.entities.RepairAuditLog.create({
        timestamp: now,
        executed_by: user.email,
        repair_function: 'bulkResolveOrderReviewQueueDuplicates',
        action: 'cleanup',
        records_affected: resolvedCount,
        reason: 'Admin bulk-resolved duplicate OrderReviewQueue alerts grouped by idempotency_key',
        changes: {
          resolved_duplicates: resolvedCount,
          unique_issues_remaining: Object.keys(groups).length,
          groups_affected: duplicateGroups.length,
        },
      });

      return Response.json({
        success: true,
        action: 'bulk_resolve',
        resolved_count: resolvedCount,
        unique_issues_remaining: Object.keys(groups).length,
        message: `Resolved ${resolvedCount} duplicate alerts. Kept 1 latest entry per unique issue.`,
      });
    }

    return Response.json({ error: 'Invalid action. Use dry_run or bulk_resolve.' }, { status: 400 });

  } catch (error) {
    console.error('[BULK-RESOLVE] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});