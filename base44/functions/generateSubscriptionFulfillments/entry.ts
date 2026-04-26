import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const STRIPE_API_KEY = Deno.env.get('STRIPE_API_KEY');

async function getStripeObject(objectId, objectType) {
  if (!STRIPE_API_KEY) throw new Error('Stripe API key not configured');

  const endpoints = {
    'subscription': `/v1/subscriptions/${objectId}`,
    'customer': `/v1/customers/${objectId}`,
  };

  const endpoint = endpoints[objectType];
  if (!endpoint) throw new Error(`Unknown object type: ${objectType}`);

  const res = await fetch(`https://api.stripe.com${endpoint}`, {
    headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` },
  });

  if (!res.ok) {
    throw new Error(`Stripe API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

/**
 * GENERATE SUBSCRIPTION FULFILLMENTS
 * 
 * When a subscription is created, generate exactly 4 weekly delivery orders.
 * 
 * Subscription Plans:
 * - vip_wellness: 2 Oasis, 2 Aura, 2 Re-Nu per weekly delivery (6 bottles)
 * - monthly_ritual: 1 Oasis, 1 Aura, 1 Re-Nu per weekly delivery (3 bottles)
 * 
 * Output: 4 ShopifyOrder records with fulfillment dates 7 days apart.
 */

const PRODUCT_NAMES = {
  oasis: 'Oasis',
  aura: 'Aura',
  renu: 'Re-Nu',
};

const SUBSCRIPTION_PLANS = {
  vip_wellness: {
    display_name: 'VIP Wellness',
    products: [
      { name: PRODUCT_NAMES.oasis, qty: 2 },
      { name: PRODUCT_NAMES.aura, qty: 2 },
      { name: PRODUCT_NAMES.renu, qty: 2 },
    ],
    total_bottles_per_delivery: 6,
    deliveries: 4,
  },
  monthly_ritual: {
    display_name: 'Monthly Ritual',
    products: [
      { name: PRODUCT_NAMES.oasis, qty: 1 },
      { name: PRODUCT_NAMES.aura, qty: 1 },
      { name: PRODUCT_NAMES.renu, qty: 1 },
    ],
    total_bottles_per_delivery: 3,
    deliveries: 4,
  },
};

const PRODUCTION_DAYS = [2, 5, 6]; // Tue, Fri, Sat

function detectSubscriptionPlan(subscription) {
  // Look for plan name or metadata that indicates plan type
  if (subscription.metadata?.plan) {
    const plan = subscription.metadata.plan.toLowerCase();
    if (plan.includes('vip') || plan.includes('wellness')) return 'vip_wellness';
    if (plan.includes('ritual') || plan.includes('monthly')) return 'monthly_ritual';
  }
  
  // Fallback: check plan description or product names
  if (subscription.description) {
    const desc = subscription.description.toLowerCase();
    if (desc.includes('vip') || desc.includes('wellness')) return 'vip_wellness';
    if (desc.includes('ritual') || desc.includes('monthly')) return 'monthly_ritual';
  }

  // Default to vip_wellness if unclear
  return 'vip_wellness';
}

function getNextProductionDate(fromDate) {
  const d = new Date(fromDate);
  d.setHours(0, 0, 0, 0);
  
  for (let i = 1; i <= 14; i++) {
    const next = new Date(d);
    next.setDate(d.getDate() + i);
    if (PRODUCTION_DAYS.includes(next.getDay())) {
      return next.toISOString().split('T')[0];
    }
  }
  
  // Fallback: 3 days from now
  const fallback = new Date(d);
  fallback.setDate(d.getDate() + 3);
  return fallback.toISOString().split('T')[0];
}

async function generateSubscriptionFulfillments(base44, subscription, customer) {
  const planKey = detectSubscriptionPlan(subscription);
  const plan = SUBSCRIPTION_PLANS[planKey];
  const subscriptionId = subscription.id;
  const customerId = subscription.customer;
  const email = customer.email || 'unknown@stripe.local';
  const name = customer.name || 'Subscription Customer';
  
  // Get customer address from Stripe if available
  const address = customer.address || {
    line1: '',
    line2: '',
    city: '',
    state: '',
    postal_code: '',
    country: 'US',
  };

  // Calculate start date for first production
  const createdAt = new Date(subscription.created * 1000);
  const firstProductionDate = getNextProductionDate(createdAt);

  // Generate 4 weekly delivery orders
  const orders = [];
  for (let i = 0; i < plan.deliveries; i++) {
    // Calculate production date for this week
    const prodDate = new Date(firstProductionDate + 'T00:00:00');
    prodDate.setDate(prodDate.getDate() + 7 * i);
    const prodDateStr = prodDate.toISOString().split('T')[0];

    // Calculate delivery date (3 days after production for Tue/Fri, 1 day for Sat)
    const dayOfWeek = prodDate.getDay();
    const daysToAdd = dayOfWeek === 5 ? 1 : (dayOfWeek === 6 ? 1 : 3);
    const delivDate = new Date(prodDate);
    delivDate.setDate(delivDate.getDate() + daysToAdd);
    const delivDateStr = delivDate.toISOString().split('T')[0];

    // Build line items for this delivery
    const lineItems = plan.products.map(prod => ({
      title: prod.name,
      quantity: prod.qty,
      price: 0, // Price will be allocated from total during order composition
    }));

    // Create fulfillment entry
    const fulfillments = [{
      fulfillment_number: i + 1,
      production_date: prodDateStr,
      delivery_date: delivDateStr,
      items: lineItems,
      status: 'pending',
      address_line1: address.line1 || '',
      address_line2: address.line2 || '',
      address_city: address.city || '',
      address_state: address.state || '',
      address_postal_code: address.postal_code || '',
      address_country: address.country || 'US',
      delivery_notes: `${plan.display_name} - Week ${i + 1} of 4`,
    }];

    // Estimate total price (will be matched from Stripe later)
    const weeklyPrice = subscription.items?.data?.[0]?.price?.unit_amount
      ? (subscription.items.data[0].price.unit_amount / 100) / plan.deliveries
      : 0;

    // Create order payload
    const orderPayload = {
      shopify_order_id: `${subscriptionId}-delivery-${i + 1}`,
      shopify_order_number: `#SUB-${subscriptionId.slice(-8).toUpperCase()}-W${i + 1}`,
      customer_email: email,
      customer_name: name,
      customer_phone: customer.phone || '',
      line_items: lineItems,
      fulfillments: fulfillments,
      total_price: weeklyPrice,
      subtotal: weeklyPrice,
      payment_status: 'paid', // Subscription is pre-paid
      source_channel: 'subscription',
      fulfillment_method: 'delivery',
      production_status: 'new',
      sync_status: 'synced',
      last_sync_at: new Date().toISOString(),
      customer_order_date: createdAt.toISOString(),
      
      // Stripe linkage
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      stripe_event_id_applied: null,
      stripe_created_event_type: 'customer.subscription.created',
      last_reconciliation_at: new Date().toISOString(),
      source_type: 'stripe_subscription',
      
      // Address
      address_line1: address.line1 || '',
      address_line2: address.line2 || '',
      address_city: address.city || '',
      address_state: address.state || '',
      address_postal_code: address.postal_code || '',
      address_country: address.country || 'US',
      address_last_synced_from: 'stripe',
      address_last_synced_at: new Date().toISOString(),
      
      // Metadata
      subscription_parent_id: subscriptionId,
      fulfillment_instance_date: delivDateStr,
      fulfillment_sequence_number: i + 1,
      data_quality_status: 'complete',
      order_lock_status: 'unlocked',
      repair_status: 'none',
    };

    orders.push(orderPayload);
  }

  return orders;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { subscription_id } = body;

    if (!subscription_id) {
      return Response.json({ error: 'subscription_id required' }, { status: 400 });
    }

    // Fetch subscription and customer from Stripe
    const subscription = await getStripeObject(subscription_id, 'subscription');
    const customer = await getStripeObject(subscription.customer, 'customer');

    // Generate 4 weekly order payloads
    const orderPayloads = await generateSubscriptionFulfillments(base44, subscription, customer);

    // Write each order via safeSyncOrderUpdate to ensure field ownership compliance
    const createdOrders = [];
    for (const payload of orderPayloads) {
      try {
        // Route through safeSyncOrderUpdate for field ownership and lock enforcement
        const syncResult = await base44.asServiceRole.functions.invoke('safeSyncOrderUpdate', {
          incomingData: payload,
          source: 'stripe_webhook',
          matchBy: { stripe_subscription_id: subscription_id },
        });

        const orderId = syncResult?.data?.order_id;
        if (!orderId) {
          console.error(`[GEN-SUB-FULFILLMENTS] safeSyncOrderUpdate failed for sequence ${payload.fulfillment_sequence_number}:`, syncResult?.data?.reason);
          continue;
        }

        createdOrders.push({
          order_id: orderId,
          sequence: payload.fulfillment_sequence_number,
          delivery_date: payload.fulfillments[0].delivery_date,
        });
        console.log(`[GEN-SUB-FULFILLMENTS] Order ${payload.fulfillment_sequence_number} created: ${orderId}`);
      } catch (err) {
        console.error(`[GEN-SUB-FULFILLMENTS] Failed to create order sequence ${payload.fulfillment_sequence_number}:`, err.message);
      }
    }

    // STEP 2: Create FulfillmentTasks for Driver Portal
    let tasksCreated = 0;
    try {
      const taskResult = await base44.asServiceRole.functions.invoke('createFulfillmentTasks', {
        stripe_subscription_id: subscription_id,
      });
      tasksCreated = taskResult?.data?.tasks_created || 0;
    } catch (err) {
      console.warn('[GEN-SUB-FULFILLMENTS] FulfillmentTask creation failed:', err.message);
    }

    // STEP 3: Create ProductionBatch records for Production Planning
    let batchesCreated = 0;
    try {
      const batchResult = await base44.asServiceRole.functions.invoke('createProductionBatch', {
        stripe_subscription_id: subscription_id,
      });
      batchesCreated = batchResult?.data?.batches_created || 0;
    } catch (err) {
      console.warn('[GEN-SUB-FULFILLMENTS] ProductionBatch creation failed:', err.message);
    }

    return Response.json({
      success: true,
      subscription_id,
      plan: detectSubscriptionPlan(subscription),
      orders_created: createdOrders.length,
      orders: createdOrders,
      fulfillment_tasks_created: tasksCreated,
      production_batches_created: batchesCreated,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[GEN-SUB-FULFILLMENTS]', error.message, error.stack);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});