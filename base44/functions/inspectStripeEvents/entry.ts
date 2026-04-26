// ARCHIVED 2026-04-26 — Debug function, not needed in production
// Use systemHealthCheck or auditAllOrderWrites for diagnostics

Deno.serve(async (req) => {
  console.log('[ARCHIVED] inspectStripeEvents called—use systemHealthCheck for diagnostics');
  return new Response(JSON.stringify({
    error: 'ARCHIVED_FUNCTION',
    message: 'inspectStripeEvents is archived—debug function no longer needed',
    documentation: 'See FULL_APP_ARCHITECTURE_CLEANUP_FINAL_REPORT.md'
  }), { status: 410, headers: { 'Content-Type': 'application/json' } });
});