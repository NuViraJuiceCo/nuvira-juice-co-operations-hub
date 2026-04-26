// DELETED 2026-04-26 — One-time cleanup script
// Obsolete, no longer applicable

Deno.serve(async (req) => {
  console.log('[DELETED] deleteMay2Batches called—one-time cleanup script removed');
  return new Response(JSON.stringify({
    error: 'DELETED_FUNCTION',
    message: 'deleteMay2Batches deleted—one-time cleanup script obsolete',
    documentation: 'See FULL_APP_ARCHITECTURE_CLEANUP_FINAL_REPORT.md'
  }), { status: 410, headers: { 'Content-Type': 'application/json' } });
});