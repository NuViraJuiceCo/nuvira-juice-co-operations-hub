import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * syncRecentShopifyOrders - Pull recent orders from Shopify Admin API as reliable fallback
 * 
 * This function:
 * - Pulls orders from the last 24-48 hours via Admin API
 * - Classifies POS orders by source_name, channel, location_id, app_id
 * - Creates/updates ShopifyOrder records idempotently
 * - Tags POS orders appropriately (shopify_pos)
 * - Excludes POS orders from fulfillment/production workflows
 * 
 * Auth: Client ID + Client Secret via OAuth 2.0 client credentials exchange
 * Usage: Admin-only or scheduled automation (every 15-30 minutes)
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    // Admin-only or internal scheduled call
    if (!user || user.role !== 'admin') {
      // Allow internal calls without user context
      const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');
      const requestSecret = req.headers.get('X-Internal-Secret');
      if (!internalSecret || requestSecret !== internalSecret) {
        return Response.json({ error: 'Admin access or internal secret required' }, { status: 403 });
      }
    }

    const shopDomain = Deno.env.get('SHOPIFY_SHOP_DOMAIN');
    const clientId = Deno.env.get('SHOPIFY_CLIENT_ID');
    const clientSecret = Deno.env.get('SHOPIFY_CLIENT_SECRET');

    // Active auth: Client ID + Client Secret (static token no longer supported)
    const usingClientCredentials = !!clientId && !!clientSecret;

    if (!shopDomain || !usingClientCredentials) {
      return Response.json({ 
        error: 'Missing Shopify credentials',
        status: 'FAILED',
        reason: 'SHOPIFY_SHOP_DOMAIN, SHOPIFY_CLIENT_ID, and SHOPIFY_CLIENT_SECRET required (from Shopify Dev Dashboard)'
      }, { status: 500 });
    }

    // Get access token via client credentials exchange
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
      
      if (!tokenResponse.ok || !tokenData.access_token) {
        return Response.json({
          error: 'Token exchange failed',
          status: 'FAILED',
          reason: tokenData.message || 'Failed to obtain access token from client credentials',
          details: tokenData
        }, { status: 500 });
      }

      accessToken = tokenData.access_token;
    } catch (err) {
      return Response.json({
        error: 'Token exchange error',
        status: 'FAILED',
        reason: err.message
      }, { status: 500 });
    }

    const stats = {
      total_pulled: 0,
      pos_orders: 0,
      online_orders: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    // Fetch recent orders (last 48 hours to be safe)
    const twoDaysAgo = new Date(Date.now() - (48 * 60 * 60 * 1000)).toISOString();
    
    const ordersResponse = await fetch(`https://${shopDomain}/admin/api/2024-01/orders.json?limit=50&status=any&updated_at_min=${twoDaysAgo}`, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    });

    if (!ordersResponse.ok) {
      const errorText = await ordersResponse.text().catch(() => 'N/A');
      return Response.json({
        error: 'Failed to fetch orders from Shopify',
        status: 'FAILED',
        http_status: ordersResponse.status,
        details: errorText,
      }, { status: 500 });
    }

    const ordersData = await ordersResponse.json();
    const orders = ordersData.orders || [];

    stats.total_pulled = orders.length;

    // Process each order
    for (const shopifyOrder of orders) {
      try {
        // Classify order type
        const isPOS = 
          (shopifyOrder.source_name || '').toLowerCase() === 'pos' ||
          (shopifyOrder.channel || '').toLowerCase() === 'pos' ||
          !!shopifyOrder.location_id ||
          ['131', '131313', 'com.jadedpixel.pos'].includes(String(shopifyOrder.app_id));

        if (isPOS) {
          stats.pos_orders++;
        } else {
          stats.online_orders++;
        }

        // Check if order already exists in Hub
        const existingOrders = await base44.entities.ShopifyOrder.filter({
          shopify_order_id: String(shopifyOrder.id),
        });

        const orderData = {
          shopify_order_id: String(shopifyOrder.id),
          shopify_order_number: shopifyOrder.name || String(shopifyOrder.order_number),
          order_type: isPOS ? 'pos' : 'one_time',
          source_channel: isPOS ? 'pos' : 'online',
          source_type: isPOS ? 'shopify_pos' : 'shopify_online',
          customer_email: shopifyOrder.email,
          customer_name: shopifyOrder.customer?.name || shopifyOrder.billing_address?.name,
          customer_phone: shopifyOrder.phone,
          line_items: (shopifyOrder.line_items || []).map(item => ({
            title: item.title,
            quantity: item.quantity,
            price: parseFloat(item.price),
          })),
          payment_status: shopifyOrder.financial_status,
          fulfillment_status: shopifyOrder.fulfillment_status,
          subtotal: parseFloat(shopifyOrder.subtotal_price || '0'),
          total_price: parseFloat(shopifyOrder.total_price || '0'),
          tags: isPOS ? ['shopify_pos', 'pos_order'] : ['shopify_online'],
          sync_status: 'synced',
          last_sync_at: new Date().toISOString(),
        };

        // Add address fields for non-POS orders
        if (!isPOS && shopifyOrder.shipping_address) {
          Object.assign(orderData, {
            address_line1: shopifyOrder.shipping_address.address1,
            address_line2: shopifyOrder.shipping_address.address2 || '',
            address_city: shopifyOrder.shipping_address.city,
            address_state: shopifyOrder.shipping_address.province,
            address_postal_code: shopifyOrder.shipping_address.zip,
            address_country: shopifyOrder.shipping_address.country,
            delivery_notes: shopifyOrder.note || '',
          });
        } else if (isPOS) {
          // POS orders: mark as pickup/no delivery
          orderData.fulfillment_method = 'pos';
          orderData.production_status = 'not_required';
        }

        if (existingOrders.length > 0) {
          // Update existing order — WRITE-DIFF GUARD: only write if data materially changed
          const existing = existingOrders[0];
          let hasChange = false;

          // Compare key mutable fields (exclude sync_status/last_sync_at — they change every run)
          const compareFields = ['payment_status', 'fulfillment_status', 'production_status', 'address_line1', 'address_city', 'total_price', 'tags'];
          for (const field of compareFields) {
            const existingVal = JSON.stringify(existing[field]);
            const incomingVal = JSON.stringify(orderData[field]);
            if (existingVal !== incomingVal) {
              hasChange = true;
              break;
            }
          }

          if (hasChange) {
            await base44.entities.ShopifyOrder.update(existing.id, orderData);
            stats.updated++;
          } else {
            stats.skipped++;
          }
        } else {
          // Create new order
          await base44.entities.ShopifyOrder.create(orderData);
          stats.created++;
        }

      } catch (orderError) {
        stats.errors.push({
          order_number: shopifyOrder.name,
          error: orderError.message,
        });
      }
    }

    return Response.json({
      status: 'SUCCESS',
      timestamp: new Date().toISOString(),
      stats,
      message: `Synced ${stats.total_pulled} orders (${stats.pos_orders} POS, ${stats.online_orders} online). Created: ${stats.created}, Updated: ${stats.updated}`,
    });

  } catch (error) {
    return Response.json({
      status: 'FAILED',
      error: error.message,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
});