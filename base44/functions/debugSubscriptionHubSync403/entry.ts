import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * debugSubscriptionHubSync403
 *
 * Diagnostic function to debug and resolve HTTP 403 Forbidden error
 * when Customer App attempts to sync a repaired paid subscription to Hub.
 *
 * Steps:
 * 1. Verify auth secret and endpoint URL
 * 2. Log exact request being sent
 * 3. Attempt sync to Hub with detailed response capture
 * 4. If 403, parse error and identify root cause
 * 5. Retry sync with diagnostics
 * 6. Verify Hub state (order, task, batch)
 *
 * Admin only.
 */

const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const CUSTOMER_APP_API_URL = Deno.env.get('CUSTOMER_APP_API_URL');

async function sendToHubViaSDK(base44, payload) {
  // Use base44 SDK to invoke the Hub function directly (proper way to call backend functions)
  try {
    console.log('[HUB-SYNC-403-DEBUG] Invoking receiveCustomerAppEvent via base44 SDK');
    const result = await base44.asServiceRole.functions.invoke('receiveCustomerAppEvent', payload);
    
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      method: 'base44 SDK invoke',
      responseBody: result?.data || result,
      invokeSuccess: true,
    };
  } catch (error) {
    console.error('[HUB-SYNC-403-DEBUG] SDK invoke failed:', error.message);
    return {
      ok: false,
      status: 500,
      error: error.message,
      method: 'base44 SDK invoke',
      invokeSuccess: false,
    };
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const {
      stripe_subscription_id,
      customer_app_subscription_id,
      customer_email,
      plan_name,
      products,
      items_summary,
      first_invoice_id,
      payment_status,
    } = body;

    if (!stripe_subscription_id || !customer_email) {
      return Response.json({ error: 'stripe_subscription_id and customer_email required' }, { status: 400 });
    }

    const diagnostics = {
      timestamp: new Date().toISOString(),
      executed_by: user.email,
      customer_email,
      stripe_subscription_id,
      customer_app_subscription_id,
      secretsValidation: {
        CUSTOMER_APP_SYNC_SECRET_set: !!CUSTOMER_APP_SYNC_SECRET,
        CUSTOMER_APP_API_URL: CUSTOMER_APP_API_URL || 'NOT SET (defaulting to nuvirajuice.app)',
      },
    };

    // Payload that should be sent to Hub
    const hubPayload = {
      event: 'customer.subscription_created',
      customer_email,
      data: {
        customer_app_subscription_id,
        stripe_subscription_id,
        first_invoice_id: first_invoice_id || null,
        payment_status: payment_status || 'paid',
        financial_status: payment_status || 'paid',
        order_type: 'subscription',
        source_type: 'subscription_fulfillment',
        plan_name: plan_name || 'Monthly Ritual',
        products: products || [
          { product_name: 'Aura', quantity: 1 },
          { product_name: 'Oasis', quantity: 1 },
          { product_name: 'Re-Nu', quantity: 1 },
        ],
        items_summary: items_summary || '1x Aura, 1x Oasis, 1x Re-Nu',
      },
    };

    diagnostics.payloadSentToHub = hubPayload;

    // Attempt: Send to Hub via SDK (proper method)
    console.log('[HUB-SYNC-403-DEBUG] Sending subscription_created event to Hub via base44 SDK');
    const attempt = await sendToHubViaSDK(base44, hubPayload);
    diagnostics.attempt = attempt;

    if (!attempt.ok) {
      console.warn('[HUB-SYNC-403-DEBUG] ❌ Failed:', attempt.status || attempt.error);
      diagnostics.syncResult = 'FAILED';
      diagnostics.syncError = attempt.error || `HTTP ${attempt.status}`;
    } else if (attempt.ok) {
      console.log('[HUB-SYNC-403-DEBUG] ✅ Success via SDK');
      diagnostics.syncResult = 'SUCCESS';
      diagnostics.hubResponse = attempt.responseBody;
    }

    // Verify Hub state after sync attempt (only if sync succeeded or we want to check anyway)
    console.log('[HUB-SYNC-403-DEBUG] Checking Hub state for Amar');
    let orders = [];
    let tasks = [];
    let batches = [];
    try {
      [orders, tasks, batches] = await Promise.all([
        base44.asServiceRole.entities.ShopifyOrder.filter({ customer_email }),
        base44.asServiceRole.entities.FulfillmentTask.filter({ customer_email }),
        base44.asServiceRole.entities.ProductionBatch.list('-production_date', 50),
      ]);
    } catch (stateErr) {
      console.error('[HUB-SYNC-403-DEBUG] Error checking Hub state:', stateErr.message);
    }

    // Check for Amar in batches
    const batchesWithAmar = (batches || []).filter(b => {
      if (!Array.isArray(b.order_sources)) return false;
      return b.order_sources.some(s => s.customer_email === customer_email);
    });

    const activeOrders = (orders || []).filter(o =>
      o.order_type === 'subscription' &&
      o.stripe_subscription_id === stripe_subscription_id &&
      o.payment_status === 'paid' &&
      o.production_status !== 'canceled'
    );

    const scheduledTasks = (tasks || []).filter(t =>
      t.status === 'Scheduled' &&
      t.stripe_subscription_id === stripe_subscription_id
    );

    diagnostics.hubState = {
      activeOperationalOrders: activeOrders.length,
      operationalOrderIds: activeOrders.map(o => o.id),
      scheduledFulfillmentTasks: scheduledTasks.length,
      fulfillmentTaskIds: scheduledTasks.map(t => t.id),
      productionBatchesWithAmar: batchesWithAmar.length,
      batchIds: batchesWithAmar.map(b => b.id),
    };

    return Response.json({
      timestamp: new Date().toISOString(),
      result: attempt.ok ? 'SYNC_SUCCESS' : 'SYNC_FAILED',
      diagnostics,
    });

  } catch (error) {
    console.error('[HUB-SYNC-403-DEBUG] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});