import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Full Order Recovery: Chains auto-remediation + production batch recalculation
 * Recovers #unknown orders from Stripe event logs and rebuilds production schedules
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
      remediation: { fixed_count: 0, issues: [] },
      recalculation: { created: 0, updated: 0, zeroed: 0, skipped: 0 },
      recovered_orders: [],
    };

    // PHASE 1: Auto-remediation (recover from StripeEventLog)
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-updated_date', 200);
    const suspiciousOrders = allOrders.filter(o => 
      o.shopify_order_id === 'base44_unknown' || 
      (o.shopify_order_id?.startsWith('sub_') && !o.customer_name) ||
      (!o.customer_name && o.source_channel === 'subscription') ||
      (o.customer_email === 'unknown@unknown.com')
    );

    for (const badOrder of suspiciousOrders) {
      try {
        const events = await base44.asServiceRole.entities.StripeEventLog.filter({
          customer_email: badOrder.customer_email,
          status: 'processed'
        });

        if (!events || events.length === 0) {
          result.remediation.issues.push({
            order_id: badOrder.id,
            problem: 'No matching Stripe events',
            email: badOrder.customer_email,
          });
          continue;
        }

        const latestEvent = events.sort((a, b) => 
          new Date(b.created_date) - new Date(a.created_date)
        )[0];

        if (!latestEvent?.raw_event) {
          result.remediation.issues.push({
            order_id: badOrder.id,
            problem: 'No raw_event in Stripe log',
          });
          continue;
        }

        const rawData = latestEvent.raw_event;
        const correctData = {
          customer_name: rawData.customer_name || rawData.billing_details?.name || 'Unknown',
          customer_email: rawData.customer_email || latestEvent.customer_email || badOrder.customer_email,
          customer_phone: rawData.customer_phone || rawData.billing_details?.phone || '',
          total_price: rawData.amount_total ? (rawData.amount_total / 100) : badOrder.total_price,
          payment_status: rawData.payment_status === 'paid' ? 'paid' : 'pending',
          line_items: rawData.line_items || badOrder.line_items || [],
          shopify_order_id: rawData.id || badOrder.shopify_order_id,
          source_channel: badOrder.source_channel || 'online',
        };

        await base44.asServiceRole.entities.ShopifyOrder.update(badOrder.id, correctData);
        result.remediation.fixed_count += 1;
        result.recovered_orders.push({
          order_id: badOrder.id,
          customer_name: correctData.customer_name,
          customer_email: correctData.customer_email,
        });

        console.log(`[FULL-RECOVERY] Recovered order ${badOrder.id} for ${correctData.customer_email}`);
      } catch (err) {
        result.remediation.issues.push({
          order_id: badOrder.id,
          problem: err.message,
        });
      }
    }

    // PHASE 2: Recalculate production batches to include recovered orders
    console.log(`[FULL-RECOVERY] Recalculating production batches after recovering ${result.remediation.fixed_count} orders...`);
    
    try {
      // Invoke the recalculation directly
      const recalcRes = await base44.asServiceRole.functions.invoke('recalculateProductionBatches', {});
      if (recalcRes?.results) {
        result.recalculation = recalcRes.results;
      }
    } catch (err) {
      console.error('[FULL-RECOVERY] Recalculation failed:', err.message);
      result.recalculation.error = err.message;
    }

    return Response.json({ success: true, result });
  } catch (error) {
    console.error('[FULL-RECOVERY] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});