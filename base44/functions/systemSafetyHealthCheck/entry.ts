// DISABLED 2026-04-26 — Consolidation
// Use systemHealthCheck instead (primary health monitor)

Deno.serve(async (req) => {
  console.log('[DISABLED] systemSafetyHealthCheck called—use systemHealthCheck instead');
  return new Response(JSON.stringify({
    error: 'DISABLED_FUNCTION',
    message: 'systemSafetyHealthCheck is disabled—use systemHealthCheck (primary)',
    documentation: 'See FULL_APP_ARCHITECTURE_CLEANUP_FINAL_REPORT.md'
  }), { status: 501, headers: { 'Content-Type': 'application/json' } });
});