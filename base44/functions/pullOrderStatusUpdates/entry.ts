// DISABLED 2026-04-26 — Consolidation
// Use pullOrdersFromCustomerApp instead (covers status via main order ingest)

Deno.serve(async (req) => {
  console.log('[DISABLED] pullOrderStatusUpdates called—use pullOrdersFromCustomerApp instead');
  return new Response(JSON.stringify({
    error: 'DISABLED_FUNCTION',
    message: 'pullOrderStatusUpdates is disabled—use pullOrdersFromCustomerApp (primary)',
    documentation: 'See FULL_APP_ARCHITECTURE_CLEANUP_FINAL_REPORT.md'
  }), { status: 501, headers: { 'Content-Type': 'application/json' } });
});