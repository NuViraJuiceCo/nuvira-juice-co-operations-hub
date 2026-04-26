// DISABLED 2026-04-26 — Consolidation
// Use calculateIngredientNeeds instead (primary ingredient calculator)

Deno.serve(async (req) => {
  console.log('[DISABLED] calculateIngredientDemandFixed called—use calculateIngredientNeeds instead');
  return new Response(JSON.stringify({
    error: 'DISABLED_FUNCTION',
    message: 'calculateIngredientDemandFixed is disabled—use calculateIngredientNeeds (primary)',
    documentation: 'See FULL_APP_ARCHITECTURE_CLEANUP_FINAL_REPORT.md'
  }), { status: 501, headers: { 'Content-Type': 'application/json' } });
});