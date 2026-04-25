import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY'), { apiVersion: '2023-10-16' });

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const { subscriptionId, orderNumber } = await req.json();

    if (!subscriptionId) {
      return Response.json({ error: 'subscriptionId required' }, { status: 400 });
    }

    // Fetch subscription and customer from Stripe
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, { 
      expand: ['customer', 'latest_invoice'] 
    });

    if (!subscription) {
      return Response.json({ error: 'Subscription not found in Stripe' }, { status: 404 });
    }

    const customer = typeof subscription.customer === 'object' ? subscription.customer : null;
    
    if (!customer) {
      return Response.json({ error: 'Customer not found in subscription' }, { status: 404 });
    }

    // Extract address from customer or shipping info
    const address = customer.address || customer.shipping?.address || {};
    
    if (!address.line1) {
      return Response.json({ error: 'No address found in Stripe subscription' }, { status: 400 });
    }

    // Find order by order number or subscription ID
    let order = null;
    
    if (orderNumber) {
      const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({
        shopify_order_number: orderNumber,
      });
      if (orders && orders.length > 0) {
        order = orders[0];
      }
    }

    if (!order) {
      const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({
        stripe_subscription_id: subscriptionId,
      });
      if (orders && orders.length > 0) {
        order = orders[0];
      }
    }

    if (!order) {
      return Response.json({ error: 'Order not found' }, { status: 404 });
    }

    // Update order with recovered address and ensure delivery fulfillment
    const updateData = {
      address_line1: address.line1 || '',
      address_line2: address.line2 || '',
      address_city: address.city || '',
      address_state: address.state || '',
      address_postal_code: address.postal_code || '',
      address_country: address.country || 'US',
      address_last_synced_from: 'stripe_subscription',
      address_last_synced_at: new Date().toISOString(),
      fulfillment_method: 'delivery', // Ensure it's delivery, not shipping
      sync_status: 'synced',
    };

    // Update through safe gateway
    const result = await base44.functions.invoke('upsertOrderSafely', {
      orderId: order.id,
      incomingData: updateData,
      source: 'manual_recovery',
      userEmail: user.email,
    });

    return Response.json({
      status: 'success',
      message: 'Address recovered and order updated to delivery fulfillment',
      orderId: order.id,
      orderNumber: order.shopify_order_number,
      address: {
        line1: address.line1,
        city: address.city,
        state: address.state,
        postal_code: address.postal_code,
      },
      result,
    });
  } catch (error) {
    console.error('[RECOVER-ADDRESS] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});