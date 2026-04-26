// ARCHIVED 2026-04-26 — Covered by stripeCheckoutWebhookHardened
// Use stripeCheckoutWebhookHardened (real-time webhook handler)

Deno.serve(async (req) => {
  console.log('[ARCHIVED] pullStripeSubscriptionOrder called—use stripeCheckoutWebhookHardened');
  return new Response(JSON.stringify({
    error: 'ARCHIVED_FUNCTION',
    message: 'pullStripeSubscriptionOrder is archived—functionality in stripeCheckoutWebhookHardened',
    documentation: 'See FULL_APP_ARCHITECTURE_CLEANUP_FINAL_REPORT.md'
  }), { status: 410, headers: { 'Content-Type': 'application/json' } });
});