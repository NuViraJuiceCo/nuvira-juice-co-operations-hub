import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Allow admin users or webhook calls with correct secret
    const secret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
    const authHeader = req.headers.get('authorization')?.replace('Bearer ', '');
    const isAdmin = user?.role === 'admin';
    const isValidSecret = authHeader === secret;

    if (!isAdmin && !isValidSecret) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const customersToSync = payload.customers || [];

    // If called manually with no data, return ready state
    if (customersToSync.length === 0) {
      return Response.json({ 
        status: 'ready', 
        message: 'Loyalty sync ready. Awaiting customer app webhook data.',
        synced: 0
      });
    }

    const results = [];
    for (const customerData of customersToSync) {
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

    console.log(`[SYNC-LOYALTY] Synced ${results.length} loyalty records`);
    return Response.json({ status: 'success', synced: results.length, results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});