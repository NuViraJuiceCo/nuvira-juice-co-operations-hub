import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * classifyOrderReviewQueue
 *
 * Classifies all pending OrderReviewQueue entries into categories:
 *   - resolved_by_address_sync: delivery order now has an address
 *   - duplicate_retry_spam: same order+source has 3+ identical pending entries
 *   - fake_test_contamination: contains fake/test Stripe IDs
 *   - old_pre_fix_records: created before the address-gate fix (before 2026-05-02)
 *   - real_missing_info: genuine unresolved orders needing admin attention
 *
 * With action=dry_run (default): returns classification report only
 * With action=bulk_resolve: resolves verified-safe categories, leaves real issues open
 */

const ADDRESS_GATE_FIX_DATE = new Date('2026-05-02T00:00:00.000Z');

function isFakeStripeId(id) {
  if (!id) return false;
  return (
    id.includes('UNIQUE') ||
    id.includes('_TEST_') ||
    id.toLowerCase().includes('test_') ||
    id.toLowerCase().includes('fake_') ||
    id.toLowerCase().includes('placeholder') ||
    (id.startsWith('cs_live_') && id.length < 30) ||
    id === 'pi_UNIQUE_INTENT_FOR_SECOND' ||
    id === 'cs_live_UNIQUE_SESSION_ID_FOR_SECOND_ORDER'
  );
}

