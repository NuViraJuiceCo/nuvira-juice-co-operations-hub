// ARCHIVED 2026-04-26 — Merged into comprehensiveDataRepair
// Use comprehensiveDataRepair (manual complete) for all cleanup

Deno.serve(async (req) => {
  console.log('[ARCHIVED] cleanupUnknownOrders called—use comprehensiveDataRepair instead');
  return new Response(JSON.stringify({
    error: 'ARCHIVED_FUNCTION',
    message: 'cleanupUnknownOrders is archived—merged into comprehensiveDataRepair',
    documentation: 'See FULL_APP_ARCHITECTURE_CLEANUP_FINAL_REPORT.md'
  }), { status: 410, headers: { 'Content-Type': 'application/json' } });
});