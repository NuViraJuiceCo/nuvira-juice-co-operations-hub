import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    if (!CUSTOMER_APP_API || !SYNC_SECRET) {
      return Response.json({ error: 'Customer app not configured' }, { status: 500 });
    }

    // Fetch loyalty data from customer app via unified endpoint
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

    // Filter out test users and sync
    const results = [];
    const productionCustomers = customers.filter(c => {
      const email = (c.email || c.customer_email || '').toLowerCase();
      return !email.includes('test');
    });

    for (const customer of productionCustomers) {
      try {
        await base44.functions.invoke('loyaltySync', {
          action: 'enroll',
          token: SYNC_SECRET,
          email: customer.email || customer.customer_email,
          full_name: customer.full_name || customer.email?.split('@')[0] || customer.customer_email.split('@')[0],
          phone: customer.phone || '',
          signup_date: customer.signup_date || new Date().toISOString().split('T')[0],
          status: customer.status || 'active',
          total_points: customer.total_points || 0,
          lifetime_points: customer.lifetime_points || 0,
          redeemed_points: customer.redeemed_points || 0,
          points_history: customer.points_history || []
        });
        results.push({ email: customer.email || customer.customer_email, action: 'synced' });
      } catch (err) {
        results.push({ email: customer.email || customer.customer_email, action: 'failed', error: err.message });
      }
    }

    console.log(`[PULL-LOYALTY] Synced ${customers.length} records from customer app`);
    return Response.json({ status: 'success', synced: customers.length, results });
  } catch (error) {
    console.error('Error pulling loyalty:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});