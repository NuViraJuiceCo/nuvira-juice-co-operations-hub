// DEPRECATED WEBHOOK — DISABLED 2026-04-26
// This endpoint is unsafe because it bypasses safeSyncOrderUpdate protections
// All Customer App order syncs must use pullOrdersFromCustomerApp instead

Deno.serve(async (req) => {
  if (req.method === 'POST') {
    console.log('[DEPRECATED] receiveOrderFromCustomerApp called—redirecting to pullOrdersFromCustomerApp');
    return new Response(JSON.stringify({ 
      error: 'DEPRECATED_ENDPOINT',
      message: 'receiveOrderFromCustomerApp webhook is disabled as of 2026-04-26',
      reason: 'Direct writes bypass safeSyncOrderUpdate gateway and safety protections',
      replacement: 'Use pullOrdersFromCustomerApp (scheduled sync) or stripeCheckoutWebhookHardened (Stripe)',
      deprecated_since: '2026-04-26',
      documentation: 'See FULL_APP_ARCHITECTURE_CLEANUP_FINAL_REPORT.md for cleanup details'
    }), { 
      status: 410,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
});