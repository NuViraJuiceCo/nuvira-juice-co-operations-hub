import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // The 3 verified repair-ready orders from dry run
    const repairOrderNumbers = [
      'NV-MOPV2CIK',
      'NV-MOOV82PT',
      'NV-MOOPFCUS'
    ];

    // Fetch orders
    const allOrders = await base44.entities.ShopifyOrder.list('-created_date', 500);
    const ordersToRepair = allOrders.filter(o => repairOrderNumbers.includes(o.shopify_order_number));

    const repairs = [];
    const failures = [];

    // Repair each order
    for (const order of ordersToRepair) {
      try {
        const before = {
          order_number: order.shopify_order_number,
          assigned_production_date: order.assigned_production_date,
          assigned_delivery_date: order.assigned_delivery_date
        };

        // Update the order with assigned_production_date
        await base44.entities.ShopifyOrder.update(order.id, {
          assigned_production_date: '2026-05-05'
        });

        repairs.push({
          order_number: order.shopify_order_number,
          customer_name: order.customer_name,
          before,
          status: 'success'
        });

      } catch (err) {
        failures.push({
          order_number: order.shopify_order_number,
          error: String(err.message || err)
        });
      }
    }

    return Response.json({
      status: 'repair_complete',
      total_attempted: ordersToRepair.length,
      successful: repairs.length,
      failed: failures.length,
      repairs: repairs,
      failures: failures
    });
  } catch (error) {
    console.error('Repair error:', error);
    return Response.json({ error: String(error.message || error) }, { status: 500 });
  }
});