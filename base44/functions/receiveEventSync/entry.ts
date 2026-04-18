import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Validate secret
    const secret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
    const authHeader = req.headers.get('authorization')?.replace('Bearer ', '');
    
    if (authHeader !== secret || !secret) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const { action, hub_event_id, event } = payload;

    if (!hub_event_id || !action || !event) {
      return Response.json({ error: 'Missing required fields: action, hub_event_id, event' }, { status: 400 });
    }

    if (!['create', 'update', 'delete'].includes(action)) {
      return Response.json({ error: 'Invalid action. Must be create, update, or delete' }, { status: 400 });
    }

    // Handle delete
    if (action === 'delete') {
      const existing = await base44.asServiceRole.entities.Event.filter({ hub_event_id });
      if (existing && existing.length > 0) {
        await base44.asServiceRole.entities.Event.delete(existing[0].id);
        console.log(`[EVENT-SYNC] Deleted event ${hub_event_id}`);
        return Response.json({ status: 'deleted', hub_event_id });
      }
      return Response.json({ status: 'not_found', hub_event_id });
    }

    // Handle create/update (upsert)
    const existing = await base44.asServiceRole.entities.Event.filter({ hub_event_id });
    
    const eventData = {
      ...event,
      hub_event_id
    };

    if (existing && existing.length > 0) {
      // Update existing
      await base44.asServiceRole.entities.Event.update(existing[0].id, eventData);
      console.log(`[EVENT-SYNC] Updated event ${hub_event_id}`);
      return Response.json({ status: 'updated', hub_event_id, event_id: existing[0].id });
    } else {
      // Create new
      const created = await base44.asServiceRole.entities.Event.create(eventData);
      console.log(`[EVENT-SYNC] Created event ${hub_event_id}`);
      return Response.json({ status: 'created', hub_event_id, event_id: created.id });
    }
  } catch (error) {
    console.error('[EVENT-SYNC] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});