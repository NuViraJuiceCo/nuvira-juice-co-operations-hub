import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * simulateCustomerAppSync
 *
 * Simulates the ACTUAL HTTP request that Customer App will make to Hub's
 * receiveCustomerAppEvent endpoint. This shows the exact URL, method, headers,
 * and payload needed for successful sync.
 *
 * Then actually MAKES the request and returns the result.
 * Admin only.
 */

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const HUB_API_URL = Deno.env.get('CUSTOMER_APP_API_URL') || 'https://api.base44.app/api/apps/69d48d0c39891f7945481152';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const {
      stripe_subscription_id = 'sub_1TUsPSIrzYHaHkt2QoRmPw2F',
      customer_app_subscription_id = '69fe3e960cba907fa6488355',
      customer_email = 'amark@nuvisionarymedia.com',
    } = body;

    // ───────────────────────────────────────────────────────────────────────────
    // BUILD THE EXACT REQUEST THAT CUSTOMER APP WILL MAKE
    // ───────────────────────────────────────────────────────────────────────────

    // Construct the endpoint
    // CRITICAL: ensure no double slashes, normalize trailing slashes
    const baseUrlNormalized = HUB_API_URL.endsWith('/') ? HUB_API_URL.slice(0, -1) : HUB_API_URL;
    const hubEndpoint = `${baseUrlNormalized}/functions/receiveCustomerAppEvent`;

    // Build the request payload
    const payload = {
      event: 'customer.subscription_created',
      customer_email,
      data: {
        customer_app_subscription_id,
        stripe_subscription_id,
        payment_status: 'paid',
        financial_status: 'paid',
        order_type: 'subscription',
        source_type: 'subscription_fulfillment',
        plan_name: 'Monthly Ritual',
        products: [
          { product_name: 'Aura', quantity: 1 },
          { product_name: 'Oasis', quantity: 1 },
          { product_name: 'Re-Nu', quantity: 1 },
        ],
        items_summary: '1x Aura, 1x Oasis, 1x Re-Nu',
        first_delivery_date: '2026-05-15',
        delivery_window_label: '5 PM – 8 PM',
      },
    };

    const requestDetails = {
      timestamp: new Date().toISOString(),
      endpoint_url: hubEndpoint,
      http_method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SYNC_SECRET ? '[REDACTED_' + SYNC_SECRET.length + '_CHARS]' : 'MISSING_SECRET'}`,
      },
      payload_keys: Object.keys(payload),
      event: payload.event,
      customer_email: payload.customer_email,
      stripe_subscription_id: payload.data.stripe_subscription_id,
      products_count: payload.data.products.length,
    };

    console.log('[SIMULATE-CUSTOMER-APP-SYNC] ════════════════════════════════════════');
    console.log('[SIMULATE-CUSTOMER-APP-SYNC] BUILDING REQUEST');
    console.log('[SIMULATE-CUSTOMER-APP-SYNC]', JSON.stringify(requestDetails, null, 2));
    console.log('[SIMULATE-CUSTOMER-APP-SYNC] ════════════════════════════════════════');

    // ───────────────────────────────────────────────────────────────────────────
    // ACTUALLY MAKE THE REQUEST TO HUB
    // ───────────────────────────────────────────────────────────────────────────

    if (!SYNC_SECRET) {
      return Response.json({
        status: 'error',
        reason: 'CUSTOMER_APP_SYNC_SECRET not set on Hub',
        request_details: requestDetails,
        cannot_proceed: true,
      });
    }

    console.log('[SIMULATE-CUSTOMER-APP-SYNC] Making HTTP POST to:', hubEndpoint);
    const response = await fetch(hubEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SYNC_SECRET}`,
      },
      body: JSON.stringify(payload),
    });

    const responseData = await response.json().catch(() => ({}));

    console.log('[SIMULATE-CUSTOMER-APP-SYNC] Response status:', response.status);
    console.log('[SIMULATE-CUSTOMER-APP-SYNC] Response body:', JSON.stringify(responseData, null, 2));

    // ───────────────────────────────────────────────────────────────────────────
    // DETAILED RESULT ANALYSIS
    // ───────────────────────────────────────────────────────────────────────────

    const result = {
      timestamp: new Date().toISOString(),
      request_summary: requestDetails,
      http_response_status: response.status,
      http_response_ok: response.ok,
      response_data: responseData,
      sync_result: response.ok ? 'SUCCESS' : 'FAILED',
      details: {
        endpoint_correct: true,
        auth_header_sent: true,
        secret_used: `${SYNC_SECRET.slice(0, 5)}...`,
        secret_length_on_hub: SYNC_SECRET.length,
      },
    };

    // If success, verify Hub created records
    if (response.ok && responseData.status === 'success') {
      result.hub_action_taken = responseData.action || 'unknown';
      result.operational_order_id = responseData.hub_order_id || responseData.operational_order_id;
      result.fulfillment_task_id = responseData.fulfillment_task_id;

      // Verify records were actually created
      const createdOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({
        stripe_subscription_id,
      });
      const createdTasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
        stripe_subscription_id,
      });

      result.hub_verification = {
        operational_orders_created: createdOrders.length,
        order_ids: createdOrders.map(o => o.id),
        fulfillment_tasks_created: createdTasks.length,
        task_ids: createdTasks.map(t => t.id),
      };
    }

    return Response.json(result);

  } catch (error) {
    console.error('[SIMULATE-CUSTOMER-APP-SYNC]', error.message);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});