// ARCHIVED 2026-04-26 — Defensive webhook replaced by hardened variant
// Use stripeCheckoutWebhookHardened instead (primary production webhook)

Deno.serve(async (req) => {
  if (req.method === 'POST') {
    console.log('[ARCHIVED] stripeCheckoutWebhookDefensive called—use stripeCheckoutWebhookHardened');
    return new Response(JSON.stringify({
      error: 'ARCHIVED_WEBHOOK',
      message: 'stripeCheckoutWebhookDefensive is archived as of 2026-04-26',
      reason: 'Functionality consolidated into stripeCheckoutWebhookHardened',
      replacement: 'stripeCheckoutWebhookHardened (primary production webhook)',
      documentation: 'See FULL_APP_ARCHITECTURE_CLEANUP_FINAL_REPORT.md'
    }), { status: 410, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
});