import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const secret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
    const authHeader = req.headers.get('authorization')?.replace('Bearer ', '');
    
    if (authHeader !== secret) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const payload = await req.json();
    
    if (!payload.events || !Array.isArray(payload.events)) {
      return Response.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const results = [];
    for (const eventData of payload.events) {
      try {
        // Check if event exists by name and date
        const existing = await base44.asServiceRole.entities.Event.filter({ 
          name: eventData.name,
          date: eventData.date 
        });
        
        if (existing && existing.length > 0) {
          await base44.asServiceRole.entities.Event.update(existing[0].id, eventData);
          results.push({ name: eventData.name, action: 'updated' });
        } else {
          await base44.asServiceRole.entities.Event.create(eventData);
          results.push({ name: eventData.name, action: 'created' });
        }
      } catch (err) {
        results.push({ name: eventData.name, action: 'failed', error: err.message });
      }
    }

    return Response.json({ status: 'success', results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});