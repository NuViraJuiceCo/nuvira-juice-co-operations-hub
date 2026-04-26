// ARCHIVED 2026-04-26 — Overlaps with unifiedOrderRepairWorker
// Use unifiedOrderRepairWorker (manual daily) or comprehensiveDataRepair (manual complete)

Deno.serve(async (req) => {
  console.log('[ARCHIVED] recoverStripeSubscriptionWithValidation called—use unifiedOrderRepairWorker or comprehensiveDataRepair');
  return new Response(JSON.stringify({
    error: 'ARCHIVED_FUNCTION',
    message: 'recoverStripeSubscriptionWithValidation is archived—functionality merged into master repair workers',
    documentation: 'See FULL_APP_ARCHITECTURE_CLEANUP_FINAL_REPORT.md'
  }), { status: 410, headers: { 'Content-Type': 'application/json' } });
});