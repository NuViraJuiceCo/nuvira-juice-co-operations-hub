import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY'), { apiVersion: '2023-10-16' });

/**
 * STRIPE SUBSCRIPTION RECOVERY WITH SUBSCRIPTION DETECTION
 * 
 * Fixes the critical gap where manual recovery would restore subscription orders as one-time.
 * 
 * Key improvements:
 * 1. Detects if the checkout session was created in subscription mode
 * 2. Queries for associated subscription if not already linked
 * 3. Restores all subscription metadata
 * 4. Re-runs subscription decomposition
 * 5. Marks recovered subscriptions properly
 */

async function detectSubscriptionFromCheckout(checkoutSessionId) {
  if (!checkoutSessionId) return null;
  
  try {
    const session = await stripe.checkout.sessions.retrieve(checkoutSessionId, {
      expand: ['subscription', 'customer'],
    });
    
    // If checkout mode is subscription, return the subscription ID
    if (session.mode === 'subscription') {
      return session.subscription?.id || null;
    }
    
    // If checkout has subscription object, return it
    if (session.subscription?.id) {
      return session.subscription.id;
    }
  } catch (err) {
    console.log(`[RECOVERY] Could not detect subscription from checkout: ${err.message}`);
  }
  
  return null;
}

async function getSubscriptionData(subscriptionId) {
  if (!subscriptionId) return null;
  
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['customer', 'latest_invoice'],
    });
    return sub;
  } catch (err) {
    console.log(`[RECOVERY] Could not fetch subscription ${subscriptionId}: ${err.message}`);
  }
  
  return null;
}

