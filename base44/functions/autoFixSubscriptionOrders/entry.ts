import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Auto-detect and fix orders that should be subscriptions but came in as 'online'.
 * Runs on a schedule to catch miscategorized orders before they break batch planning.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch all Stripe events to detect subscription patterns
    const stripeEvents = await base44.asServiceRole.entities.StripeEventLog.list('-created_date', 200);
    
    // Collect subscription IDs from Stripe events
    const subscriptionIds = new Set();
    for (const event of stripeEvents) {
      if (event.raw_event?.subscription) {
        subscriptionIds.add(event.raw_event.subscription);
      }
    }

    // Fetch all orders
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500);
    
    const fixes = [];

    for (const order of allOrders) {
      if (!order) continue;

      // Check if order should be subscription but isn't marked as such
      let shouldBeSubscription = false;
      let reason = '';

      // Pattern 1: Has a Stripe subscription ID
      if (order.stripe_subscription_id) {
        shouldBeSubscription = true;
        reason = 'has_stripe_subscription_id';
      }
      // Pattern 2: Customer notes mention weeks/months
      else if (order.customer_notes && /(\d+)\s*(week|month|time)/i.test(order.customer_notes)) {
        shouldBeSubscription = true;
        reason = 'customer_notes_mention_recurrence';
      }
      // Pattern 3: Bundle is marked as recurring (fulfillment_count > 1)
      else if (order.line_items && order.line_items.length > 0) {
        const bundleNames = new Set(order.line_items.map(li => li.title?.trim()).filter(Boolean));
        
        // Check if any line item is a known recurring bundle
        try {
          const bundles = await base44.asServiceRole.entities.Bundle.list('-updated_date', 100);
          for (const bundle of bundles) {
            if (bundle.fulfillment_count && bundle.fulfillment_count > 1 && bundleNames.has(bundle.bundle_name)) {
              shouldBeSubscription = true;
              reason = 'bundle_is_recurring';
              break;
            }
          }
        } catch (err) {
          // Skip bundle check if it fails
        }
      }

      // If order should be subscription but isn't marked as such, fix it
      if (shouldBeSubscription && order.source_channel !== 'subscription') {
        const updateData = {
          source_channel: 'subscription',
        };

        // If no customer notes and reason suggests we should have them, add default
        if (!order.customer_notes && (reason === 'bundle_is_recurring' || reason === 'has_stripe_subscription_id')) {
          updateData.customer_notes = '4 weeks'; // default assumption for bundles
        }

        await base44.asServiceRole.entities.ShopifyOrder.update(order.id, updateData);
        fixes.push({
          order_id: order.id,
          order_number: order.shopify_order_number,
          customer_email: order.customer_email,
          reason,
        });
      }
    }

    // If we fixed any orders, trigger batch recalculation
    if (fixes.length > 0) {
      try {
        await base44.asServiceRole.functions.invoke('recalculateProductionBatches', {});
      } catch (err) {
        console.warn('[AUTO-FIX] Failed to trigger batch recalculation:', err.message);
      }
    }

    return Response.json({
      success: true,
      fixed_count: fixes.length,
      fixes,
      message: `Auto-fixed ${fixes.length} subscription order(s)`,
    });
  } catch (error) {
    console.error('[AUTO-FIX-SUB]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});