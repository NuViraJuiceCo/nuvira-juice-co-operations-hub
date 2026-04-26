// DISABLED 2026-04-26 — Consolidation
// Use syncLoyaltyToHub instead (single direction)

Deno.serve(async (req) => {
  console.log('[DISABLED] pushLoyaltyMemberUpdate called—use syncLoyaltyToHub instead');
  return new Response(JSON.stringify({
    error: 'DISABLED_FUNCTION',
    message: 'pushLoyaltyMemberUpdate is disabled—use syncLoyaltyToHub (primary)',
    documentation: 'See FULL_APP_ARCHITECTURE_CLEANUP_FINAL_REPORT.md'
  }), { status: 501, headers: { 'Content-Type': 'application/json' } });
});