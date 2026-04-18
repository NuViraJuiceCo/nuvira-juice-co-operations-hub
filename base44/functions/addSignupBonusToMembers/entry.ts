import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { customer_emails } = await req.json();

    if (!Array.isArray(customer_emails) || customer_emails.length === 0) {
      return Response.json({ error: 'customer_emails array required' }, { status: 400 });
    }

    const results = [];
    for (const email of customer_emails) {
      try {
        const existing = await base44.asServiceRole.entities.CustomerLoyalty.filter({ customer_email: email });
        
        if (existing?.length > 0) {
          const customer = existing[0];
          const updated = await base44.asServiceRole.entities.CustomerLoyalty.update(customer.id, {
            total_points: (customer.total_points || 0) + 100,
            lifetime_points: (customer.lifetime_points || 0) + 100,
            points_history: [
              ...(customer.points_history || []),
              {
                amount: 100,
                type: 'bonus',
                description: 'Signup bonus',
                timestamp: new Date().toISOString()
              }
            ]
          });
          results.push({ email, status: 'success' });
        } else {
          results.push({ email, status: 'not_found' });
        }
      } catch (err) {
        results.push({ email, status: 'error', error: err.message });
      }
    }

    console.log(`[ADD-BONUS] Added 100pt bonus to ${results.filter(r => r.status === 'success').length} members`);
    return Response.json({ status: 'success', results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});