/**
 * DISABLED — Legacy direct-write order gateway.
 * This function has been permanently disabled.
 * All order writes must route through safeSyncOrderUpdate.
 * 
 * Audit result: No active callers found in StripeRepair, OperationsManager,
 * or any other deployed function. Safe to disable.
 * 
 * If you receive a call to this endpoint, it means a legacy code path was not
 * fully migrated. Identify the caller and update it to use safeSyncOrderUpdate.
 */

Deno.serve(async (_req) => {
  console.error('[UPSERT-ORDER-DISABLED] This legacy gateway is disabled. All order writes must use safeSyncOrderUpdate.');
  return new Response(JSON.stringify({
    error: 'DISABLED',
    message: 'This legacy order gateway is permanently disabled. Use safeSyncOrderUpdate for all order writes.',
    migration_target: 'safeSyncOrderUpdate',
  }), { status: 410 }); // 410 Gone
});