async function triggerDecomposition(base44, orderId) {
  try {
    const order = await base44.asServiceRole.entities.ShopifyOrder.get('ShopifyOrder', orderId);
    if (!order) return false;
    
    // Call the production batch recalc function to decompose this order
    const result = await base44.asServiceRole.functions.invoke('recalculateProductionBatches', {});
    console.log(`[RECOVERY] Triggered production batch recalculation for subscription order ${orderId}`);
    return true;
  } catch (err) {
    console.warn(`[RECOVERY] Failed to trigger decomposition: ${err.message}`);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const body = await req.json();
    const { checkout_session_id, order_id, customer_email } = body;

    if (!checkout_session_id) {
      return Response.json({ error: 'checkout_session_id required' }, { status: 400 });
    }

    // Find order by checkout session ID or order ID
    let order = null;
    if (order_id) {
      const orders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 1000);
      order = orders.find(o => o.id === order_id);
    } else if (checkout_session_id) {
      const orders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 1000);
      order = orders.find(o => o.stripe_checkout_session_id === checkout_session_id);
    }

    if (!order) {
      return Response.json({ error: 'Order not found' }, { status: 404 });
    }

    console.log(`[RECOVERY] Starting subscription recovery for order ${order.id} (${order.shopify_order_number})`);

    const recoveryLog = {
      order_id: order.id,
      order_number: order.shopify_order_number,
      customer_email: order.customer_email,
      steps: [],
      final_state: {},
      success: false,
    };

    // STEP 1: Detect if this was a subscription checkout
    let subscriptionId = order.stripe_subscription_id;
    if (!subscriptionId) {
      subscriptionId = await detectSubscriptionFromCheckout(checkout_session_id);
      if (subscriptionId) {
        recoveryLog.steps.push('detected_subscription_from_checkout_mode');
        console.log(`[RECOVERY] Detected subscription ${subscriptionId} from checkout session`);
      }
    }

    // STEP 2: If we found a subscription, fetch its full data
    let subscriptionData = null;
    if (subscriptionId) {
      subscriptionData = await getSubscriptionData(subscriptionId);
      if (subscriptionData) {
        recoveryLog.steps.push('fetched_subscription_data');
        console.log(`[RECOVERY] Fetched subscription data for ${subscriptionId}`);
      }
    }

    // STEP 3: Fetch checkout session details
    let checkoutSession = null;
    try {
      checkoutSession = await stripe.checkout.sessions.retrieve(checkout_session_id, {
        expand: ['customer', 'line_items'],
      });
      recoveryLog.steps.push('fetched_checkout_session');
    } catch (err) {
      console.warn(`[RECOVERY] Could not fetch checkout session: ${err.message}`);
    }

    // STEP 4: Extract fresh data from Stripe objects
    let freshData = {
      customer_name: null,
      customer_email: order.customer_email,
      line_items: [],
      total_price: 0,
      payment_status: 'pending',
    };

    if (checkoutSession) {
      freshData.customer_name = checkoutSession.shipping_details?.name || checkoutSession.customer_details?.name;
      freshData.customer_email = checkoutSession.customer_email || checkoutSession.customer_details?.email;
      freshData.total_price = (checkoutSession.amount_total || 0) / 100;
      freshData.payment_status = checkoutSession.payment_status;

      // Get line items from checkout session
      if (checkoutSession.line_items) {
        freshData.line_items = checkoutSession.line_items.data.map(item => ({
          title: item.description || item.product?.name || 'Item',
          quantity: item.quantity,
          price: (item.amount_total || 0) / 100,
        }));
      }
    }

    // If we have subscription data, get line items from latest invoice
    if (subscriptionData && subscriptionData.latest_invoice && freshData.line_items.length === 0) {
      const invoice = typeof subscriptionData.latest_invoice === 'object'
        ? subscriptionData.latest_invoice
        : await stripe.invoices.retrieve(subscriptionData.latest_invoice);

      if (invoice?.lines?.data) {
        freshData.line_items = invoice.lines.data.map(l => ({
          title: l.description || l.plan?.nickname || 'Item',
          quantity: l.quantity || 1,
          price: (l.amount || 0) / 100,
        }));
      }

      freshData.total_price = freshData.total_price || (invoice.total || 0) / 100;
      recoveryLog.steps.push('extracted_line_items_from_invoice');
    }

    // STEP 5: Build recovery payload
    const recoveryPayload = {
      customer_name: freshData.customer_name || order.customer_name,
      customer_email: freshData.customer_email,
      line_items: freshData.line_items.length > 0 ? freshData.line_items : order.line_items,
      total_price: freshData.total_price || order.total_price,
      subtotal: freshData.total_price || order.subtotal,
      payment_status: freshData.payment_status,
      sync_status: 'synced',
      repair_status: 'recovered_from_stripe',
      repair_timestamp: new Date().toISOString(),
      last_reconciliation_at: new Date().toISOString(),
      // CRITICAL: Set source_channel and metadata based on subscription detection
      source_channel: subscriptionId ? 'subscription' : order.source_channel,
      stripe_subscription_id: subscriptionId || order.stripe_subscription_id,
      source_type: subscriptionId ? 'stripe_subscription' : order.source_type,
    };

    // Preserve fulfillments if they exist
    if (order.fulfillments && order.fulfillments.length > 0) {
      recoveryPayload.fulfillments = order.fulfillments;
    }

    console.log(`[RECOVERY] Applying recovery payload: source_channel=${recoveryPayload.source_channel}, subscription_id=${subscriptionId}`);

    // STEP 6: Apply recovery
    await base44.asServiceRole.entities.ShopifyOrder.update(order.id, recoveryPayload);
    recoveryLog.steps.push('updated_order_with_recovery_data');
    recoveryLog.success = true;
    recoveryLog.final_state = recoveryPayload;

    // STEP 7: If subscription, trigger decomposition
    if (subscriptionId && !order.fulfillments?.length) {
      const decomposed = await triggerDecomposition(base44, order.id);
      if (decomposed) {
        recoveryLog.steps.push('triggered_subscription_decomposition');
      }
    }

    console.log(`[RECOVERY] Successfully recovered subscription order ${order.id}:`, recoveryLog.steps.join(' → '));

    return Response.json({
      status: 'success',
      message: `Recovered subscription order ${order.shopify_order_number}`,
      recovery_log: recoveryLog,
    });
  } catch (error) {
    console.error('[RECOVERY] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});