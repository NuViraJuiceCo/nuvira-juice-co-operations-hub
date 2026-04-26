// DEPRECATED WEBHOOK — DISABLED 2026-04-26
// This endpoint is unsafe because it bypasses safeSyncOrderUpdate protections
// All Customer App order syncs must use pullOrdersFromCustomerApp instead

Deno.serve(async (req) => {
  if (req.method === 'POST') {
    return new Response(JSON.stringify({ 
      error: 'DEPRECATED_ENDPOINT',
      message: 'receiveOrderFromCustomerApp webhook is disabled',
      reason: 'Direct writes bypass safeSyncOrderUpdate gateway and safety protections',
      replacement: 'Use POST /functions/pullOrdersFromCustomerApp instead',
      deprecated_since: '2026-04-26',
      documentation: 'See FULL_APP_ARCHITECTURE_CLEANUP report for details'
    }), { 
      status: 410,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
});