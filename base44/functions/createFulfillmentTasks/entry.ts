import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const DISABLED_MESSAGE = 'createFulfillmentTasks is disabled. Fulfillment tasks must originate from the approved subscription gateway path.';
const REPLACEMENT = 'customerAppEventPublicGateway';

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

    console.log('[createFulfillmentTasks] Disabled legacy fulfillment task creator requested');

    return Response.json({
      deprecated: true,
      mutated: false,
      replacement: REPLACEMENT,
      message: DISABLED_MESSAGE,
    }, { status: 410 });
  } catch (error) {
    console.error('[createFulfillmentTasks] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
