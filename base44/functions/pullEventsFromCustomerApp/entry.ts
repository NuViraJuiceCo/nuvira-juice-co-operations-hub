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
    const url = `${CUSTOMER_APP_API}/functions/getEventsForSync`;
    console.log('[PULL-EVENTS] Fetching URL:', url);
    console.log('[PULL-EVENTS] Secret set:', !!SYNC_SECRET);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SYNC_SECRET}`,
        'Content-Type': 'application/json',
      },
    });

    const rawText = await response.text();
    console.log('[PULL-EVENTS] Status:', response.status);
    console.log('[PULL-EVENTS] Raw response (first 500 chars):', rawText.slice(0, 500));

    if (!response.ok) {
      throw new Error(`Customer app responded with ${response.status}: ${rawText.slice(0, 200)}`);
    }

    const parsed = JSON.parse(rawText);
    const events = parsed.events;

    if (!Array.isArray(events)) {
      return Response.json({ error: 'Invalid response from customer app' }, { status: 500 });
    }

    // Delete ALL existing hub events to start fresh
    const hubEvents = await base44.asServiceRole.entities.Event.list('-created_date', 500);
    for (const hubEvent of hubEvents) {
      await base44.asServiceRole.entities.Event.delete(hubEvent.id);
    }

    // Create all events from customer app
    const results = [];
    for (const eventData of events) {
      await base44.asServiceRole.entities.Event.create(eventData);
      results.push({ name: eventData.name, action: 'created' });
    }

    console.log(`[PULL-EVENTS] Replaced all events. Imported ${results.length} from customer app.`);
    return Response.json({ status: 'success', count: results.length, results });
  } catch (error) {
    console.error('[PULL-EVENTS] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});