import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * TEST HELPER: Log a subscription event for verification testing
 * Use this to mark a subscription as webhook-processed for test verification
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const { stripe_subscription_id, stripe_customer_id, customer_email } = body;

    if (!stripe_subscription_id) {
      return Response.json({ error: 'stripe_subscription_id required' }, { status: 400 });
    }

    // Create test StripeEventLog entry
    const event = await base44.asServiceRole.entities.StripeEventLog.create({
      stripe_event_id: `test_event_${Date.now()}`,
      event_type: 'customer.subscription.created',
      stripe_object_id: stripe_subscription_id,
      stripe_subscription_id: stripe_subscription_id,
      stripe_customer_id: stripe_customer_id || null,
      customer_email: customer_email || null,
      status: 'processed',
      notes: `Test event for verification - subscription fulfillments generated`,
    });

    return Response.json({
      success: true,
      event_id: event.id,
      stripe_event_id: event.stripe_event_id,
      message: `Test event logged for subscription ${stripe_subscription_id}`,
    });
  } catch (error) {
    console.error('[LOG-TEST-EVENT]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});