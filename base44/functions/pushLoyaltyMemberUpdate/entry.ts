import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { customer_email, total_points, lifetime_points, redeemed_points, points_history } = await req.json();

    if (!customer_email) {
      return Response.json({ error: 'Missing customer_email' }, { status: 400 });
    }

    if (!CUSTOMER_APP_API || !SYNC_SECRET) {
      return Response.json({ error: 'Customer app not configured' }, { status: 500 });
    }

    // Send updated member data to customer app via receivePointsSync endpoint
    const response = await fetch(`${CUSTOMER_APP_API}/functions/receivePointsSync`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SYNC_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customers: [{
          customer_email,
          email: customer_email,
          total_points: total_points || 0,
          lifetime_points: lifetime_points || 0,
          redeemed_points: redeemed_points || 0,
          points_history: points_history || []
        }]
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[PUSH-LOYALTY] Failed to push update: ${response.status} - ${text}`);
      return Response.json({ error: 'Failed to sync to customer app' }, { status: 500 });
    }

    console.log(`[PUSH-LOYALTY] Updated ${customer_email} in customer app`);
    return Response.json({ status: 'success', message: 'Member updated in customer app' });
  } catch (error) {
    console.error('[PUSH-LOYALTY] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});