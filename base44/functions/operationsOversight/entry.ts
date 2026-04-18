import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { action } = body;

    // Action: Daily Operations Briefing
    if (action === 'daily_briefing') {
      const briefing = {
        timestamp: new Date().toISOString(),
        alerts: [],
        summary: {},
        actionItems: []
      };

      try {
        // 1. Order Pipeline Health
        const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-updated_date', 50);
        const ordersByStatus = {};
        const stuckOrders = [];
        const at_risk_orders = [];

        for (const order of allOrders) {
          ordersByStatus[order.production_status] = (ordersByStatus[order.production_status] || 0) + 1;

          // Check for stuck orders (>24h in same status)
          const hoursSinceUpdate = (Date.now() - new Date(order.updated_date).getTime()) / (1000 * 60 * 60);
          if (order.production_status === 'in_production' && hoursSinceUpdate > 24) {
            stuckOrders.push({
              order_id: order.shopify_order_number,
              status: order.production_status,
              hours_elapsed: Math.round(hoursSinceUpdate)
            });
          }

          // Check for at-risk delivery dates
          if (order.requested_delivery_date) {
            const deliveryDate = new Date(order.requested_delivery_date);
            const hoursUntilDelivery = (deliveryDate.getTime() - Date.now()) / (1000 * 60 * 60);
            if (hoursUntilDelivery < 48 && order.production_status !== 'packed') {
              at_risk_orders.push({
                order_id: order.shopify_order_number,
                current_status: order.production_status,
                delivery_in_hours: Math.round(hoursUntilDelivery),
                action: 'Accelerate production or notify customer'
              });
            }
          }
        }

        briefing.summary.total_orders = allOrders.length;
        briefing.summary.orders_by_status = ordersByStatus;

        if (stuckOrders.length > 0) {
          briefing.alerts.push({
            type: 'critical',
            message: `${stuckOrders.length} orders stalled in production`,
            details: stuckOrders
          });
        }

        if (at_risk_orders.length > 0) {
          briefing.alerts.push({
            type: 'warning',
            message: `${at_risk_orders.length} orders at risk of missing delivery dates`,
            details: at_risk_orders
          });
        }

        // 2. Loyalty & Customer Health
        const allCustomers = await base44.asServiceRole.entities.CustomerLoyalty.list('-updated_date', 50);
        briefing.summary.total_loyalty_members = allCustomers.length;

        const inactiveCustomers = allCustomers.filter(c => {
          const daysSinceUpdate = (Date.now() - new Date(c.updated_date).getTime()) / (1000 * 60 * 60 * 24);
          return daysSinceUpdate > 30 && c.total_points > 0;
        });

        if (inactiveCustomers.length > 0) {
          briefing.alerts.push({
            type: 'info',
            message: `${inactiveCustomers.length} loyal customers inactive for 30+ days`,
            action: 'Consider re-engagement campaigns'
          });
        }

        // 3. Inventory Health
        const inventory = await base44.asServiceRole.entities.InventoryItem.list('-updated_date', 30);
        const lowStockItems = inventory.filter(item => item.stock <= item.reorder_point);

        briefing.summary.inventory_items_total = inventory.length;
        briefing.summary.low_stock_count = lowStockItems.length;

        if (lowStockItems.length > 0) {
          briefing.alerts.push({
            type: 'warning',
            message: `${lowStockItems.length} items at or below reorder point`,
            items: lowStockItems.map(i => ({
              ingredient: i.ingredient,
              current_stock: i.stock,
              reorder_point: i.reorder_point,
              supplier: i.supplier
            }))
          });
        }

        // 4. Sync Integrity Check
        const products = await base44.asServiceRole.entities.Product.list('-updated_date', 5);
        const events = await base44.asServiceRole.entities.Event.list('-updated_date', 5);

        // Check for orders without loyalty records
        const orphanedOrders = [];
        for (const order of allOrders) {
          if (order.customer_email) {
            const loyalty = await base44.asServiceRole.entities.CustomerLoyalty.filter({ 
              customer_email: order.customer_email 
            });
            if (!loyalty || loyalty.length === 0) {
              orphanedOrders.push({
                order_id: order.shopify_order_number,
                customer_email: order.customer_email
              });
            }
          }
        }

        briefing.summary.data_sync_status = 'healthy';
        briefing.summary.products_synced = products.length;
        briefing.summary.events_synced = events.length;

        if (orphanedOrders.length > 0) {
          briefing.alerts.push({
            type: 'error',
            message: `${orphanedOrders.length} orders missing loyalty records (data integrity issue)`,
            details: orphanedOrders
          });
          briefing.summary.data_sync_status = 'degraded';
        }

        // 5. Production Timeline
        const batches = await base44.asServiceRole.entities.ProductionBatch.list('-updated_date', 20);
        const delayedBatches = batches.filter(b => {
          const daysUntilProduction = (new Date(b.production_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
          return daysUntilProduction < 1 && (b.status === 'Planned' || b.status === 'Awaiting Ingredients');
        });

        if (delayedBatches.length > 0) {
          briefing.alerts.push({
            type: 'critical',
            message: `${delayedBatches.length} production batches starting within 24h but not ready`,
            details: delayedBatches.map(b => ({
              batch_id: b.batch_id,
              product: b.product_name,
              status: b.status,
              production_date: b.production_date
            }))
          });
        }

        // 6. Action Items
        briefing.actionItems = [
          stuckOrders.length > 0 ? '⚠️ Contact production team about stuck orders' : null,
          at_risk_orders.length > 0 ? '⚠️ Review delivery dates and customer communications' : null,
          lowStockItems.length > 0 ? '📦 Place supplier orders immediately' : null,
          orphanedOrders.length > 0 ? '🔧 Reconcile missing loyalty records' : null,
          delayedBatches.length > 0 ? '🚀 Confirm batch ingredients availability' : null,
          inactiveCustomers.length > 0 ? '📧 Launch customer re-engagement' : null
        ].filter(Boolean);

        return Response.json({ success: true, briefing });
      } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }
    }

    // Action: Monitor Order Health
    if (action === 'order_health_check') {
      try {
        const orders = await base44.asServiceRole.entities.ShopifyOrder.list('-updated_date', 100);
        const health = {
          total: orders.length,
          by_status: {},
          risks: [],
          critical_issues: []
        };

        for (const order of orders) {
          health.by_status[order.production_status] = (health.by_status[order.production_status] || 0) + 1;

          // Predictive check: if delivery is in 2 days and not packed, flag it
          if (order.requested_delivery_date && !order.assigned_delivery_date) {
            const hoursToDelivery = (new Date(order.requested_delivery_date).getTime() - Date.now()) / (1000 * 60 * 60);
            if (hoursToDelivery < 48 && order.production_status !== 'packed') {
              health.risks.push({
                order: order.shopify_order_number,
                risk: 'DELIVERY_AT_RISK',
                reason: `Only ${Math.round(hoursToDelivery)}h until delivery, still in ${order.production_status}`
              });
            }
          }
        }

        return Response.json({ success: true, health });
      } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }
    }

    // Action: Inventory Prediction
    if (action === 'inventory_forecast') {
      try {
        const inventory = await base44.asServiceRole.entities.InventoryItem.list('-updated_date', 50);
        const forecast = {
          critical: [],
          warning: [],
          healthy: []
        };

        for (const item of inventory) {
          const daysUntilStockout = item.stock > 0 ? (item.stock / (item.reorder_point || 1)) * 7 : 0;
          
          if (item.stock < item.reorder_point) {
            forecast.critical.push({
              ingredient: item.ingredient,
              current: item.stock,
              needed: item.reorder_point,
              action: `Order ${item.reorder_point - item.stock} more from ${item.supplier}`
            });
          } else if (daysUntilStockout < 14) {
            forecast.warning.push({
              ingredient: item.ingredient,
              current: item.stock,
              days_until_reorder: Math.round(daysUntilStockout)
            });
          } else {
            forecast.healthy.push(item.ingredient);
          }
        }

        return Response.json({ success: true, forecast });
      } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[OPS-OVERSIGHT] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});