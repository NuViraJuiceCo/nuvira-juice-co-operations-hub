import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    // Authenticate using Bearer token
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return Response.json({ error: 'Missing or invalid Authorization header' }, { status: 401 });
    }

    const token = authHeader.slice(7);
    if (token !== SYNC_SECRET) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
     const url = new URL(req.url);
     const statusFilter = url.searchParams.get('status');
     const sinceFilter = url.searchParams.get('since');

    // Fetch all ShopifyOrder records
    const orders = await base44.asServiceRole.entities.ShopifyOrder.list('-updated_date', 500);

    // Filter and transform
    const filtered = orders
      .filter(order => {
        // Filter by status if provided
        if (statusFilter && order.production_status !== statusFilter) {
          return false;
        }

        // Filter by since date if provided
        if (sinceFilter) {
          const orderUpdated = new Date(order.updated_date || order.created_date);
          const sinceDate = new Date(sinceFilter);
          if (orderUpdated < sinceDate) {
            return false;
          }
        }

        return true;
      })
      .map(order => ({
        id: order.id,
        order_number: order.shopify_order_number,
        customer_email: order.customer_email,
        contact_email: order.customer_email, // also expose as contact_email for Apple Sign In user matching
        status: order.production_status,
        total: order.total_price,
        fulfillment_type: order.fulfillment_method,
        estimated_delivery_date: order.assigned_delivery_date,
        updated_date: order.updated_date,
      }));

    console.log(`[GET-ORDER-UPDATES] Returning ${filtered.length} order updates (status: ${statusFilter || 'all'}, since: ${sinceFilter || 'all'})`);

    return Response.json({ orders: filtered });
  } catch (error) {
    console.error('[GET-ORDER-UPDATES] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});