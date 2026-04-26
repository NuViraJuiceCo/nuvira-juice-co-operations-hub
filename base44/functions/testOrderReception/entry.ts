// DELETED 2026-04-26 — Test function
// Not for production use

Deno.serve(async (req) => {
  console.log('[DELETED] testOrderReception called—test function removed');
  return new Response(JSON.stringify({
    error: 'DELETED_FUNCTION',
    message: 'testOrderReception deleted—test function not for production',
    documentation: 'See FULL_APP_ARCHITECTURE_CLEANUP_FINAL_REPORT.md'
  }), { status: 410, headers: { 'Content-Type': 'application/json' } });
});