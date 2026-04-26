// ARCHIVED 2026-04-26 — Single-field repair, merged into unifiedOrderRepairWorker
// Use unifiedOrderRepairWorker (manual daily) or comprehensiveDataRepair (manual complete)

Deno.serve(async (req) => {
  console.log('[ARCHIVED] repairOrderLineItems called—use unifiedOrderRepairWorker or comprehensiveDataRepair');
  return new Response(JSON.stringify({
    error: 'ARCHIVED_FUNCTION',
    message: 'repairOrderLineItems is archived—merged into unifiedOrderRepairWorker',
    documentation: 'See FULL_APP_ARCHITECTURE_CLEANUP_FINAL_REPORT.md'
  }), { status: 410, headers: { 'Content-Type': 'application/json' } });
});