import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    if (!CUSTOMER_APP_API || !SYNC_SECRET) {
      return Response.json({ error: 'Customer app API not configured' }, { status: 500 });
    }

    // Fetch bag returns from customer app
    const response = await fetch(`${CUSTOMER_APP_API}/functions/getBagReturnsForSync`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SYNC_SECRET}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Customer app error ${response.status}: ${text.slice(0, 200)}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      throw new Error(`Invalid response content type: ${contentType}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (err) {
      throw new Error(`Failed to parse JSON response: ${err.message}`);
    }
    const returns = Array.isArray(data.returns) ? data.returns : (Array.isArray(data) ? data : []);

    if (!Array.isArray(returns)) {
      console.error('[PULL-BAG-RETURNS] Response was not array or had invalid structure');
      return Response.json({ status: 'success', count: 0, results: [], warning: 'Invalid response structure, assuming no returns' });
    }

    // Upsert returns into hub BagReturn entity
    const results = [];
    for (const ret of returns) {
      try {
        // Check if exists by order_id and customer_email
        const existing = await base44.asServiceRole.entities.BagReturn.filter({
          order_id: ret.order_id,
          customer_email: ret.customer_email,
        });

        const hubReturn = {
          order_id: ret.order_id,
          customer_email: ret.customer_email,
          small_bags_requested: ret.small_bags_requested || 0,
          tote_bags_requested: ret.tote_bags_requested || 0,
          small_bags_accepted: ret.small_bags_accepted || 0,
          tote_bags_accepted: ret.tote_bags_accepted || 0,
          small_bag_status: ret.small_bag_status || 'pending',
          tote_bag_status: ret.tote_bag_status || 'pending',
          rejection_reason: ret.rejection_reason || null,
          rejection_notes: ret.rejection_notes || null,
          verification_status: ret.verification_status || 'requested',
          credit_issued: ret.credit_issued || 0,
          credit_applied: ret.credit_applied || false,
          verified_by: ret.verified_by || null,
          verified_at: ret.verified_at || null,
          photo_url: ret.photo_url || null,
          driver_notes: ret.driver_notes || null,
          sync_status: 'synced',
        };

        if (existing && existing.length > 0) {
          await base44.asServiceRole.entities.BagReturn.update(existing[0].id, hubReturn);
          results.push({ order_id: ret.order_id, customer_email: ret.customer_email, action: 'updated' });
        } else {
          await base44.asServiceRole.entities.BagReturn.create(hubReturn);
          results.push({ order_id: ret.order_id, customer_email: ret.customer_email, action: 'created' });
        }
      } catch (err) {
        results.push({
          order_id: ret.order_id,
          customer_email: ret.customer_email,
          action: 'failed',
          error: err.message,
        });
      }
    }

    console.log(`[PULL-BAG-RETURNS] Synced ${results.length} bag returns from customer app`);
    return Response.json({ status: 'success', count: results.length, results });
  } catch (error) {
    console.error('[PULL-BAG-RETURNS] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});