import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    if (!CUSTOMER_APP_API) {
      return Response.json({ error: 'CUSTOMER_APP_API_URL secret not set' }, { status: 500 });
    }

    // Fetch events from customer app
    const response = await fetch(`${CUSTOMER_APP_API}/api/events`, {
      headers: {
        'Authorization': `Bearer ${SYNC_SECRET}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Customer app responded with ${response.status}`);
    }

    const { events } = await response.json();

    if (!Array.isArray(events)) {
      return Response.json({ error: 'Invalid response from customer app' }, { status: 500 });
    }

    // Get all current hub events to detect deletions
    const hubEvents = await base44.asServiceRole.entities.Event.list('-created_date', 200);
    const customerAppEventIds = new Set(events.map(e => e.customer_app_id).filter(Boolean));

    const results = [];

    // Upsert events from customer app
    for (const eventData of events) {
      const existing = await base44.asServiceRole.entities.Event.filter({
        name: eventData.name,
        date: eventData.date,
      });

      if (existing && existing.length > 0) {
        await base44.asServiceRole.entities.Event.update(existing[0].id, eventData);
        results.push({ name: eventData.name, action: 'updated' });
      } else {
        await base44.asServiceRole.entities.Event.create(eventData);
        results.push({ name: eventData.name, action: 'created' });
      }
    }

    // Delete hub events that were removed in customer app (only if they have a customer_app_id)
    for (const hubEvent of hubEvents) {
      if (hubEvent.customer_app_id && !customerAppEventIds.has(hubEvent.customer_app_id)) {
        await base44.asServiceRole.entities.Event.delete(hubEvent.id);
        results.push({ name: hubEvent.name, action: 'deleted' });
      }
    }

    console.log(`[PULL-EVENTS] Synced ${results.length} events`);
    return Response.json({ status: 'success', count: results.length, results });
  } catch (error) {
    console.error('[PULL-EVENTS] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});