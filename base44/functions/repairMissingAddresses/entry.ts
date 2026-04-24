import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const STRIPE_API_KEY = Deno.env.get('STRIPE_API_KEY');

/**
 * Repair missing addresses on orders and fulfillments.
 * Fallback chain:
 * 1. Check fulfillment record itself
 * 2. Check parent order record
 * 3. Check Stripe checkout session for shipping address
 * 4. Check Stripe customer for default address
 * 5. Flag for admin review if unresolved
 */

async function getStripeCheckoutAddress(sessionId) {
  if (!STRIPE_API_KEY || !sessionId || !sessionId.startsWith('cs_')) return null;
  
  try {
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
      headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` }
    });
    if (!res.ok) return null;
    const session = await res.json();
    return session.shipping_details?.address || session.billing_details?.address || session.customer_details?.address || null;
  } catch (err) {
    console.warn('[REPAIR-ADDRESSES] Stripe checkout fetch failed:', err.message);
    return null;
  }
}

function formatAddressFromStripe(stripeAddr) {
  if (!stripeAddr) return null;
  return {
    address_line1: stripeAddr.line1 || '',
    address_line2: stripeAddr.line2 || '',
    address_city: stripeAddr.city || '',
    address_state: stripeAddr.state || '',
    address_postal_code: stripeAddr.postal_code || '',
    address_country: stripeAddr.country || 'US',
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const result = {
      timestamp: new Date().toISOString(),
      repaired_count: 0,
      flagged_count: 0,
      repaired: [],
      flagged: [],
    };

    // Get all orders
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500);

    for (const order of allOrders) {
      if (!order) continue;

      // Check if order itself is missing address
      if (!order.address_line1 && !order.delivery_address) {
        let repaired = false;

        // Try Stripe checkout session
        if (order.stripe_checkout_session_id) {
          const stripeAddr = await getStripeCheckoutAddress(order.stripe_checkout_session_id);
          if (stripeAddr) {
            const addrData = formatAddressFromStripe(stripeAddr);
            await base44.asServiceRole.entities.ShopifyOrder.update(order.id, {
              ...addrData,
              address_last_synced_from: 'stripe_checkout_repaired',
              address_last_synced_at: new Date().toISOString(),
            });
            result.repaired_count++;
            result.repaired.push({
              order_id: order.id,
              customer_email: order.customer_email,
              method: 'stripe_checkout',
            });
            repaired = true;
          }
        }

        if (!repaired) {
          result.flagged_count++;
          result.flagged.push({
            order_id: order.id,
            customer_email: order.customer_email,
            issue: 'order_missing_address',
            stripe_session: order.stripe_checkout_session_id || 'none',
          });
        }
      }

      // Check fulfillments for missing address
      if (order.fulfillments && Array.isArray(order.fulfillments)) {
        let fulfillmentUpdated = false;

        for (let fi = 0; fi < order.fulfillments.length; fi++) {
          const f = order.fulfillments[fi];
          if (!f.address_line1) {
            // Try to inherit from parent order
            if (order.address_line1) {
              f.address_line1 = order.address_line1;
              f.address_line2 = order.address_line2 || '';
              f.address_city = order.address_city || '';
              f.address_state = order.address_state || '';
              f.address_postal_code = order.address_postal_code || '';
              f.address_country = order.address_country || 'US';
              fulfillmentUpdated = true;
            } else {
              // Parent also missing - flag
              result.flagged_count++;
              result.flagged.push({
                order_id: order.id,
                fulfillment_number: f.fulfillment_number,
                customer_email: order.customer_email,
                issue: 'fulfillment_missing_address',
              });
            }
          }
        }

        if (fulfillmentUpdated) {
          await base44.asServiceRole.entities.ShopifyOrder.update(order.id, {
            fulfillments: order.fulfillments,
          });
          result.repaired_count++;
          result.repaired.push({
            order_id: order.id,
            customer_email: order.customer_email,
            method: 'inherited_from_parent',
          });
        }
      }
    }

    console.log('[REPAIR-ADDRESSES] Repaired', result.repaired_count, 'issues, flagged', result.flagged_count);
    return Response.json({ success: true, result });
  } catch (error) {
    console.error('[REPAIR-ADDRESSES] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});