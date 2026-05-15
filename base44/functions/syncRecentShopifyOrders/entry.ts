import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * syncRecentShopifyOrders — Pull recent Shopify orders via Admin API
 * 
 * Purpose: Reliable fallback to webhooks for ingesting POS orders.
 * Calls Shopify Admin API to fetch recent orders and ingests missing ones.
 * 
 * Auth: Admin-only or scheduled with INTERNAL_FUNCTION_SECRET
 * Inputs:
 *   - created_at_min: ISO timestamp or relative (e.g., "-24h")
 *   - limit: Max orders to fetch (default 50)
 *   - source: "pos" | "all" (default "all")
 */

const POS_APP_IDS = new Set(['131', '131313', 'com.jadedpixel.pos', 'shopify_pos', 'pos']);

function classifyAsPOS(order) {
  const sourceName = (order.source_name || '').toLowerCase();
  const appId = String(order.app_id || '').toLowerCase();
  const hasLocationId = !!(order.location_id);
  const fulfillmentService = (order.fulfillment_service || '').toLowerCase();
  
  if (sourceName === 'pos' || sourceName.includes('pos')) return true;
  if (POS_APP_IDS.has(appId)) return true;
  if (hasLocationId) return true;
  if (fulfillment_service === 'manual' && sourceName === 'pos') return true;
  return false;
}

