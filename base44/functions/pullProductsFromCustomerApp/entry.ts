// DISABLED 2026-04-26 — Consolidation
// Use syncProducts instead (primary product sync direction)

Deno.serve(async (req) => {
  console.log('[DISABLED] pullProductsFromCustomerApp called—use syncProducts instead');
  return new Response(JSON.stringify({
    error: 'DISABLED_FUNCTION',
    message: 'pullProductsFromCustomerApp is disabled—use syncProducts (primary)',
    documentation: 'See FULL_APP_ARCHITECTURE_CLEANUP_FINAL_REPORT.md'
  }), { status: 501, headers: { 'Content-Type': 'application/json' } });
});