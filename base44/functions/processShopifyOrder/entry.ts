// DELETED 2026-04-26 — Replaced by safeSyncOrderUpdate
// All Shopify order ingestion now routes through safe gateway

Deno.serve(async (req) => {
  console.log('[DELETED] processShopifyOrder called—use safeSyncOrderUpdate');
  return new Response(JSON.stringify({
    error: 'DELETED_FUNCTION',
    message: 'processShopifyOrder deleted—use safeSyncOrderUpdate gateway',
    documentation: 'See FULL_APP_ARCHITECTURE_CLEANUP_FINAL_REPORT.md'
  }), { status: 410, headers: { 'Content-Type': 'application/json' } });
});