function mapPaymentStatus(financialStatus) {
  const map = {
    paid: 'paid',
    partially_paid: 'paid',
    authorized: 'authorized',
    pending: 'pending',
    refunded: 'refunded',
    partially_refunded: 'refunded',
    voided: 'refunded',
  };
  return map[(financialStatus || '').toLowerCase()] || 'pending';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    // Admin-only OR internal secret for scheduled runs
    const internalSecret = req.headers.get('X-Internal-Secret');
    const expectedSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');
    const isInternal = internalSecret && expectedSecret && internalSecret === expectedSecret;
    
    if (!user && !isInternal) {
      return Response.json({ error: 'Unauthorized — admin or internal secret required' }, { status: 401 });
    }
    
    if (user && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden — admin access required' }, { status: 403 });
    }
    
    // Parse inputs
    const { created_at_min, limit = 50, source = 'all' } = await req.json().catch(() => ({}));
    
    // Calculate created_at_min
    let minDate;
    if (created_at_min) {
      if (created_at_min.startsWith('-')) {
        // Relative time (e.g., "-24h")
        const hours = parseInt(created_at_min.slice(1, -1));
        const unit = created_at_min.slice(-1);
        const now = new Date();
        if (unit === 'h') {
          minDate = new Date(now.getTime() - hours * 60 * 60 * 1000);
        } else if (unit === 'd') {
          minDate = new Date(now.getTime() - hours * 24 * 60 * 60 * 1000);
        } else {
          minDate = new Date(now.getTime() - hours * 60 * 60 * 1000); // default to hours
        }
      } else {
        minDate = new Date(created_at_min);
      }
    } else {
      // Default: last 24 hours
      minDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    }
    
    const shopDomain = Deno.env.get('SHOPIFY_SHOP_DOMAIN');
    const accessToken = Deno.env.get('SHOPIFY_ADMIN_ACCESS_TOKEN');
    
    if (!shopDomain || !accessToken) {
      return Response.json({ 
        error: 'Shopify credentials not configured',
        details: { shop_domain_set: !!shopDomain, access_token_set: !!accessToken }
      }, { status: 500 });
    }
    
    console.log(`[SYNC-SHOPIFY] Fetching orders since ${minDate.toISOString()} limit=${limit} source=${source}`);
    
    // Fetch orders from Shopify Admin API
    const url = new URL(`https://${shopDomain}/admin/api/2024-04/orders.json`);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('created_at_min', minDate.toISOString());
    url.searchParams.set('status', 'any'); // Include all order statuses
    
    const response = await fetch(url.toString(), {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new Error(`Shopify API error: ${response.status} ${response.statusText} — ${errorBody}`);
    }
    
    const shopifyData = await response.json();
    const shopifyOrders = shopifyData.orders || [];
    
    console.log(`[SYNC-SHOPIFY] Fetched ${shopifyOrders.length} orders from Shopify`);
    
    // Process orders
    const results = {
      synced_count: 0,
      created_count: 0,
      updated_count: 0,
      skipped_count: 0,
      pos_count: 0,
      online_count: 0,
      errors: [],
    };
    
    for (const order of shopifyOrders) {
      try {
        const orderId = String(order.id);
        const orderNumber = order.name || `#${order.order_number}`;
        const isPOS = classifyAsPOS(order);
        
        // Filter by source if requested
        if (source === 'pos' && !isPOS) {
          results.skipped_count++;
          continue;
        }
        
        // Check if order already exists in Hub
        const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({ 
          shopify_order_id: orderId 
        });
        const existingOrder = existing?.[0] || null;
        
        // Build customer info
        const customerEmail = order.email || order.customer?.email || '';
        const firstName = order.billing_address?.first_name || order.shipping_address?.first_name || order.customer?.first_name || '';
        const lastName = order.billing_address?.last_name || order.shipping_address?.last_name || order.customer?.last_name || '';
        const customerName = [firstName, lastName].join(' ').trim() || (isPOS ? 'POS Customer' : customerEmail || 'Unknown');
        const customerPhone = order.phone || order.billing_address?.phone || order.shipping_address?.phone || order.customer?.phone || '';
        
        // Build line items
        const lineItems = (order.line_items || []).map(item => ({
          title: item.title || item.name || 'Item',
          quantity: item.quantity || 1,
          price: parseFloat(item.price || 0),
        }));
        
        const totalPrice = parseFloat(order.total_price || order.subtotal_price || 0);
        const subtotal = parseFloat(order.subtotal_price || order.total_price || 0);
        const hubPaymentStatus = mapPaymentStatus(order.financial_status);
        
        if (isPOS) {
          results.pos_count++;
          
          if (existingOrder) {
            // Update existing POS order (payment status, fulfillment status)
            const updates: any = {
              payment_status: hubPaymentStatus,
              fulfillment_status: 'fulfilled',
              last_sync_at: new Date().toISOString(),
            };
            
            // Only update if something changed
            if (existingOrder.payment_status !== hubPaymentStatus || 
                existingOrder.fulfillment_status !== 'fulfilled') {
              await base44.asServiceRole.entities.ShopifyOrder.update(existingOrder.id, updates);
              results.updated_count++;
              console.log(`[SYNC-SHOPIFY] Updated POS order ${orderNumber} (id=${existingOrder.id})`);
            } else {
              results.skipped_count++;
              console.log(`[SYNC-SHOPIFY] Skipped POS order ${orderNumber} — no changes`);
            }
          } else {
            // Create new POS order
            const posPayload = {
              shopify_order_id: orderId,
              shopify_order_number: orderNumber,
              customer_name: customerName,
              customer_email: customerEmail || `pos-${orderId}@nuvira.local`,
              customer_phone: customerPhone,
              address_line1: '',
              address_line2: '',
              address_city: '',
              address_state: '',
              address_postal_code: '',
              address_country: 'US',
              delivery_address: '',
              line_items: lineItems,
              total_price: totalPrice,
              subtotal: subtotal,
              payment_status: hubPaymentStatus,
              fulfillment_status: 'fulfilled',
              production_status: 'not_required',
              order_lock_status: 'fulfilled',
              data_quality_status: 'complete',
              source_channel: 'pos',
              source_type: 'shopify_pos',
              order_type: 'pos',
              fulfillment_method: 'pos',
              fulfillment_mode: 'single_delivery',
              internal_notes: `POS Sale via Shopify Admin API Sync | location_id: ${order.location_id || 'N/A'} | source_name: ${order.source_name || 'pos'}`,
              tags: ['pos_sale', 'event_sale', 'no_delivery', 'no_production', 'api_sync'],
              sync_status: 'synced',
              last_sync_at: new Date().toISOString(),
              customer_order_date: order.created_at,
            };
            
            const created = await base44.asServiceRole.entities.ShopifyOrder.create(posPayload);
            results.created_count++;
            results.synced_count++;
            console.log(`[SYNC-SHOPIFY] Created POS order ${orderNumber} → hub_id=${created.id}`);
          }
        } else {
          results.online_count++;
          
          if (existingOrder) {
            // Update existing online order
            const updates: any = {
              payment_status: hubPaymentStatus,
              fulfillment_status: order.fulfillment_status || existingOrder.fulfillment_status,
              last_sync_at: new Date().toISOString(),
            };
            
            await base44.asServiceRole.entities.ShopifyOrder.update(existingOrder.id, updates);
            results.updated_count++;
            console.log(`[SYNC-SHOPIFY] Updated online order ${orderNumber}`);
          } else {
            // Create new online order (route through safeSyncOrderUpdate for full validation)
            const shippingAddr = order.shipping_address || order.billing_address || {};
            const onlinePayload = {
              shopify_order_id: orderId,
              shopify_order_number: orderNumber,
              customer_name: customerName,
              customer_email: customerEmail,
              customer_phone: customerPhone,
              line_items: lineItems,
              total_price: totalPrice,
              subtotal: subtotal,
              payment_status: hubPaymentStatus,
              fulfillment_status: order.fulfillment_status,
              source_channel: 'online',
              source_type: 'stripe_checkout',
              order_type: 'one_time',
              fulfillment_mode: 'single_delivery',
              fulfillment_method: 'delivery',
              address_line1: shippingAddr.address1 || '',
              address_line2: shippingAddr.address2 || '',
              address_city: shippingAddr.city || '',
              address_state: shippingAddr.province || '',
              address_postal_code: shippingAddr.zip || '',
              address_country: shippingAddr.country_code || 'US',
              address_last_synced_from: 'shopify_admin_api',
              address_last_synced_at: new Date().toISOString(),
              sync_status: 'synced',
              last_sync_at: new Date().toISOString(),
              customer_order_date: order.created_at,
            };
            
            await base44.asServiceRole.functions.invoke('safeSyncOrderUpdate', {
              _internalSecret: Deno.env.get('INTERNAL_FUNCTION_SECRET'),
              incomingData: onlinePayload,
              source: 'shopify_admin_api',
              matchBy: { shopify_order_id: orderId },
            });
            
            results.created_count++;
            results.synced_count++;
            console.log(`[SYNC-SHOPIFY] Created online order ${orderNumber}`);
          }
        }
        
      } catch (error) {
        const errorMsg = `Error processing order ${order.name || order.id}: ${error.message}`;
        console.error('[SYNC-SHOPIFY]', errorMsg);
        results.errors.push(errorMsg);
      }
    }
    
    console.log(`[SYNC-SHOPIFY] Complete — synced=${results.synced_count} created=${results.created_count} updated=${results.updated_count} skipped=${results.skipped_count} pos=${results.pos_count} online=${results.online_count} errors=${results.errors.length}`);
    
    return Response.json({
      success: true,
      ...results,
      fetched_at: new Date().toISOString(),
    }, { status: 200 });
    
  } catch (error) {
    console.error('[SYNC-SHOPIFY] Fatal error:', error.message, error.stack);
    
    return Response.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
});