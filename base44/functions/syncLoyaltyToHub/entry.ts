import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user?.role === 'admin' && !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const { event, data } = payload;

    if (!data || !data.customer_email) {
      return Response.json({ error: 'Missing customer email' }, { status: 400 });
    }

    // Prepare sync payload
    const syncData = {
      customer_email: data.customer_email,
      amount: data.amount,
      type: data.type,
      description: data.description || null,
      order_id: data.order_id || null,
      reward_id: data.reward_id || null,
      timestamp: new Date().toISOString(),
    };

    if (!CUSTOMER_APP_API) {
      if (data.id) {
        await base44.asServiceRole.entities.UserPoints.update(data.id, { sync_status: 'failed' });
      }
      return Response.json({ status: 'failed', reason: 'Customer app API not configured' });
    }

    // Send to customer app
    const response = await fetch(`${CUSTOMER_APP_API}/functions/receivePointsSync`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SYNC_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(syncData),
    });

    if (response.ok) {
      if (data.id) {
        await base44.asServiceRole.entities.UserPoints.update(data.id, { sync_status: 'synced' });
      }
      return Response.json({ status: 'success', synced: true });
    } else {
      if (data.id) {
        await base44.asServiceRole.entities.UserPoints.update(data.id, { sync_status: 'failed' });
      }
      const text = await response.text();
      console.error(`Sync failed: ${response.status} - ${text}`);
      return Response.json({ status: 'failed', reason: `Customer app error: ${response.status}` });
    }
  } catch (error) {
    console.error('Sync error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});