import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Get the latest order
    const orders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 1);
    
    if (!orders || orders.length === 0) {
      return Response.json({ 
        success: false, 
        message: 'No orders found in the hub' 
      });
    }

    const latestOrder = orders[0];
    
    return Response.json({
      success: true,
      order: {
        id: latestOrder.id,
        order_number: latestOrder.shopify_order_number,
        customer_email: latestOrder.customer_email,
        created_at: latestOrder.created_date,
        sync_status: latestOrder.sync_status,
        production_status: latestOrder.production_status,
        fulfillment_status: latestOrder.fulfillment_status,
        last_sync_at: latestOrder.last_sync_at,
        total: latestOrder.total_price,
        items_count: latestOrder.line_items?.length || 0
      },
      sync_check: {
        was_synced: latestOrder.sync_status === 'synced',
        sync_timestamp: latestOrder.last_sync_at,
        hours_since_sync: latestOrder.last_sync_at ? 
          Math.round((Date.now() - new Date(latestOrder.last_sync_at).getTime()) / (1000 * 60 * 60)) : 
          null
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});