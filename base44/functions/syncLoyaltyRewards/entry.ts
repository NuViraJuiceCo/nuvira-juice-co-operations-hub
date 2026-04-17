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
    
    if (!payload.customers || !Array.isArray(payload.customers)) {
      return Response.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const results = [];
    for (const customerData of payload.customers) {
      try {
        // Check if customer loyalty exists by email
        const existing = await base44.asServiceRole.entities.CustomerLoyalty.filter({ 
          customer_email: customerData.customer_email 
        });
        
        if (existing && existing.length > 0) {
          await base44.asServiceRole.entities.CustomerLoyalty.update(existing[0].id, customerData);
          results.push({ email: customerData.customer_email, action: 'updated' });
        } else {
          await base44.asServiceRole.entities.CustomerLoyalty.create(customerData);
          results.push({ email: customerData.customer_email, action: 'created' });
        }
      } catch (err) {
        results.push({ email: customerData.customer_email, action: 'failed', error: err.message });
      }
    }

    return Response.json({ status: 'success', results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});