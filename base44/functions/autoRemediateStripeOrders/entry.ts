import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Auto-remediation for Stripe order sync issues.
 * Detects incomplete/placeholder Stripe orders and recovers them from event logs.
 * Returns what was fixed.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const result = {
      timestamp: new Date().toISOString(),
      fixed_count: 0,
      issues: [],
      actions: [],
    };

    // 1. Find orders with #UNKNOWN or incomplete stripe data (missing customer_name, etc.)
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-updated_date', 100);
    const suspiciousOrders = allOrders.filter(o => 
      o.shopify_order_id === 'base44_unknown' || 
      (o.shopify_order_id?.startsWith('sub_') && !o.customer_name) ||
      (!o.customer_name && o.source_channel === 'subscription')
    );

    // 2. For each suspicious order, try to recover from Stripe event log
    for (const badOrder of suspiciousOrders) {
      try {
        // Find matching Stripe events by email
        const events = await base44.asServiceRole.entities.StripeEventLog.filter({
          customer_email: badOrder.customer_email,
          status: 'processed'
        });

        if (!events || events.length === 0) {
          result.issues.push({
            order_id: badOrder.id,
            problem: 'No matching Stripe events found for recovery',
            customer_email: badOrder.customer_email,
          });
          continue;
        }

        // Sort by date, get most recent processed event
        const latestEvent = events.sort((a, b) => 
          new Date(b.created_date) - new Date(a.created_date)
        )[0];

        if (!latestEvent?.raw_event) {
          result.issues.push({
            order_id: badOrder.id,
            problem: 'Stripe event found but missing raw_event payload',
            event_id: latestEvent.id,
          });
          continue;
        }

        // Extract correct data from event
        const rawData = latestEvent.raw_event;
        const correctData = {
          customer_name: rawData.customer_name || rawData.billing_details?.name || 'Unknown',
          customer_email: rawData.customer_email || latestEvent.customer_email || badOrder.customer_email,
          customer_phone: rawData.customer_phone || rawData.billing_details?.phone || '',
          total_price: rawData.amount_total ? (rawData.amount_total / 100) : badOrder.total_price,
          payment_status: rawData.payment_status === 'paid' ? 'paid' : 'pending',
          line_items: rawData.line_items || badOrder.line_items || [],
        };

        // Update the bad order with correct data
        await base44.asServiceRole.entities.ShopifyOrder.update(badOrder.id, correctData);

        result.fixed_count += 1;
        result.actions.push({
          action: 'recovered_from_stripe_event',
          order_id: badOrder.id,
          customer: correctData.customer_name,
          email: correctData.customer_email,
          event_id: latestEvent.id,
        });
      } catch (err) {
        result.issues.push({
          order_id: badOrder.id,
          problem: `Failed to recover: ${err.message}`,
          customer_email: badOrder.customer_email,
        });
      }
    }

    // 3. Clean up duplicate placeholder orders (keep most recent)
    const allOrdersAgain = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 100);
    const byEmail = {};
    
    for (const o of allOrdersAgain) {
      if (!o.customer_email) continue;
      if (!byEmail[o.customer_email]) byEmail[o.customer_email] = [];
      byEmail[o.customer_email].push(o);
    }

    for (const [email, orders] of Object.entries(byEmail)) {
      if (orders.length <= 1) continue;
      
      // Filter to duplicates (same customer_email, similar amounts)
      const grouped = {};
      for (const o of orders) {
        const key = `${Math.floor((o.total_price || 0) / 10)}`; // group by $10
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(o);
      }

      // For each price group with duplicates, keep newest, delete rest
      for (const [priceKey, dupes] of Object.entries(grouped)) {
        if (dupes.length <= 1) continue;
        
        dupes.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
        const keepId = dupes[0].id;
        
        for (let i = 1; i < dupes.length; i++) {
          try {
            await base44.asServiceRole.entities.ShopifyOrder.delete(dupes[i].id);
            result.actions.push({
              action: 'deleted_duplicate',
              deleted_id: dupes[i].id,
              kept_id: keepId,
              customer_email: email,
            });
          } catch (err) {
            result.issues.push({
              order_id: dupes[i].id,
              problem: `Failed to delete duplicate: ${err.message}`,
            });
          }
        }
      }
    }

    console.log('[AUTO-REMEDIATE] Fixed', result.fixed_count, 'orders, cleaned up duplicates');
    return Response.json({ success: true, result });
  } catch (error) {
    console.error('[AUTO-REMEDIATE] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});