import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * recordDriverDelivery
 *
 * Frontend-safe endpoint for drivers to confirm deliveries.
 * Internally calls updateDriverDeliveryTask with proper authentication.
 */

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { task_id, order_id, driver_email, driver_name, photo_url, drop_location, timestamp } = body;

    if (!task_id) {
      return Response.json({ error: 'task_id required' }, { status: 400 });
    }

    // Call updateDriverDeliveryTask with auth secret
    const updateRes = await fetch(new URL(req.url).origin + '/functions/updateDriverDeliveryTask', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SYNC_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        task_id,
        action: 'mark_delivered',
        driver_email: driver_email || user.email,
        driver_name: driver_name || user.full_name,
        photo_url,
        timestamp: timestamp || new Date().toISOString(),
      }),
    });

    if (!updateRes.ok) {
      const error = await updateRes.json();
      return Response.json(error, { status: updateRes.status });
    }

    const result = await updateRes.json();
    return Response.json({ status: 'success', ...result });

  } catch (error) {
    console.error('[RECORD-DELIVERY]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});