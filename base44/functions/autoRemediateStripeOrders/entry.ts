// DISABLED 2026-04-26 — Auto-repair is dangerous
// Use unifiedOrderRepairWorker (manual) or comprehensiveDataRepair (manual) instead

Deno.serve(async (req) => {
  console.log('[DISABLED] autoRemediateStripeOrders called—use unifiedOrderRepairWorker or comprehensiveDataRepair instead');
  return new Response(JSON.stringify({
    error: 'DISABLED_FUNCTION',
    message: 'autoRemediateStripeOrders is disabled as of 2026-04-26',
    reason: 'Automatic repair on Stripe-linked orders is dangerous and can cause data corruption',
    replacement: 'Use unifiedOrderRepairWorker (manual daily) or comprehensiveDataRepair (manual complete)',
    documentation: 'See FULL_APP_ARCHITECTURE_CLEANUP_FINAL_REPORT.md for cleanup details'
  }), { status: 501, headers: { 'Content-Type': 'application/json' } });
});