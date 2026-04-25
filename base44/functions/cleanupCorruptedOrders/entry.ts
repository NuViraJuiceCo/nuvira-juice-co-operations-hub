import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY'), { apiVersion: '2023-10-16' });

/**
 * CLEANUP CORRUPTED ORDERS
 * 
 * One-time admin cleanup to:
 * 1. Find all #unknown orders with Stripe linkage
 * 2. Identify if they should be subscriptions
 * 3. Either restore them or quarantine them
 * 4. Delete duplicate #unknown shells
 */

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

    const results = {
      corrupted_found: 0,
      subscriptions_detected: 0,
      recovered: 0,
      quarantined: 0,
      duplicates_removed: 0,
      errors: [],
    };

    // Find all #unknown orders
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 1000);
    const unknownOrders = allOrders.filter(o => 
      o.shopify_order_number === '#unknown' || 
      o.shopify_order_number === '#UNKNOWN' ||
      (o.shopify_order_id && o.shopify_order_id.includes('unknown'))
    );

    results.corrupted_found = unknownOrders.length;
    console.log(`[CLEANUP] Found ${unknownOrders.length} corrupted #unknown orders`);

    // Track duplicates by customer email
    const emailToOrders = new Map();
    for (const ord of unknownOrders) {
      const email = ord.customer_email || 'unknown';
      if (!emailToOrders.has(email)) {
        emailToOrders.set(email, []);
      }
      emailToOrders.get(email).push(ord);
    }

    // Process each unknown order
    for (const ord of unknownOrders) {
      try {
        // Check if this order has Stripe linkage
        if (!ord.stripe_checkout_session_id && !ord.stripe_subscription_id && !ord.stripe_payment_intent_id) {
          // No Stripe linkage, can't recover
          console.log(`[CLEANUP] Skipping #unknown without Stripe linkage: ${ord.id}`);
          continue;
        }

        // Try to detect if it was a subscription
        let isSubscription = false;
        if (ord.stripe_checkout_session_id) {
          try {
            const session = await stripe.checkout.sessions.retrieve(ord.stripe_checkout_session_id, {
              expand: ['subscription'],
            });
            isSubscription = session.mode === 'subscription' || !!session.subscription?.id;
            if (isSubscription && !ord.stripe_subscription_id) {
              ord.stripe_subscription_id = session.subscription?.id;
            }
          } catch (err) {
            console.warn(`[CLEANUP] Could not fetch checkout session: ${err.message}`);
          }
        }

        // If subscription, try to recover it
        if (isSubscription || ord.stripe_subscription_id) {
          results.subscriptions_detected++;
          
          // Attempt recovery
          const recoveryPayload = {
            source_channel: 'subscription',
            source_type: 'stripe_subscription',
            stripe_subscription_id: ord.stripe_subscription_id,
            sync_status: 'synced',
            repair_status: 'cleanup_recovery',
            repair_timestamp: new Date().toISOString(),
          };

          // Try to get fresh data from Stripe
          if (ord.stripe_checkout_session_id) {
            try {
              const session = await stripe.checkout.sessions.retrieve(ord.stripe_checkout_session_id, {
                expand: ['customer', 'line_items'],
              });
              if (session.customer_details?.name) {
                recoveryPayload.customer_name = session.customer_details.name;
              }
              if (session.customer_email) {
                recoveryPayload.customer_email = session.customer_email;
              }
              if (session.amount_total > 0) {
                recoveryPayload.total_price = session.amount_total / 100;
              }
              if (session.line_items?.data) {
                recoveryPayload.line_items = session.line_items.data.map(item => ({
                  title: item.description || item.product?.name || 'Item',
                  quantity: item.quantity,
                  price: (item.amount_total || 0) / 100,
                }));
              }
            } catch (err) {
              console.warn(`[CLEANUP] Could not fetch checkout details: ${err.message}`);
            }
          }

          await base44.asServiceRole.entities.ShopifyOrder.update(ord.id, recoveryPayload);
          results.recovered++;
          console.log(`[CLEANUP] Recovered subscription order ${ord.id}`);
        } else {
          // One-time order with partial data, quarantine it
          await base44.asServiceRole.entities.OrderReviewQueue.create({
            incident_type: 'unknown_order_attempt',
            customer_email: ord.customer_email || null,
            customer_name: ord.customer_name || null,
            existing_order_id: ord.id,
            existing_order_number: '#unknown',
            existing_order_type: 'one_time',
            incoming_source: 'cleanup_recovery',
            issue_description: `Corrupted #unknown order found during cleanup. Had Stripe linkage but unclear if subscription. Manual review required.`,
            recommended_action: 'manual_review',
            status: 'pending',
          });
          results.quarantined++;
          console.log(`[CLEANUP] Quarantined corrupted order ${ord.id}`);
        }
      } catch (err) {
        results.errors.push({ order_id: ord.id, error: err.message });
        console.error(`[CLEANUP] Error processing ${ord.id}: ${err.message}`);
      }
    }

    // Remove duplicate #unknown orders (keep one per customer email)
    for (const [email, orders] of emailToOrders) {
      if (orders.length > 1) {
        const sorted = orders.sort((a, b) => new Date(b.updated_date) - new Date(a.updated_date));
        // Keep newest, delete rest
        for (let i = 1; i < sorted.length; i++) {
          await base44.asServiceRole.entities.ShopifyOrder.delete(sorted[i].id);
          results.duplicates_removed++;
          console.log(`[CLEANUP] Deleted duplicate #unknown for ${email}`);
        }
      }
    }

    console.log(`[CLEANUP] Cleanup complete:`, results);
    return Response.json({ status: 'success', results });
  } catch (error) {
    console.error('[CLEANUP] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});