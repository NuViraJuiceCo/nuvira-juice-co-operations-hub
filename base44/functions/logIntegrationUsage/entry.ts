import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * logIntegrationUsage - Record integration credit consumption
 * Call this at the end of any function that uses Stripe, API calls, or database writes.
 *
 * Payload:
 * {
 *   function_name: "syncRecentShopifyOrders",
 *   automation_id: "6a06c1f0e888e57a94a3fc63" (optional),
 *   automation_name: "Shopify POS Sync — Normal Mode (10 minutes)" (optional),
 *   status: "success",
 *   estimated_credits_used: 5,
 *   records_written: 2,
 *   records_skipped: 48,
 *   api_calls: 1,
 *   notes: "POS sync completed with 50 orders processed"
 * }
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const {
      function_name,
      automation_id = null,
      automation_name = null,
      status = 'success',
      estimated_credits_used = 0,
      records_written = 0,
      records_skipped = 0,
      api_calls = 0,
      notes = '',
    } = body;

    if (!function_name) {
      return Response.json({ error: 'function_name required' }, { status: 400 });
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      function_name,
      automation_id,
      automation_name,
      status,
      estimated_credits_used,
      records_written,
      records_skipped,
      api_calls,
      notes,
    };

    // Create the log entry (fire-and-forget, non-critical)
    await base44.asServiceRole.entities.IntegrationUsageLog.create(logEntry);

    // Check for daily budget warning (1000 credits/day = 41.67/hour)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const dailyLogs = await base44.asServiceRole.entities.IntegrationUsageLog.filter(
      { timestamp: { '$gte': oneDayAgo } }
    );
    const dailyUsage = dailyLogs.reduce((sum, log) => sum + (log.estimated_credits_used || 0), 0);

    if (dailyUsage > 1000) {
      console.warn(`[USAGE-LOG] ⚠️ DAILY BUDGET WARNING: ${Math.round(dailyUsage)} credits used in last 24h (limit: 1000)`);
      // Optionally: create a HubAlert here for admin notification
    }

    return Response.json({ status: 'logged', daily_usage: dailyUsage });
  } catch (error) {
    console.error('[USAGE-LOG]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});