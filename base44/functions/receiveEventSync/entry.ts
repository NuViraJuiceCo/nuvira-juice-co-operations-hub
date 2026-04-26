// DISABLED 2026-04-26 — Consolidation
// Use syncEvents instead (primary event ingest)

Deno.serve(async (req) => {
  console.log('[DISABLED] receiveEventSync called—use syncEvents instead');
  return new Response(JSON.stringify({
    error: 'DISABLED_FUNCTION',
    message: 'receiveEventSync is disabled—use syncEvents (primary)',
    documentation: 'See FULL_APP_ARCHITECTURE_CLEANUP_FINAL_REPORT.md'
  }), { status: 501, headers: { 'Content-Type': 'application/json' } });
});