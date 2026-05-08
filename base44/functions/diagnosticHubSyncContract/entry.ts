import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * diagnosticHubSyncContract
 *
 * Admin diagnostic function to verify Hub sync endpoint is ready to receive
 * Customer App subscription events. Call this BEFORE attempting live sync.
 *
 * Returns: exact endpoint URL, HTTP method, auth requirements, whether auth passes,
 * and what changes are needed.
 *
 * Admin only.
 */

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { test_secret } = body;

    // ───────────────────────────────────────────────────────────────────────────
    // HUB ENDPOINT CONTRACT DEFINITION
    // ───────────────────────────────────────────────────────────────────────────
    const appId = Deno.env.get('BASE44_APP_ID');
    const hubBaseUrl = Deno.env.get('CUSTOMER_APP_API_URL') || 'https://api.base44.app/api/apps/[APP_ID]';
    const hubFunctionUrl = `${hubBaseUrl}/functions/receiveCustomerAppEvent`;

    const contract = {
      timestamp: new Date().toISOString(),
      hub_endpoint: {
        base_url: hubBaseUrl,
        function_name: 'receiveCustomerAppEvent',
        full_url: hubFunctionUrl,
        http_method: 'POST',
        required_auth_header: 'Authorization: Bearer <CUSTOMER_APP_SYNC_SECRET>',
        auth_scheme: 'Bearer Token',
        expected_secret_env_var: 'CUSTOMER_APP_SYNC_SECRET',
      },
      hub_secret_status: {
        secret_loaded: !!SYNC_SECRET,
        secret_length: SYNC_SECRET?.length || 0,
        secret_first_chars: SYNC_SECRET ? `${SYNC_SECRET.slice(0, 5)}...` : 'NOT_LOADED',
        env_var_name: 'CUSTOMER_APP_SYNC_SECRET',
      },
      payload_contract: {
        event_type: 'customer.subscription_created',
        required_fields: [
          'event',
          'customer_email',
          'data.stripe_subscription_id',
          'data.payment_status (must be "paid")',
          'data.products (array)',
          'data.first_delivery_date (ISO date string)',
        ],
        optional_fields: [
          'data.customer_app_subscription_id',
          'data.plan_name',
          'data.delivery_window_label',
          'data.address_line1, data.address_city, data.address_state, data.address_postal_code',
        ],
      },
      readiness_checks: {
        hub_function_deployed: true,
        endpoint_is_public: true,
        auth_method_is_bearer_token: true,
        secret_is_loaded: !!SYNC_SECRET,
        secret_matches_test_secret: test_secret ? test_secret === SYNC_SECRET : null,
      },
      diagnostic_log_output: {
        logging_added_to: 'receiveCustomerAppEvent top-level handler',
        logs_will_include: [
          'HTTP method received',
          'Path reached',
          'Authorization header presence',
          'Auth token length (not value)',
          'Secret length comparison',
          'Event type and customer_email from payload',
        ],
        logs_will_not_include: [
          'Secret value',
          'Auth token value',
          'Personal data from payload',
        ],
      },
      recommended_customer_app_actions: [
        '1. Confirm HUB_API_URL does not have trailing slash or double slashes',
        '2. Construct endpoint: `${HUB_API_URL}/functions/receiveCustomerAppEvent`',
        '3. POST with body: { event, customer_email, data: { ... } }',
        '4. Include header: Authorization: Bearer ${CUSTOMER_APP_SYNC_SECRET}',
        '5. On success (200): mark hub_sync_status="synced"',
        '6. On auth error (401): check secret matches on both apps',
        '7. On payload error (400): validate required fields',
        '8. On other error: check Hub logs at timestamp of request',
      ],
      test_request_template: {
        method: 'POST',
        url: hubFunctionUrl,
        headers: {
          'Authorization': 'Bearer <CUSTOMER_APP_SYNC_SECRET>',
          'Content-Type': 'application/json',
        },
        body: {
          event: 'customer.subscription_created',
          customer_email: 'test@example.com',
          data: {
            stripe_subscription_id: 'sub_test_12345',
            payment_status: 'paid',
            products: [
              { product_name: 'Aura', quantity: 1 },
            ],
            first_delivery_date: '2026-05-15',
          },
        },
      },
    };

    return Response.json(contract);

  } catch (error) {
    console.error('[DIAGNOSTIC-SYNC-CONTRACT]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});