function classifyEntry(entry, existingOrderMap, resolvedOrderNumbers) {
  const payload = entry.incoming_payload || {};
  const createdAt = new Date(entry.created_date);

  // 1. Fake/test contamination
  if (
    isFakeStripeId(payload.stripe_checkout_session_id) ||
    isFakeStripeId(payload.stripe_payment_intent_id)
  ) {
    return 'fake_test_contamination';
  }

  // 2. Resolved by address sync — delivery_order_missing_address entries where order now has address
  if (
    entry.incident_type === 'missing_customer_info' &&
    (entry.issue_description || '').toLowerCase().includes('address')
  ) {
    const orderNum = payload.shopify_order_number || entry.existing_order_number;
    if (orderNum && resolvedOrderNumbers.has(orderNum)) {
      return 'resolved_by_address_sync';
    }
  }

  // 3. Old pre-fix records (created before address gate fix, incident related to address)
  if (
    createdAt < ADDRESS_GATE_FIX_DATE &&
    (entry.incident_type === 'missing_customer_info' || entry.incident_type === 'incomplete_payload') &&
    (entry.issue_description || '').toLowerCase().includes('address')
  ) {
    return 'old_pre_fix_record';
  }

  // 4. Real missing info — genuine unresolved orders
  return 'real_missing_info';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action || 'dry_run'; // 'dry_run' | 'bulk_resolve'

    // Load all pending queue entries
    const allPending = await base44.asServiceRole.entities.OrderReviewQueue.filter({ status: 'pending' });
    console.log(`[CLASSIFY-QUEUE] Found ${allPending.length} pending entries`);

    // Load orders that now have complete addresses (to detect "resolved_by_address_sync")
    const ordersWithAddress = await base44.asServiceRole.entities.ShopifyOrder.filter({ payment_status: 'paid' });
    const resolvedOrderNumbers = new Set(
      ordersWithAddress
        .filter(o => o.address_line1 && o.address_city && o.address_state && o.address_postal_code)
        .map(o => o.shopify_order_number)
    );

    // Detect duplicate retry spam: same order_number + incident_type with 3+ pending entries
    const duplicateCounts = {};
    for (const entry of allPending) {
      const key = `${entry.incoming_payload?.shopify_order_number || entry.existing_order_number}::${entry.incident_type}::${entry.incoming_source}`;
      duplicateCounts[key] = (duplicateCounts[key] || []);
      duplicateCounts[key].push(entry.id);
    }
    const spamKeys = new Set(
      Object.entries(duplicateCounts)
        .filter(([, ids]) => ids.length >= 3)
        .map(([key]) => key)
    );

    // Classify all entries
    const classified = {
      fake_test_contamination: [],
      resolved_by_address_sync: [],
      duplicate_retry_spam: [],
      old_pre_fix_record: [],
      real_missing_info: [],
    };

    for (const entry of allPending) {
      const payload = entry.incoming_payload || {};
      const spamKey = `${payload.shopify_order_number || entry.existing_order_number}::${entry.incident_type}::${entry.incoming_source}`;

      if (spamKeys.has(spamKey)) {
        classified.duplicate_retry_spam.push(entry);
      } else {
        const cat = classifyEntry(entry, null, resolvedOrderNumbers);
        classified[cat].push(entry);
      }
    }

    const report = {
      total_pending: allPending.length,
      by_category: {
        fake_test_contamination: classified.fake_test_contamination.length,
        resolved_by_address_sync: classified.resolved_by_address_sync.length,
        duplicate_retry_spam: classified.duplicate_retry_spam.length,
        old_pre_fix_record: classified.old_pre_fix_record.length,
        real_missing_info: classified.real_missing_info.length,
      },
      safe_to_resolve: classified.fake_test_contamination.length +
        classified.resolved_by_address_sync.length +
        classified.duplicate_retry_spam.length +
        classified.old_pre_fix_record.length,
      real_issues_remaining: classified.real_missing_info.length,
    };

    if (action === 'dry_run') {
      return Response.json({
        success: true,
        action: 'dry_run',
        report,
        preview: {
          fake_test_contamination: classified.fake_test_contamination.slice(0, 5).map(e => ({
            id: e.id, incident_type: e.incident_type, customer_email: e.customer_email, created: e.created_date,
          })),
          resolved_by_address_sync: classified.resolved_by_address_sync.slice(0, 5).map(e => ({
            id: e.id, incident_type: e.incident_type, customer_email: e.customer_email, order: e.existing_order_number, created: e.created_date,
          })),
          duplicate_retry_spam: classified.duplicate_retry_spam.slice(0, 5).map(e => ({
            id: e.id, incident_type: e.incident_type, customer_email: e.customer_email, created: e.created_date,
          })),
          old_pre_fix_record: classified.old_pre_fix_record.slice(0, 5).map(e => ({
            id: e.id, incident_type: e.incident_type, customer_email: e.customer_email, created: e.created_date,
          })),
          real_missing_info: classified.real_missing_info.map(e => ({
            id: e.id, incident_type: e.incident_type, customer_email: e.customer_email,
            customer_name: e.customer_name, order: e.existing_order_number || e.incoming_payload?.shopify_order_number,
            issue: e.issue_description, created: e.created_date,
          })),
        },
      });
    }

    if (action === 'bulk_resolve') {
      // Resolve all safe-to-resolve categories
      const toResolve = [
        ...classified.fake_test_contamination,
        ...classified.resolved_by_address_sync,
        ...classified.duplicate_retry_spam,
        ...classified.old_pre_fix_record,
      ];

      const resolveAt = new Date().toISOString();
      let resolvedCount = 0;

      // Batch resolve in chunks of 10 to avoid timeouts
      for (let i = 0; i < toResolve.length; i += 10) {
        const batch = toResolve.slice(i, i + 10);
        await Promise.all(batch.map(entry => {
          const category = classified.fake_test_contamination.includes(entry) ? 'fake_test_contamination'
            : classified.resolved_by_address_sync.includes(entry) ? 'resolved_by_address_sync'
            : classified.duplicate_retry_spam.includes(entry) ? 'duplicate_retry_spam'
            : 'old_pre_fix_record';

          return base44.asServiceRole.entities.OrderReviewQueue.update(entry.id, {
            status: 'resolved',
            resolved_action: `Bulk resolved by classifyOrderReviewQueue — category: ${category}`,
            resolved_at: resolveAt,
            resolved_by: user.email,
          });
        }));
        resolvedCount += batch.length;
      }

      // Log the operation
      await base44.asServiceRole.entities.RepairAuditLog.create({
        timestamp: resolveAt,
        executed_by: user.email,
        repair_function: 'cleanupOrphanedAndDuplicateRecords',
        action: 'cleanup',
        records_affected: resolvedCount,
        reason: 'Admin bulk-resolved safe OrderReviewQueue entries via classifyOrderReviewQueue',
        changes: {
          resolved: resolvedCount,
          real_issues_left_open: classified.real_missing_info.length,
          categories_resolved: ['fake_test_contamination', 'resolved_by_address_sync', 'duplicate_retry_spam', 'old_pre_fix_record'],
        },
      });

      return Response.json({
        success: true,
        action: 'bulk_resolve',
        resolved_count: resolvedCount,
        real_issues_remaining: classified.real_missing_info.length,
        real_issues: classified.real_missing_info.map(e => ({
          id: e.id,
          incident_type: e.incident_type,
          customer_email: e.customer_email,
          customer_name: e.customer_name,
          order: e.existing_order_number || e.incoming_payload?.shopify_order_number,
          issue: e.issue_description,
        })),
      });
    }

    return Response.json({ error: 'Invalid action. Use dry_run or bulk_resolve.' }, { status: 400 });

  } catch (error) {
    console.error('[CLASSIFY-QUEUE] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});