// DELETED 2026-04-26 — Unsafe direct-write utility
// All order writes must route through safeSyncOrderUpdate gateway

Deno.serve(async (req) => {
  console.log('[DELETED] upsertOrderSafely called—use safeSyncOrderUpdate gateway');
  return new Response(JSON.stringify({
    error: 'DELETED_FUNCTION',
    message: 'upsertOrderSafely deleted—direct writes prohibited',
    replacement: 'Use safeSyncOrderUpdate (only safe order write gateway)',
    documentation: 'See FULL_APP_ARCHITECTURE_CLEANUP_FINAL_REPORT.md'
  }), { status: 410, headers: { 'Content-Type': 'application/json' } });
});