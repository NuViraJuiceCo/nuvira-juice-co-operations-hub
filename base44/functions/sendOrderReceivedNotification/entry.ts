import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();

    const shopifyOrder = payload.data;
    if (!shopifyOrder || !shopifyOrder.customer_email || shopifyOrder.customer_email.trim() === '') {
      return Response.json({ message: 'No valid customer email, skipping notification' });
    }

    // Only send notifications for orders created within the last 10 minutes
    // This prevents confirmation emails firing for sync-imported or repaired orders
    const orderCreatedAt = new Date(shopifyOrder.created_date || shopifyOrder.customer_order_date || 0).getTime();
    const ageMinutes = (Date.now() - orderCreatedAt) / 60000;
    if (ageMinutes > 10) {
      console.log(`[NOTIFY] Skipping — order is ${Math.round(ageMinutes)} min old (not a fresh order)`);
      return Response.json({ message: 'Skipped — order too old to be a fresh purchase' });
    }

    if (!CUSTOMER_APP_API) {
      console.warn('[NOTIFY] Customer app API not configured, skipping notification');
      return Response.json({ message: 'Customer app API not configured' });
    }

    const products = shopifyOrder.line_items?.map(item => `${item.quantity}x ${item.title}`).join(', ') || 'Order';
    const productsSummary = shopifyOrder.line_items?.filter(item => !['delivery fee','delivery charge','shipping fee','shipping charge','tip','service fee'].some(kw => (item.title||'').toLowerCase().includes(kw))).map(item => `${item.quantity}x ${item.title}`).join('\n') || '';

    // Trigger the Customer App to send the confirmation SMS to its own registered user
    const response = await fetch(`${CUSTOMER_APP_API}/functions/sendOrderConfirmation`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SYNC_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customer_email: shopifyOrder.customer_email,
        order_number: shopifyOrder.shopify_order_number,
        products,
        products_summary: productsSummary,
        total_price: shopifyOrder.total_price || 0,
        assigned_delivery_date: shopifyOrder.assigned_delivery_date || 'TBD',
        company_name: 'NuVira Juice Co.',
      }),
    });

    if (response.ok) {
      console.log(`[NOTIFY] Order confirmation triggered for ${shopifyOrder.customer_email}`);
      return Response.json({ success: true, notified: shopifyOrder.customer_email });
    } else {
      const text = await response.text();
      console.error(`[NOTIFY] Customer app notification failed: ${response.status} - ${text}`);
      return Response.json({ success: false, reason: `Customer app error: ${response.status}` });
    }
  } catch (error) {
    console.error('sendOrderReceivedNotification error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});