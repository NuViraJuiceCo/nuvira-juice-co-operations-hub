import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Triggered by entity automation when a new OrderReviewQueue record is created.
 * Sends an admin alert email so issues are never silently ignored.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const item = body.data;
    if (!item) {
      return Response.json({ status: 'no_data' });
    }

    // Get all admin users to notify
    const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
    const adminEmails = admins.map(u => u.email).filter(Boolean);

    if (adminEmails.length === 0) {
      console.warn('[QUEUE-ALERT] No admin users found to notify');
      return Response.json({ status: 'no_admins' });
    }

    const incidentLabels = {
      unknown_order_attempt: '🚫 Unknown Order Blocked',
      subscription_downgrade_attempt: '⚠️ Subscription Downgrade Blocked',
      incomplete_payload: '⚠️ Incomplete Payload Quarantined',
      duplicate_event: 'ℹ️ Duplicate Stripe Event',
      missing_subscription_metadata: '⚠️ Missing Subscription Metadata',
      recovery_needs_review: '🔧 Recovery Needs Review',
      overwrite_rejection: '🚫 Overwrite Rejected',
      source_conflict: '⚠️ Source Conflict',
    };

    const label = incidentLabels[item.incident_type] || `⚠️ ${item.incident_type}`;

    for (const email of adminEmails) {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: email,
        subject: `[NuVira Hub] Order Review Required: ${label}`,
        body: `An order issue has been quarantined and requires your review.

Incident Type: ${item.incident_type}
Customer: ${item.customer_name || 'Unknown'} (${item.customer_email || 'no email'})
Source: ${item.incoming_source}
Issue: ${item.issue_description}
Recommended Action: ${item.recommended_action}

${item.existing_order_number ? `Existing Order: ${item.existing_order_number}` : ''}

Review it at: Hub → Order Review Queue

This is an automated alert from the NuVira Order Protection System.`,
      });
    }

    console.log(`[QUEUE-ALERT] Notified ${adminEmails.length} admin(s) about ${item.incident_type}`);
    return Response.json({ status: 'ok', notified: adminEmails.length });

  } catch (error) {
    console.error('[QUEUE-ALERT] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});