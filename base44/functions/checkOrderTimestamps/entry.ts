// DELETED 2026-04-26 — Debug function
// Use systemHealthCheck for diagnostics

Deno.serve(async (req) => {
  console.log('[DELETED] checkOrderTimestamps called—use systemHealthCheck');
  return new Response(JSON.stringify({
    error: 'DELETED_FUNCTION',
    message: 'checkOrderTimestamps deleted—debug function no longer needed',
    documentation: 'See FULL_APP_ARCHITECTURE_CLEANUP_FINAL_REPORT.md'
  }), { status: 410, headers: { 'Content-Type': 'application/json' } });
});