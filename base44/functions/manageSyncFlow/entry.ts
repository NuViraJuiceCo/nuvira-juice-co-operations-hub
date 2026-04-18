import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { action, order_data, customer_email } = body;

    const alerts = [];

    // Action 1: Process new order and enroll in loyalty
    if (action === 'process_order') {
      if (!order_data || !customer_email) {
        return Response.json({ error: 'Missing order_data or customer_email' }, { status: 400 });
      }

      try {
        // Create/update ShopifyOrder
        const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({ 
          base44_order_id: order_data.id 
        });

        const hubPayload = {
          shopify_order_id: `sync_${order_data.id}`,
          shopify_order_number: order_data.order_number || `#${order_data.id.slice(-6).toUpperCase()}`,
          base44_order_id: order_data.id,
          customer_email: customer_email,
          customer_phone: order_data.contact_phone || '',
          line_items: order_data.items || [],
          fulfillment_method: order_data.fulfillment_type || 'delivery',
          delivery_address: order_data.delivery_address || '',
          requested_delivery_date: order_data.estimated_delivery_date || '',
          payment_status: order_data.payment_captured ? 'paid' : 'pending',
          fulfillment_status: 'order_received',
          subtotal: order_data.subtotal || 0,
          total_price: order_data.total || 0,
          production_status: 'new',
          sync_status: 'synced',
          last_sync_at: new Date().toISOString(),
        };

        let order;
        if (existing?.length > 0) {
          order = await base44.asServiceRole.entities.ShopifyOrder.update(existing[0].id, hubPayload);
        } else {
          order = await base44.asServiceRole.entities.ShopifyOrder.create(hubPayload);
        }

        // Auto-enroll customer in loyalty program
        const loyaltyExisting = await base44.asServiceRole.entities.CustomerLoyalty.filter({ 
          customer_email: customer_email 
        });

        if (!loyaltyExisting || loyaltyExisting.length === 0) {
          await base44.asServiceRole.entities.CustomerLoyalty.create({
            customer_email: customer_email,
            total_points: 0,
            lifetime_points: 0,
            redeemed_points: 0,
            points_history: [{
              amount: 0,
              type: 'earned',
              description: 'Account created from order',
              timestamp: new Date().toISOString()
            }]
          });
          console.log(`[SYNC-FLOW] New loyalty account created for ${customer_email}`);
        } else {
          console.log(`[SYNC-FLOW] Loyalty account already exists for ${customer_email}`);
        }

        return Response.json({
          success: true,
          status: 'order_processed',
          order_id: order.id,
          customer_email: customer_email,
          alerts: alerts
        });
      } catch (error) {
        alerts.push({
          type: 'error',
          severity: 'critical',
          message: `Failed to process order for ${customer_email}: ${error.message}`,
          timestamp: new Date().toISOString()
        });
        return Response.json({ success: false, alerts }, { status: 500 });
      }
    }

    // Action 2: Verify sync health across all entities
    if (action === 'check_sync_health') {
      try {
        const orders = await base44.asServiceRole.entities.ShopifyOrder.list('-updated_date', 10);
        const products = await base44.asServiceRole.entities.Product.list('-updated_date', 5);
        const events = await base44.asServiceRole.entities.Event.list('-updated_date', 5);

        // Check for orders missing loyalty records
        for (const order of orders) {
          if (order.customer_email) {
            const loyalty = await base44.asServiceRole.entities.CustomerLoyalty.filter({ 
              customer_email: order.customer_email 
            });
            if (!loyalty || loyalty.length === 0) {
              alerts.push({
                type: 'warning',
                severity: 'high',
                message: `Order ${order.shopify_order_number} (${order.customer_email}) has no loyalty record`,
                timestamp: new Date().toISOString()
              });
            }
          }
        }

        // Check for failed syncs
        const failedOrders = orders.filter(o => o.sync_status === 'failed');
        if (failedOrders.length > 0) {
          alerts.push({
            type: 'error',
            severity: 'critical',
            message: `${failedOrders.length} orders have failed sync status`,
            timestamp: new Date().toISOString()
          });
        }

        return Response.json({
          success: true,
          sync_health: {
            orders_count: orders.length,
            products_count: products.length,
            events_count: events.length,
            alerts: alerts
          }
        });
      } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }
    }

    // Action 3: Get customer loyalty status
    if (action === 'get_loyalty_status') {
      if (!customer_email) {
        return Response.json({ error: 'Missing customer_email' }, { status: 400 });
      }

      try {
        const loyalty = await base44.asServiceRole.entities.CustomerLoyalty.filter({ 
          customer_email: customer_email 
        });

        if (!loyalty || loyalty.length === 0) {
          return Response.json({
            success: true,
            status: 'no_account',
            customer_email: customer_email,
            alerts: [{
              type: 'warning',
              message: `No loyalty account found for ${customer_email}`
            }]
          });
        }

        return Response.json({
          success: true,
          status: 'active',
          customer_email: customer_email,
          total_points: loyalty[0].total_points,
          lifetime_points: loyalty[0].lifetime_points,
          redeemed_points: loyalty[0].redeemed_points
        });
      } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[MANAGE-SYNC-FLOW] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});