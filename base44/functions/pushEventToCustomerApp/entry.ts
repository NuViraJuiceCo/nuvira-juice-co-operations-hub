import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const { event, data } = body;

    if (!CUSTOMER_APP_API) {
      return Response.json({ error: 'CUSTOMER_APP_API_URL not set' }, { status: 500 });
    }

    const eventType = event?.type; // 'create', 'update', 'delete'
    const entityId = event?.entity_id;

    let response;

    if (eventType === 'delete') {
      // Notify customer app of deletion by hub entity ID
      response = await fetch(`${CUSTOMER_APP_API}/api/events/sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SYNC_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'delete', hub_event_id: entityId }),
      });
    } else {
      // Push full event data for create/update
      response = await fetch(`${CUSTOMER_APP_API}/api/events/sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SYNC_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: eventType, hub_event_id: entityId, event: data }),
      });
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Customer app responded ${response.status}: ${text}`);
    }

    console.log(`[PUSH-EVENT] ${eventType} event ${entityId} pushed to customer app`);
    return Response.json({ success: true, action: eventType, entity_id: entityId });
  } catch (error) {
    console.error('[PUSH-EVENT] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});