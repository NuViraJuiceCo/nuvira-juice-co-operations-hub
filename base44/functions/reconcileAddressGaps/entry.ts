import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * reconcileAddressGaps
 * 
 * For every delivery ShopifyOrder missing a complete address:
 * 1. Attempt to pull address from Customer App API
 * 2. If found → sync into Hub via safeSyncOrderUpdate
 * 3. If not found → tag internal_notes with "NEEDS_ADDRESS_REVIEW" so it's visible
 * 4. Returns a full report of synced, flagged, and already-complete orders
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const CUSTOMER_APP_API_URL = Deno.env.get('CUSTOMER_APP_API_URL');
    const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

    // Load all paid delivery orders
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({ payment_status: 'paid' });
    
    const deliveryOrders = allOrders.filter(o => 
      o.fulfillment_method === 'delivery' &&
      !['fulfilled', 'canceled', 'refunded'].includes(o.production_status)
    );

    const missingAddressOrders = deliveryOrders.filter(o => 
      !o.address_line1 || !o.address_city || !o.address_state || !o.address_postal_code
    );

    console.log(`[ADDR-RECONCILE] Found ${missingAddressOrders.length} delivery orders missing address out of ${deliveryOrders.length} total delivery orders`);

    const results = {
      total_checked: deliveryOrders.length,
      already_complete: deliveryOrders.length - missingAddressOrders.length,
      synced_from_customer_app: [],
      flagged_needs_review: [],
      errors: [],
    };

    for (const order of missingAddressOrders) {
      try {
        // Try to fetch address from Customer App by order number or email
        let appAddress = null;

        if (CUSTOMER_APP_API_URL && CUSTOMER_APP_SYNC_SECRET) {
          // Try fetching the customer profile which may include their saved address
          const profileRes = await fetch(`${CUSTOMER_APP_API_URL}/api/hub/customer-profile`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
            },
            body: JSON.stringify({ email: order.customer_email }),
          }).catch(() => null);

          if (profileRes && profileRes.ok) {
            const profileData = await profileRes.json().catch(() => null);
            const addr = profileData?.address || profileData?.delivery_address || profileData?.profile?.address;
            if (addr && addr.address_line1 && addr.address_city && addr.address_state && addr.address_postal_code) {
              appAddress = addr;
            }
          }

          // Also try fetching the specific order by order number
          if (!appAddress) {
            const orderRes = await fetch(`${CUSTOMER_APP_API_URL}/api/hub/order`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
              },
              body: JSON.stringify({ order_number: order.shopify_order_number, email: order.customer_email }),
            }).catch(() => null);

            if (orderRes && orderRes.ok) {
              const orderData = await orderRes.json().catch(() => null);
              const addr = orderData?.address || orderData?.delivery_address || orderData?.order?.address;
              if (addr && addr.address_line1 && addr.address_city && addr.address_state && addr.address_postal_code) {
                appAddress = addr;
              }
            }
          }
        }

        if (appAddress) {
          // Sync address into Hub via safeSyncOrderUpdate
          const syncRes = await base44.functions.invoke('safeSyncOrderUpdate', {
            incomingData: {
              address_line1: appAddress.address_line1,
              address_line2: appAddress.address_line2 || '',
              address_city: appAddress.address_city,
              address_state: appAddress.address_state,
              address_postal_code: appAddress.address_postal_code,
              address_country: appAddress.address_country || 'CA',
              address_last_synced_from: 'reconcileAddressGaps',
              address_last_synced_at: new Date().toISOString(),
            },
            source: 'customer_app',
            matchBy: { internal_id: order.id },
          });

          results.synced_from_customer_app.push({
            order_id: order.id,
            order_number: order.shopify_order_number,
            customer_email: order.customer_email,
            address_synced: `${appAddress.address_line1}, ${appAddress.address_city}, ${appAddress.address_state}`,
            sync_result: syncRes?.data?.status || 'unknown',
          });

          console.log(`[ADDR-RECONCILE] Synced address for ${order.shopify_order_number} from Customer App`);
        } else {
          // Customer App has no address either — flag for admin review
          const alreadyFlagged = (order.internal_notes || '').includes('NEEDS_ADDRESS_REVIEW');
          
          if (!alreadyFlagged) {
            await base44.asServiceRole.entities.ShopifyOrder.update(order.id, {
              internal_notes: (order.internal_notes ? order.internal_notes + '\n' : '') +
                `[NEEDS_ADDRESS_REVIEW] No address found in Customer App as of ${new Date().toISOString()}. Driver Portal excluded until resolved.`,
            });
          }

          results.flagged_needs_review.push({
            order_id: order.id,
            order_number: order.shopify_order_number,
            customer_name: order.customer_name,
            customer_email: order.customer_email,
            production_status: order.production_status,
            requested_delivery_date: order.requested_delivery_date || order.assigned_delivery_date || null,
            already_flagged: alreadyFlagged,
          });

          console.log(`[ADDR-RECONCILE] Flagged ${order.shopify_order_number} — no address in Customer App`);
        }
      } catch (err) {
        console.error(`[ADDR-RECONCILE] Error on order ${order.shopify_order_number}:`, err.message);
        results.errors.push({
          order_number: order.shopify_order_number,
          error: err.message,
        });
      }
    }

    // Log this reconciliation run
    await base44.asServiceRole.entities.RepairAuditLog.create({
      timestamp: new Date().toISOString(),
      executed_by: user.email,
      repair_function: 'repairMissingAddresses',
      action: 'repair',
      records_affected: results.synced_from_customer_app.length + results.flagged_needs_review.length,
      reason: 'Admin triggered address gap reconciliation from Hub UI',
      changes: {
        synced_count: results.synced_from_customer_app.length,
        flagged_count: results.flagged_needs_review.length,
        error_count: results.errors.length,
      },
      details: results,
    });

    return Response.json({
      success: true,
      summary: {
        total_delivery_orders: results.total_checked,
        already_had_address: results.already_complete,
        synced_from_customer_app: results.synced_from_customer_app.length,
        flagged_needs_review: results.flagged_needs_review.length,
        errors: results.errors.length,
      },
      synced: results.synced_from_customer_app,
      needs_review: results.flagged_needs_review,
      errors: results.errors,
    });

  } catch (error) {
    console.error('[ADDR-RECONCILE] Fatal error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});