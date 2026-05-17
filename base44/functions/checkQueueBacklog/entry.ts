import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * ORDER REVIEW QUEUE BACKLOG MONITOR
 *
 * Runs on a schedule. Alerts admins if the pending queue exceeds the threshold.
 * Prevents silent backlog from masking future issues.
 */

const ALERT_THRESHOLD = 20;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Only count truly active pending records — never sweep archived/resolved/dismissed noise
    const allPending = await base44.asServiceRole.entities.OrderReviewQueue.filter({ status: 'pending' });
    const pending = (allPending || []).filter(item =>
      !item.queue_visibility_status || item.queue_visibility_status === 'active'
    );
    const count = pending.length;

    if (count < ALERT_THRESHOLD) {
      return Response.json({ status: 'ok', pending_count: count, threshold: ALERT_THRESHOLD });
    }

    // Break down by incident type
    const breakdown = {};
    for (const item of pending) {
      const t = item.incident_type || 'unknown';
      breakdown[t] = (breakdown[t] || 0) + 1;
    }
    const breakdownText = Object.entries(breakdown)
      .map(([type, n]) => `  - ${type.replace(/_/g, ' ')}: ${n}`)
      .join('\n');

    const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
    for (const admin of (admins || [])) {
      if (!admin.email) continue;
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: admin.email,
        subject: `🚨 Order Review Queue backlog: ${count} pending items (threshold: ${ALERT_THRESHOLD})`,
        body: `The Order Review Queue has ${count} pending items, exceeding the alert threshold of ${ALERT_THRESHOLD}.\n\nThis may indicate a recurring sync issue or a spike in rejected events that requires attention.\n\n--- Breakdown by Type ---\n${breakdownText}\n\nPlease review and resolve items at:\nOperations Manager → Order Review Queue\n\nItems should be reviewed regularly to prevent masking future issues.`,
      });
    }

    return Response.json({ status: 'alert_sent', pending_count: count, threshold: ALERT_THRESHOLD, breakdown });

  } catch (error) {
    console.error('[QUEUE-BACKLOG]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});