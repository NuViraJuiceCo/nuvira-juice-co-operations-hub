import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * receiveCustomerAppEvent — Hub inbound endpoint for customer app push events
 *
 * Accepts events pushed by the customer app's syncCustomerToHub function.
 * This is the canonical HUB_API_URL target for all customer-side push events.
 *
 * Auth: Authorization: Bearer <CUSTOMER_APP_SYNC_SECRET>
 *
 * Supported event types:
 *   customer.profile_updated      — update customer name/phone on existing orders
 *   customer.bag_return           — create/update BagReturn record
 *   customer.onboarding_complete  — no-op, acknowledged
 *   customer.subscription_created — trigger order pull for this customer
 *   order.status_updated          — acknowledged (hub owns status, not customer app)
 */

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  // Authenticate
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token || token !== SYNC_SECRET) {
    console.warn('[RECEIVE-CUSTOMER-EVENT] Unauthorized request — invalid or missing Bearer token');
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { event, data } = body;

    if (!event) {
      return Response.json({ error: 'Missing event type' }, { status: 400 });
    }

    console.log(`[RECEIVE-CUSTOMER-EVENT] event=${event}, email=${data?.customer_email || 'unknown'}`);

    // ── customer.profile_updated ──────────────────────────────────────────────
    if (event === 'customer.profile_updated') {
      if (!data?.customer_email) {
        return Response.json({ error: 'Missing customer_email' }, { status: 400 });
      }
      // Update customer name/phone on any existing orders for this email
      const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({ customer_email: data.customer_email });
      let updated = 0;
      for (const order of (orders || [])) {
        const patch = {};
        if (data.customer_name && !order.customer_name) patch.customer_name = data.customer_name;
        if (data.customer_phone && !order.customer_phone) patch.customer_phone = data.customer_phone;
        if (Object.keys(patch).length > 0) {
          await base44.asServiceRole.entities.ShopifyOrder.update(order.id, patch);
          updated++;
        }
      }
      return Response.json({ status: 'success', event, updated_orders: updated });
    }

    // ── customer.bag_return ───────────────────────────────────────────────────
    if (event === 'customer.bag_return') {
      if (!data?.customer_email || !data?.order_id) {
        return Response.json({ error: 'Missing customer_email or order_id' }, { status: 400 });
      }
      const existing = await base44.asServiceRole.entities.BagReturn.filter({
        order_id: data.order_id,
        customer_email: data.customer_email,
      });
      const returnData = {
        order_id: data.order_id,
        customer_email: data.customer_email,
        small_bags_requested: data.small_bags_requested || 0,
        tote_bags_requested: data.tote_bags_requested || 0,
        verification_status: 'requested',
        sync_status: 'synced',
      };
      if (existing && existing.length > 0) {
        // Only update if still in requested state — don't overwrite driver verifications
        if (existing[0].verification_status === 'requested') {
          await base44.asServiceRole.entities.BagReturn.update(existing[0].id, returnData);
        }
        return Response.json({ status: 'success', event, action: 'updated' });
      } else {
        await base44.asServiceRole.entities.BagReturn.create(returnData);
        return Response.json({ status: 'success', event, action: 'created' });
      }
    }

    // ── customer.subscription_created ────────────────────────────────────────
    // Acknowledged — the 30-min scheduled pull will pick up the new subscription order
    if (event === 'customer.subscription_created') {
      console.log(`[RECEIVE-CUSTOMER-EVENT] Subscription created for ${data?.customer_email} — will be picked up on next scheduled pull`);
      return Response.json({ status: 'success', event, note: 'Order will sync on next scheduled pull (every 30 min)' });
    }

    // ── customer.onboarding_complete / order.status_updated / others ──────────
    // Acknowledge but no action — hub owns these states
    return Response.json({ status: 'acknowledged', event, note: 'Event received, no action required' });

  } catch (error) {
    console.error('[RECEIVE-CUSTOMER-EVENT] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});