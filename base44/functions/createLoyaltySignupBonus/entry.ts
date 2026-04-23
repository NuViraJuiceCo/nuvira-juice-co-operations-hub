import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const payload = await req.json();
    const { customer_email, points_data } = payload;

    if (!customer_email) {
      return Response.json({ error: 'customer_email required' }, { status: 400 });
    }

    // Update loyalty in hub via unified endpoint
    const result = await base44.functions.invoke('loyaltySync', {
      action: 'update',
      customer_email,
      total_points: points_data?.total_points,
      lifetime_points: points_data?.lifetime_points,
      redeemed_points: points_data?.redeemed_points,
      points_history: points_data?.points_history
    });

    // Push to customer app
    if (CUSTOMER_APP_API && SYNC_SECRET) {
      try {
        await fetch(`${CUSTOMER_APP_API}/functions/receivePointsSync`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SYNC_SECRET}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            event: 'loyalty.updated',
            source: 'hub',
            email: customer_email,
            ...points_data
          }),
        });
        console.log(`[SYNC-HUB] Pushed points for ${customer_email}`);
      } catch (err) {
        console.warn(`[SYNC-HUB] Customer app push failed: ${err.message}`);
        // Don't fail if customer app is down; hub is source of truth
      }
    }

    return Response.json(result);
  } catch (error) {
    console.error('Sync error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});