import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const DISABLED_MESSAGE = 'createProductionBatch is disabled. Production batch demand must originate from the approved gateway path.';
const REPLACEMENT = 'customerAppEventPublicGateway -> triggerBatchDemandForDates';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    if (!user) {
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    if (user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.log('[createProductionBatch] Disabled legacy production batch creator requested');

    return Response.json({
      deprecated: true,
      mutated: false,
      replacement: REPLACEMENT,
      message: DISABLED_MESSAGE,
    }, { status: 410 });
  } catch (error) {
    console.error('[createProductionBatch] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
