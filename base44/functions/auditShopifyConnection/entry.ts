import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * auditShopifyConnection — Comprehensive Shopify Admin API connectivity audit
 * 
 * Tests:
 * 1. Credentials presence (SHOPIFY_SHOP_DOMAIN, SHOPIFY_ADMIN_ACCESS_TOKEN)
 * 2. Admin API connectivity (GET /admin/api/2024-01/shop.json)
 * 3. Orders API access (GET /admin/api/2024-01/orders.json?limit=5)
 * 4. POS order detection (source_name, app_id, location_id fields)
 * 5. Webhook secret validation (separate from Admin token)
 * 6. Scope verification (read_orders, read_all_orders, read_products, read_inventory, read_locations)
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const results = {
      timestamp: new Date().toISOString(),
      executed_by: user.email,
      credentials: {},
      api_tests: {},
      order_samples: {
        total_fetched: 0,
        pos_count: 0,
        online_count: 0,
        recent_orders: [],
      },
      webhook_config: {},
      recommendations: [],
    };

    // ── 1. Check credentials presence ──
    const shopDomain = Deno.env.get('SHOPIFY_SHOP_DOMAIN');
    const webhookSecret = Deno.env.get('SHOPIFY_WEBHOOK_SECRET');
    const clientId = Deno.env.get('SHOPIFY_CLIENT_ID');
    const clientSecret = Deno.env.get('SHOPIFY_CLIENT_SECRET');

    // Active authentication flow: Client ID + Client Secret (static token no longer supported)
    const usingClientCredentials = !!clientId && !!clientSecret;
    
    results.credentials = {
      shop_domain_present: !!shopDomain,
      shop_domain_value: shopDomain || 'MISSING',
      auth_flow: usingClientCredentials ? 'client_credentials' : 'none',
      client_credentials_present: usingClientCredentials,
      client_id_present: !!clientId,
      client_secret_present: !!clientSecret,
      webhook_secret_present: !!webhookSecret,
      webhook_secret_length: webhookSecret?.length || 0,
      credentials_complete: !!(shopDomain && usingClientCredentials && webhookSecret),
    };

    if (!shopDomain || !usingClientCredentials) {
      results.recommendations.push('CRITICAL: Missing Shopify credentials. Set SHOPIFY_SHOP_DOMAIN, SHOPIFY_CLIENT_ID, and SHOPIFY_CLIENT_SECRET (from Shopify Dev Dashboard).');
      return Response.json(results);
    }

    // ── 2. Get access token via client credentials exchange ──
    let accessToken = null;
    
    try {
        const tokenResponse = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'client_credentials'
          })
        });

        const tokenData = await tokenResponse.json();
        
        if (tokenResponse.ok && tokenData.access_token) {
          accessToken = tokenData.access_token;
          results.credentials.token_exchange = 'SUCCESS';
          results.credentials.token_expires_in = tokenData.expires_in;
          results.credentials.token_scope = tokenData.scope;
        } else {
          results.api_tests.token_exchange = 'FAIL';
          results.api_tests.token_exchange_error = tokenData;
          results.recommendations.push('Client credentials token exchange failed. Verify SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET are correct.');
          return Response.json(results);
        }
    } catch (err) {
      results.api_tests.token_exchange = 'ERROR';
      results.api_tests.token_exchange_error = err.message;
      results.recommendations.push(`Token exchange network error: ${err.message}`);
      return Response.json(results);
    }

    // ── 3. Test Admin API connectivity ──
    try {
      const shopResponse = await fetch(`https://${shopDomain}/admin/api/2024-01/shop.json`, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
      });

      results.api_tests.shop_endpoint = {
        url: `https://${shopDomain}/admin/api/2024-01/shop.json`,
        status: shopResponse.status,
        status_text: shopResponse.statusText,
      };

      if (shopResponse.ok) {
        const shopData = await shopResponse.json();
        results.api_tests.shop_info = {
          name: shopData.shop?.name,
          domain: shopData.shop?.domain,
          email: shopData.shop?.email,
          plan_name: shopData.shop?.plan_name,
        };
        results.api_tests.connectivity = 'PASS';
      } else {
        const errorText = await shopResponse.text().catch(() => 'N/A');
        results.api_tests.error = errorText;
        results.api_tests.connectivity = 'FAIL';
        results.recommendations.push('Admin API connection failed. Check token exchange is working and token has not expired.');
      }
    } catch (err) {
      results.api_tests.connectivity = 'ERROR';
      results.api_tests.error = err.message;
      results.recommendations.push(`Network error: ${err.message}`);
    }

    // ── 4. Test Orders API access ──
    if (results.api_tests.connectivity === 'PASS') {
      try {
        const ordersResponse = await fetch(`https://${shopDomain}/admin/api/2024-01/orders.json?limit=10&status=any`, {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
        });

        results.api_tests.orders_endpoint = {
          url: `https://${shopDomain}/admin/api/2024-01/orders.json?limit=10`,
          status: ordersResponse.status,
          status_text: ordersResponse.statusText,
        };

        if (ordersResponse.ok) {
          const ordersData = await ordersResponse.json();
          const orders = ordersData.orders || [];
          
          results.api_tests.orders_access = 'PASS';
          results.order_samples.total_fetched = orders.length;
          
          // ── 4. Analyze orders for POS detection ──
          const posOrders = [];
          const onlineOrders = [];
          
          orders.forEach((order, idx) => {
            const orderInfo = {
              order_number: order.name || order.order_number,
              id: order.id,
              source_name: order.source_name,
              app_id: order.app_id,
              location_id: order.location_id,
              channel: order.channel,
              financial_status: order.financial_status,
              fulfillment_status: order.fulfillment_status,
              customer: {
                name: order.customer?.name || order.billing_address?.name,
                email: order.email,
                phone: order.phone,
              },
              total_price: order.total_price,
              created_at: order.created_at,
            };

            // POS classification
            const isPOS = 
              (order.source_name || '').toLowerCase() === 'pos' ||
              (order.channel || '').toLowerCase() === 'pos' ||
              !!order.location_id ||
              ['131', '131313', 'com.jadedpixel.pos'].includes(String(order.app_id));

            if (isPOS) {
              posOrders.push(orderInfo);
              orderInfo.classification = 'POS';
            } else {
              onlineOrders.push(orderInfo);
              orderInfo.classification = 'ONLINE';
            }

            if (idx < 5) {
              results.order_samples.recent_orders.push(orderInfo);
            }
          });

          results.order_samples.pos_count = posOrders.length;
          results.order_samples.online_count = onlineOrders.length;
          results.order_samples.pos_order_numbers = posOrders.map(o => o.order_number);

          if (posOrders.length === 0 && orders.length > 0) {
            results.recommendations.push('WARNING: No POS orders found in last 10 orders. This could mean: (a) no POS sales exist yet, (b) POS app not properly configured, or (c) need to fetch more orders.');
          }

        } else {
          const errorText = await ordersResponse.text().catch(() => 'N/A');
          results.api_tests.orders_access = 'FAIL';
          results.api_tests.orders_error = errorText;
          results.recommendations.push('Orders API access failed. Check token has read_orders scope.');
        }
      } catch (err) {
        results.api_tests.orders_access = 'ERROR';
        results.api_tests.orders_error = err.message;
      }
    }

    // ── 5. Webhook configuration check ──
    results.webhook_config = {
      secret_configured: !!webhookSecret,
      secret_length: webhookSecret?.length || 0,
    };

    if (!webhookSecret) {
      results.recommendations.push('WARNING: SHOPIFY_WEBHOOK_SECRET not set. Webhooks will fail HMAC verification.');
    }

    // ── 6. Scope recommendations ──
    results.recommendations.push('Verify Shopify app has these scopes: read_orders, read_all_orders (for all orders access), read_products, read_inventory, read_locations.');
    results.recommendations.push('For webhooks: ensure orders/create, orders/paid, orders/updated are registered at https://${shopDomain}/admin/settings/notifications');

    return Response.json(results);

  } catch (error) {
    return Response.json({
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
});