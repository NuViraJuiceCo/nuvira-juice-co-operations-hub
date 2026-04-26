// DELETED 2026-04-26 — Debug function
// Use systemHealthCheck for sync diagnostics

Deno.serve(async (req) => {
  console.log('[DELETED] checkLatestOrderSync called—use systemHealthCheck');
  return new Response(JSON.stringify({
    error: 'DELETED_FUNCTION',
    message: 'checkLatestOrderSync deleted—debug function merged into systemHealthCheck',
    documentation: 'See FULL_APP_ARCHITECTURE_CLEANUP_FINAL_REPORT.md'
  }), { status: 410, headers: { 'Content-Type': 'application/json' } });
});