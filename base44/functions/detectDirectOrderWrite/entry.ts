import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * REGRESSION GUARD — Detects direct ShopifyOrder writes that bypass safeSyncOrderUpdate.
 *
 * How it works:
 * - Compares recent ShopifyOrder updated_date timestamps against OrderSyncLog entries
 * - Any order updated recently with NO corresponding sync log entry = potential bypass write
 * - Alerts admins if bypass writes are detected
 *
 * Run on a schedule (every 30 min) or manually from OperationsManager.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Allow scheduled invocations (no user session) and admin users
    const user = await base44.auth.me().catch(() => null);
    if (user && user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const windowMinutes = 60; // Look back 60 minutes
    const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

    // Get all orders updated in the window
    const recentOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-updated_date', 200);
    const ordersInWindow = recentOrders.filter(o => o.updated_date && o.updated_date > windowStart);

    // Get all sync log entries in the window
    const recentLogs = await base44.asServiceRole.entities.OrderSyncLog.list('-sync_timestamp', 500);
    const logsInWindow = recentLogs.filter(l => l.sync_timestamp && l.sync_timestamp > windowStart);

    const normalizeOrderNumber = (value) => String(value || '').trim().toLowerCase();

    // Build set of order IDs/numbers that have a sync log entry. Some older
    // approved operational paths logged by order_number before order_id was
    // consistently populated.
    const loggedOrderIds = new Set(logsInWindow.map(l => l.order_id).filter(Boolean));
    const loggedOrderNumbers = new Set(logsInWindow.map(l => normalizeOrderNumber(l.order_number)).filter(Boolean));

    // Loyalty repairs can create UserPoints records linked by order_id. In Base44,
    // that relationship may advance the parent ShopifyOrder.updated_date even
    // though no ShopifyOrder fields were changed. Treat those as known relation
    // touches, not order-write bypasses.
    const recentUserPoints = await base44.asServiceRole.entities.UserPoints.list('-created_date', 500).catch(() => []);
    const loyaltyTouchTimesByOrderId = new Map<string, number[]>();
    for (const p of (recentUserPoints || [])) {
      if (!p.order_id) continue;
      const touchTimestamps = [p.created_date, p.updated_date].filter(ts => ts && ts > windowStart);
      if (touchTimestamps.length === 0) continue;
      const existing = loyaltyTouchTimesByOrderId.get(p.order_id) || [];
      existing.push(...touchTimestamps.map(ts => new Date(ts).getTime()).filter(Boolean));
      loyaltyTouchTimesByOrderId.set(p.order_id, existing);
    }

    // Find orders updated with no corresponding log entry
    // Exclude orders that were JUST created (same minute) — creation may not have a log yet
    const bypassCandidates = ordersInWindow.filter(o => {
      if (!o.id) return false;
      if (loggedOrderIds.has(o.id)) return false;
      if (loggedOrderNumbers.has(normalizeOrderNumber(o.shopify_order_number))) return false;
      const loyaltyTouchTimes = loyaltyTouchTimesByOrderId.get(o.id) || [];
      const orderUpdatedAt = new Date(o.updated_date).getTime();
      if (loyaltyTouchTimes.some((t: number) => Math.abs(orderUpdatedAt - t) < 5 * 60 * 1000)) return false;
      // Skip very recent (within 2 min) — log may not have written yet
      const updatedAge = Date.now() - new Date(o.updated_date).getTime();
      if (updatedAge < 2 * 60 * 1000) return false;
      return true;
    });

    if (bypassCandidates.length === 0) {
      return Response.json({
        status: 'clean',
        message: `No bypass writes detected in last ${windowMinutes} minutes`,
        orders_checked: ordersInWindow.length,
        logs_checked: logsInWindow.length,
        loyalty_relation_touches_seen: loyaltyTouchTimesByOrderId.size,
      });
    }

    // Alert admins
    const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
    const summary = bypassCandidates.map(o => `  - ${o.shopify_order_number} (${o.customer_email}) updated at ${o.updated_date}`).join('\n');

    for (const admin of (admins || [])) {
      if (!admin.email) continue;
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: admin.email,
        subject: `⚠️ Possible direct ShopifyOrder write detected (bypass regression guard)`,
        body: `The regression guard detected ${bypassCandidates.length} ShopifyOrder record(s) updated in the last ${windowMinutes} minutes with no corresponding OrderSyncLog entry.\n\nThis may indicate a direct .create() or .update() write that bypassed safeSyncOrderUpdate.\n\n--- Suspicious Orders ---\n${summary}\n\nPlease review these orders and audit any recently deployed functions for direct ShopifyOrder writes.\n\nThis alert was generated by detectDirectOrderWrite.`,
      });
    }

    // Log to OrderReviewQueue
    await base44.asServiceRole.entities.OrderReviewQueue.create({
      incident_type: 'source_conflict',
      customer_email: bypassCandidates[0]?.customer_email || 'multiple',
      incoming_source: 'scheduled_sync',
      incoming_payload: { bypass_candidates: bypassCandidates.map(o => ({ id: o.id, order_number: o.shopify_order_number, updated: o.updated_date })) },
      issue_description: `Regression guard: ${bypassCandidates.length} order(s) updated with no sync log entry. Possible direct write bypassing safeSyncOrderUpdate.`,
      recommended_action: 'manual_review',
      status: 'pending',
    });

    return Response.json({
      status: 'alert_sent',
      bypass_candidates: bypassCandidates.length,
      loyalty_relation_touches_seen: loyaltyTouchTimesByOrderId.size,
      orders: bypassCandidates.map(o => ({ id: o.id, order_number: o.shopify_order_number, email: o.customer_email, updated: o.updated_date })),
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[REGRESSION-GUARD]', message);
    return Response.json({ error: message }, { status: 500 });
  }
});
