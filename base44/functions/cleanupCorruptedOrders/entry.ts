// ARCHIVED 2026-04-26 — Overlaps with comprehensiveDataRepair
// Use comprehensiveDataRepair (manual complete)

Deno.serve(async (req) => {
  console.log('[ARCHIVED] cleanupCorruptedOrders called—use comprehensiveDataRepair');
  return new Response(JSON.stringify({
    error: 'ARCHIVED_FUNCTION',
    message: 'cleanupCorruptedOrders is archived—functionality merged into comprehensiveDataRepair',
    documentation: 'See FULL_APP_ARCHITECTURE_CLEANUP_FINAL_REPORT.md'
  }), { status: 410, headers: { 'Content-Type': 'application/json' } });
});