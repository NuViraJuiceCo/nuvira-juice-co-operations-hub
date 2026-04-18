import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    if (!CUSTOMER_APP_API) {
      return Response.json({ error: 'CUSTOMER_APP_API_URL not set' }, { status: 500 });
    }

    // Fetch loyalty data from customer app
    const response = await fetch(`${CUSTOMER_APP_API}/functions/getLoyaltyDataForSync`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SYNC_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Customer app responded ${response.status}: ${text}`);
    }

    const { customers } = await response.json();

    if (!Array.isArray(customers)) {
      return Response.json({ error: 'Invalid response from customer app' }, { status: 500 });
    }

    // Sync loyalty data to hub database
    const results = [];
    for (const customerData of customers) {
      try {
        const existing = await base44.asServiceRole.entities.CustomerLoyalty.filter({ 
          customer_email: customerData.customer_email 
        });

        if (existing?.length > 0) {
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

    console.log(`[PULL-LOYALTY] Synced ${customers.length} loyalty records from customer app`);
    return Response.json({
      status: 'success',
      synced: customers.length,
      results
    });
  } catch (error) {
    console.error('Error pulling loyalty data:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});