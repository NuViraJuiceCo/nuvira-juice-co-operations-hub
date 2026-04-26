/**
 * DISABLED — Legacy webhook handler (V2).
 * This endpoint has been permanently disabled.
 * Only stripeCheckoutWebhookHardened is the active webhook handler.
 *
 * ALERT BEHAVIOR: Any hit to this endpoint is a misconfiguration.
 * It logs the event, alerts all admins immediately, and rejects with 410.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  let eventType = 'unknown';
  let payloadSummary = {};

  try {
    const body = await req.text();
    try {
      const parsed = JSON.parse(body);
      eventType = parsed?.type || 'unknown';
      payloadSummary = {
        id: parsed?.id,
        type: parsed?.type,
        customer: parsed?.data?.object?.customer,
        customer_email: parsed?.data?.object?.customer_email || parsed?.data?.object?.customer_details?.email,
        amount: parsed?.data?.object?.amount_total,
        created: parsed?.data?.object?.created,
      };
    } catch { /* body not JSON — still alert */ }

    // Alert admins — fire and forget, don't block the 410 response
    (async () => {
      try {
        const base44 = createClientFromRequest(req);
        const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
        const timestamp = new Date().toISOString();

        // Log to OrderReviewQueue for visibility
        await base44.asServiceRole.entities.OrderReviewQueue.create({
          incident_type: 'source_conflict',
          customer_email: payloadSummary.customer_email || 'unknown',
          incoming_source: 'stripe_webhook',
          incoming_payload: payloadSummary,
          issue_description: `[CRITICAL] Stripe event hit the DISABLED V2 webhook endpoint. Event type: ${eventType}. This means the Stripe Dashboard is incorrectly configured — update the webhook URL to stripeCheckoutWebhookHardened immediately.`,
          recommended_action: 'manual_review',
          status: 'pending',
        });

        // Email all admins immediately
        for (const admin of (admins || [])) {
          if (!admin.email) continue;
          await base44.asServiceRole.integrations.Core.SendEmail({
            to: admin.email,
            subject: `🚨 STRIPE MISCONFIGURATION: Event hit disabled V2 webhook`,
            body: `A Stripe event was sent to the DISABLED legacy webhook endpoint (stripeCheckoutWebhookHardened is the correct URL).\n\nThis means your Stripe Dashboard webhook is pointing to the wrong URL.\n\n--- Event Details ---\nEvent Type: ${eventType}\nTimestamp: ${timestamp}\nPayload Summary:\n${JSON.stringify(payloadSummary, null, 2)}\n\n--- Action Required ---\n1. Log in to Stripe Dashboard → Developers → Webhooks\n2. Ensure ONLY stripeCheckoutWebhookHardened is active\n3. Delete or disable any endpoint pointing to stripeCheckoutWebhookV2\n\nThe event was REJECTED (HTTP 410) — no order was created or modified.`,
          });
        }
      } catch (alertErr) {
        console.error('[STRIPE-V2-DISABLED] Alert failed:', alertErr.message);
      }
    })();

  } catch (err) {
    console.error('[STRIPE-V2-DISABLED] Error reading request:', err.message);
  }

  console.error(`[STRIPE-V2-DISABLED] Hit by event: ${eventType} — rejected 410, admins alerted.`);
  return new Response(JSON.stringify({
    error: 'DISABLED',
    message: 'This legacy webhook endpoint is permanently disabled. Configure Stripe to use stripeCheckoutWebhookHardened.',
    action_required: 'Update your Stripe webhook URL to point to stripeCheckoutWebhookHardened.',
    event_received: eventType,
    alert_sent: true,
  }), { status: 410 });
});