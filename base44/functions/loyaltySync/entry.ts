// DISABLED 2026-04-26 — Consolidation
// Use syncLoyaltyToHub instead (primary loyalty sync)

Deno.serve(async (req) => {
  console.log('[DISABLED] loyaltySync called—use syncLoyaltyToHub instead');
  return new Response(JSON.stringify({
    error: 'DISABLED_FUNCTION',
    message: 'loyaltySync is disabled—use syncLoyaltyToHub (primary)',
    documentation: 'See FULL_APP_ARCHITECTURE_CLEANUP_FINAL_REPORT.md'
  }), { status: 501, headers: { 'Content-Type': 'application/json' } });
});