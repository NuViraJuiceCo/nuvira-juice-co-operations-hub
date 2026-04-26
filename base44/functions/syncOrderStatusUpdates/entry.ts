// DISABLED 2026-04-26 — Consolidation
// Use pushOrderStatusToCustomerApp instead (primary order status sync)

Deno.serve(async (req) => {
  console.log('[DISABLED] syncOrderStatusUpdates called—use pushOrderStatusToCustomerApp instead');
  return new Response(JSON.stringify({
    error: 'DISABLED_FUNCTION',
    message: 'syncOrderStatusUpdates is disabled—use pushOrderStatusToCustomerApp (primary)',
    documentation: 'See FULL_APP_ARCHITECTURE_CLEANUP_FINAL_REPORT.md'
  }), { status: 501, headers: { 'Content-Type': 'application/json' } });
});