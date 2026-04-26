/**
 * DISABLED — Legacy webhook handler (V2).
 * This endpoint has been permanently disabled.
 * Only stripeCheckoutWebhookHardened is the active webhook handler.
 * 
 * If Stripe sends events here, it means the webhook URL in Stripe Dashboard
 * is incorrectly configured. Update Stripe to use stripeCheckoutWebhookHardened.
 */

Deno.serve(async (_req) => {
  console.error('[STRIPE-V2-DISABLED] This legacy webhook handler is disabled. All Stripe events must route to stripeCheckoutWebhookHardened.');
  return new Response(JSON.stringify({
    error: 'DISABLED',
    message: 'This legacy webhook endpoint is permanently disabled. Configure Stripe to use stripeCheckoutWebhookHardened.',
    action_required: 'Update your Stripe webhook URL to point to stripeCheckoutWebhookHardened.',
  }), { status: 410 }); // 410 Gone
});