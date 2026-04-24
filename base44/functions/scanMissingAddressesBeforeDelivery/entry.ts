import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Scheduled automation: Scan for missing addresses on upcoming fulfillments
 * Runs daily and flags issues for admin review before delivery day
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const result = {
      timestamp: new Date().toISOString(),
      scan_date: new Date().toISOString().split('T')[0],
      upcoming_fulfillments: [],
      missing_addresses: [],
      repaired: [],
    };

    // Get all orders
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);

    for (const order of allOrders) {
      if (!order.fulfillments || !Array.isArray(order.fulfillments)) continue;

      for (const fulfillment of order.fulfillments) {
        const deliveryDate = new Date(fulfillment.delivery_date + 'T00:00:00');
        
        // Only check upcoming fulfillments (today through next 7 days)
        if (deliveryDate < today || deliveryDate > nextWeek) continue;

        result.upcoming_fulfillments.push({
          order_id: order.id,
          delivery_date: fulfillment.delivery_date,
          customer_email: order.customer_email,
        });

        // Check for missing address
        if (!fulfillment.address_line1 || !fulfillment.address_city) {
          let repaired = false;

          // Try to backfill from parent order
          if (order.address_line1 && order.address_city) {
            fulfillment.address_line1 = order.address_line1;
            fulfillment.address_line2 = order.address_line2 || '';
            fulfillment.address_city = order.address_city;
            fulfillment.address_state = order.address_state || '';
            fulfillment.address_postal_code = order.address_postal_code || '';
            fulfillment.address_country = order.address_country || 'US';
            fulfillment.delivery_notes = order.delivery_notes || '';
            
            // Save repaired fulfillments
            await base44.asServiceRole.entities.ShopifyOrder.update(order.id, {
              fulfillments: order.fulfillments,
            });

            result.repaired.push({
              order_id: order.id,
              delivery_date: fulfillment.delivery_date,
              customer_email: order.customer_email,
              method: 'inherited_from_parent_order',
            });
            repaired = true;
          }

          if (!repaired) {
            result.missing_addresses.push({
              order_id: order.id,
              fulfillment_number: fulfillment.fulfillment_number,
              delivery_date: fulfillment.delivery_date,
              customer_email: order.customer_email,
              customer_name: order.customer_name,
              urgency: deliveryDate.getTime() - today.getTime() <= 86400000 ? 'URGENT_TOMORROW' : 'UPCOMING',
            });
          }
        }
      }
    }

    console.log(
      '[SCAN-MISSING-ADDRESSES]',
      'Upcoming:', result.upcoming_fulfillments.length,
      'Repaired:', result.repaired.length,
      'Flagged:', result.missing_addresses.length
    );

    return Response.json({ success: true, result });
  } catch (error) {
    console.error('[SCAN-MISSING-ADDRESSES] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});