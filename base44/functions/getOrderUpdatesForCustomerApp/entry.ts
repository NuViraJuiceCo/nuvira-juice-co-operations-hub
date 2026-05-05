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
    const emailFilter = url.searchParams.get('email');   // filter by customer email (prevents returning all customers)
    const statusFilter = url.searchParams.get('status');
    const sinceFilter = url.searchParams.get('since');

    // Fetch all ShopifyOrder records
    const orders = await base44.asServiceRole.entities.ShopifyOrder.list('-updated_date', 500);

    // Filter and transform
    const filtered = orders
      .filter(order => {
        // Filter by email if provided — prevents returning other customers' orders
        if (emailFilter) {
          const emailLower = emailFilter.toLowerCase();
          const matchesEmail = (order.customer_email || '').toLowerCase() === emailLower;
          const matchesContact = (order.contact_email || '').toLowerCase() === emailLower;
          if (!matchesEmail && !matchesContact) return false;
        }

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
        shopify_order_id: order.shopify_order_id,
        order_number: order.shopify_order_number,
        customer_email: order.customer_email,
        contact_email: order.customer_email, // also expose as contact_email for Apple Sign In user matching
        customer_app_user_id: order.customer_app_user_id || null,
        status: order.production_status,
        total: order.total_price,
        fulfillment_type: order.fulfillment_method,
        estimated_delivery_date: order.assigned_delivery_date,
        assigned_delivery_date: order.assigned_delivery_date || null,
        production_date: order.production_date || null,
        selected_delivery_date: order.selected_delivery_date || order.assigned_delivery_date || null,
        delivery_window_label: order.delivery_window_label || (order.assigned_delivery_date ? '5 PM – 8 PM' : null),
        updated_date: order.updated_date,
        line_items: order.line_items || [],
        fulfillments: order.fulfillments || [],
        source_channel: order.source_channel || null,
        stripe_subscription_id: order.stripe_subscription_id || null,
      }));

    console.log(`[GET-ORDER-UPDATES] Returning ${filtered.length} order updates (email: ${emailFilter || 'all'}, status: ${statusFilter || 'all'}, since: ${sinceFilter || 'all'})`);

    return Response.json({ orders: filtered });
  } catch (error) {
    console.error('[GET-ORDER-UPDATES] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});