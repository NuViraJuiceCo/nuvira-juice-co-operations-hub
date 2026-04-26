import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const STRIPE_API_KEY = Deno.env.get('STRIPE_API_KEY');
const stripe = new Stripe(STRIPE_API_KEY, { apiVersion: '2023-10-16' });

/**
 * COMPREHENSIVE DATA REPAIR — ONE-TIME CLEANUP
 * 
 * Repairs all broken order data from correct source of truth:
 * - Stripe IDs and payment data
 * - Delivery addresses from Customer App / Stripe
 * - Zero-priced subscription line items
 * - UNKNOWN orders
 * - Missing customer fields
 * - Order Review Queue items
 * 
 * CRITICAL: Routes all writes through safeSyncOrderUpdate gateway
 * CRITICAL: Non-destructive — never overwrites valid data with blanks
 * CRITICAL: Does not create new syncs or automations
 */

async function getStripeCustomer(customerId) {
  if (!customerId || !STRIPE_API_KEY) return null;
  try {
    return await stripe.customers.retrieve(customerId);
  } catch (e) {
    console.log(`[REPAIR] Could not fetch Stripe customer ${customerId}:`, e.message);
    return null;
  }
}

async function getStripeObject(objectId, objectType) {
  if (!objectId || !STRIPE_API_KEY) return null;
  try {
    const endpoints = {
      'checkout.session': `/v1/checkout/sessions/${objectId}`,
      'payment_intent': `/v1/payment_intents/${objectId}`,
      'invoice': `/v1/invoices/${objectId}`,
      'subscription': `/v1/subscriptions/${objectId}`,
    };
    const endpoint = endpoints[objectType];
    if (!endpoint) return null;

    const res = await fetch(`https://api.stripe.com${endpoint}`, {
      headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` },
    });
    return res.ok ? await res.json() : null;
  } catch (e) {
    console.log(`[REPAIR] Could not fetch Stripe ${objectType} ${objectId}:`, e.message);
    return null;
  }
}

async function repairOrder(base44, order) {
  const repairLog = {
    order_id: order.id,
    order_number: order.shopify_order_number,
    customer_email: order.customer_email,
    issues_found: [],
    repairs: [],
    result: 'success',
    error: null,
  };

  try {
    const repairPayload = {};
    let shouldRepair = false;

    // ISSUE 1: Missing Stripe customer ID
    if ((!order.stripe_customer_id || order.stripe_customer_id === '') && order.customer_email) {
      // Try to find via Stripe
      const stripeCustomer = await stripe.customers.search({
        query: `email:"${order.customer_email}"`,
      });
      if (stripeCustomer.data && stripeCustomer.data.length > 0) {
        repairPayload.stripe_customer_id = stripeCustomer.data[0].id;
        repairLog.repairs.push('stripe_customer_id');
        repairLog.issues_found.push('missing_stripe_customer_id');
        shouldRepair = true;
      }
    }

    // ISSUE 2: Missing Stripe payment intent ID
    if ((!order.stripe_payment_intent_id || order.stripe_payment_intent_id === '') && order.stripe_customer_id) {
      const customer = await getStripeCustomer(order.stripe_customer_id);
      if (customer && customer.default_source) {
        // Try to find recent payment intent for this customer
        const intents = await stripe.paymentIntents.list({
          customer: order.stripe_customer_id,
          limit: 5,
        });
        if (intents.data && intents.data.length > 0) {
          // Find closest match by amount and date
          const targetAmount = (order.total_price * 100);
          const closest = intents.data.reduce((best, current) => {
            const amountDiff = Math.abs(current.amount - targetAmount);
            const bestDiff = best ? Math.abs(best.amount - targetAmount) : Infinity;
            return amountDiff < bestDiff ? current : best;
          });
          if (closest) {
            repairPayload.stripe_payment_intent_id = closest.id;
            repairLog.repairs.push('stripe_payment_intent_id');
            repairLog.issues_found.push('missing_stripe_payment_intent_id');
            shouldRepair = true;
          }
        }
      }
    }

    // ISSUE 3: Missing address data in fulfillments
    if (order.fulfillments && order.fulfillments.length > 0) {
      const needsAddressRepair = order.fulfillments.some(f => 
        !f.address_line1 || f.address_line1 === ''
      );

      if (needsAddressRepair && order.address_line1) {
        // Copy from main order to fulfillments
        const repairedFulfillments = order.fulfillments.map(f => ({
          ...f,
          address_line1: f.address_line1 || order.address_line1,
          address_line2: f.address_line2 || order.address_line2,
          address_city: f.address_city || order.address_city,
          address_state: f.address_state || order.address_state,
          address_postal_code: f.address_postal_code || order.address_postal_code,
          address_country: f.address_country || order.address_country || 'US',
        }));
        repairPayload.fulfillments = repairedFulfillments;
        repairLog.repairs.push('fulfillment_addresses');
        repairLog.issues_found.push('missing_fulfillment_address');
        shouldRepair = true;
      } else if (needsAddressRepair && order.stripe_customer_id && !order.address_line1) {
        // Fetch from Stripe customer
        const stripeCustomer = await getStripeCustomer(order.stripe_customer_id);
        if (stripeCustomer && stripeCustomer.address) {
          const repairedFulfillments = order.fulfillments.map(f => ({
            ...f,
            address_line1: f.address_line1 || stripeCustomer.address.line1 || '',
            address_line2: f.address_line2 || stripeCustomer.address.line2 || '',
            address_city: f.address_city || stripeCustomer.address.city || '',
            address_state: f.address_state || stripeCustomer.address.state || '',
            address_postal_code: f.address_postal_code || stripeCustomer.address.postal_code || '',
            address_country: f.address_country || stripeCustomer.address.country || 'US',
          }));
          repairPayload.fulfillments = repairedFulfillments;
          repairLog.repairs.push('fulfillment_addresses_from_stripe');
          repairLog.issues_found.push('missing_fulfillment_address');
          shouldRepair = true;
        }
      }
    }

    // ISSUE 4: Zero-priced subscription line items (skipped if order is locked)
    // This repair is handled differently — zero prices on subscriptions are often internal allocations
    // Only repair if order is unlocked AND has price data
    const isLocked = ['verified', 'production_scheduled', 'in_production', 'out_for_delivery', 'fulfilled'].includes(order.order_lock_status);
    if (!isLocked && !order.order_lock_status && order.source_channel === 'subscription' && order.line_items && order.line_items.length > 0) {
      const hasZeroPrice = order.line_items.some(item => !item.price || item.price === 0);
      if (hasZeroPrice && order.total_price && order.total_price > 0) {
        // Calculate allocated price per bottle
        const totalBottles = order.line_items.reduce((sum, item) => sum + (item.quantity || 1), 0);
        const pricePerBottle = order.total_price / totalBottles;
        
        const repairedItems = order.line_items.map(item => ({
          ...item,
          price: item.price && item.price > 0 ? item.price : pricePerBottle,
        }));
        repairPayload.line_items = repairedItems;
        repairPayload.subscription_allocated_unit_price = pricePerBottle;
        repairPayload.subscription_allocated_delivery_value = order.total_price / (order.fulfillments?.length || 1);
        repairLog.repairs.push('zero_price_items');
        repairLog.issues_found.push('zero_priced_line_items');
        shouldRepair = true;
      }
    }

    // ISSUE 5: Missing customer phone
    if ((!order.customer_phone || order.customer_phone === '') && order.stripe_customer_id) {
      const stripeCustomer = await getStripeCustomer(order.stripe_customer_id);
      if (stripeCustomer && stripeCustomer.phone) {
        repairPayload.customer_phone = stripeCustomer.phone;
        repairLog.repairs.push('customer_phone');
        repairLog.issues_found.push('missing_customer_phone');
        shouldRepair = true;
      }
    }

    // ISSUE 6: UNKNOWN order number
    if ((order.shopify_order_number === '#unknown' || order.shopify_order_number === '#UNKNOWN') && 
        !order.shopify_order_number.startsWith('#STRIPE')) {
      if (order.stripe_payment_intent_id) {
        repairPayload.shopify_order_number = `#STRIPE-${order.stripe_payment_intent_id.slice(-8).toUpperCase()}`;
      } else if (order.stripe_subscription_id) {
        repairPayload.shopify_order_number = `#SUB-${order.stripe_subscription_id.slice(-8).toUpperCase()}`;
      } else {
        repairPayload.shopify_order_number = `#UNKNOWN-${order.id.slice(-6).toUpperCase()}`;
      }
      repairLog.repairs.push('order_number');
      repairLog.issues_found.push('unknown_order_number');
      shouldRepair = true;
    }

    // If no repairs needed
    if (!shouldRepair) {
      repairLog.result = 'no_repairs_needed';
      return repairLog;
    }

    // CRITICAL: Route through safeSyncOrderUpdate gateway
    const safeResult = await base44.asServiceRole.functions.invoke('safeSyncOrderUpdate', {
      incomingData: repairPayload,
      source: 'manual_recovery',
      matchBy: { internal_id: order.id },
    });

    if (safeResult?.data?.status === 'rejected') {
      repairLog.result = 'rejected_by_gateway';
      repairLog.error = safeResult.data.reason;
      console.warn(`[REPAIR] Gateway rejected repair for order ${order.id}: ${safeResult.data.reason}`);
    } else {
      repairLog.result = 'repaired_successfully';
      console.log(`[REPAIR] Repaired order ${order.id}: ${repairLog.repairs.join(', ')}`);
    }

    return repairLog;
  } catch (error) {
    repairLog.result = 'error';
    repairLog.error = error.message;
    console.error(`[REPAIR] Error repairing order ${order.id}:`, error.message);
    return repairLog;
  }
}

async function resolveReviewQueueItem(base44, item) {
  if (!item || !item.data) return null;

  const resolution = {
    queue_id: item.id,
    incident_type: item.data.incident_type,
    result: null,
    action: null,
  };

  try {
    // Auto-resolve safe categories
    if (!item.data.incident_type) {
      resolution.result = 'skipped_missing_type';
      return resolution;
    }

    if (item.data.incident_type === 'unknown_order_attempt') {
      if (!item.data.existing_order_id) {
        resolution.action = 'quarantine';
        resolution.result = 'cannot_resolve_automatically';
      } else {
        resolution.action = 'manual_review';
        resolution.result = 'marked_for_admin';
      }
    } else if (item.data.incident_type === 'subscription_downgrade_attempt') {
      resolution.action = 'reject';
      resolution.result = 'rejected_downgrade_attempt';
      // Update status to resolved
      await base44.asServiceRole.entities.OrderReviewQueue.update(item.id, {
        status: 'resolved',
        resolved_action: 'reject',
        resolved_at: new Date().toISOString(),
        admin_notes: 'Auto-rejected: subscription downgrade blocked by safeSyncOrderUpdate',
      });
    } else if (item.data.incident_type === 'duplicate_event') {
      resolution.action = 'deduplicate';
      resolution.result = 'deduplication_handled';
      await base44.asServiceRole.entities.OrderReviewQueue.update(item.id, {
        status: 'resolved',
        resolved_action: 'reject',
        resolved_at: new Date().toISOString(),
        admin_notes: 'Duplicate event handled by webhook idempotency',
      });
    } else if (item.data.incident_type === 'stale_update') {
      resolution.action = 'ignore';
      resolution.result = 'stale_update_ignored';
      await base44.asServiceRole.entities.OrderReviewQueue.update(item.id, {
        status: 'resolved',
        resolved_action: 'reject',
        resolved_at: new Date().toISOString(),
        admin_notes: 'Stale update ignored (order already verified)',
      });
    } else {
      resolution.action = 'manual_review';
      resolution.result = 'requires_human_judgment';
    }

    return resolution;
  } catch (error) {
    resolution.result = 'error';
    console.error(`[REPAIR] Error resolving queue item ${item.id}:`, error.message);
    return resolution;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.log('[REPAIR] Starting comprehensive data repair...');

    // Fetch all orders and queue items
    const [allOrders, queueItems] = await Promise.all([
      base44.asServiceRole.entities.ShopifyOrder.list('', 500),
      base44.asServiceRole.entities.OrderReviewQueue.list('', 100),
    ]);

    const results = {
      timestamp: new Date().toISOString(),
      orders_scanned: 0,
      orders_repaired: 0,
      orders_with_issues: 0,
      orders_errored: 0,
      repair_details: [],
      queue_items_reviewed: 0,
      queue_items_resolved: 0,
      queue_resolutions: [],
      summary: {},
    };

    // STEP 1-6: REPAIR ORDERS
    for (const order of allOrders || []) {
      results.orders_scanned++;
      const repairResult = await repairOrder(base44, order);
      
      results.repair_details.push(repairResult);
      
      if (repairResult.result === 'repaired_successfully') {
        results.orders_repaired++;
      } else if (repairResult.result === 'error') {
        results.orders_errored++;
      } else if (repairResult.issues_found.length > 0) {
        results.orders_with_issues++;
      }
    }

    // STEP 7: RESOLVE REVIEW QUEUE ITEMS
    for (const item of queueItems || []) {
      results.queue_items_reviewed++;
      const resolution = await resolveReviewQueueItem(base44, item);
      if (resolution) {
        results.queue_resolutions.push(resolution);
        if (resolution.result && !resolution.result.includes('error')) {
          results.queue_items_resolved++;
        }
      }
    }

    // STEP 8-9: GENERATE SUMMARY
    const issuesSummary = {};
    for (const detail of results.repair_details) {
      for (const issue of detail.issues_found) {
        issuesSummary[issue] = (issuesSummary[issue] || 0) + 1;
      }
    }

    results.summary = {
      total_orders: results.orders_scanned,
      orders_needing_repair: results.orders_with_issues,
      orders_successfully_repaired: results.orders_repaired,
      orders_with_errors: results.orders_errored,
      issues_by_type: issuesSummary,
      queue_items_reviewed: results.queue_items_reviewed,
      queue_items_resolved: results.queue_items_resolved,
      queue_items_pending: results.queue_items_reviewed - results.queue_items_resolved,
    };

    console.log('[REPAIR] Comprehensive data repair complete:', results.summary);

    return Response.json({
      success: true,
      message: 'Comprehensive data repair completed',
      results,
    });
  } catch (error) {
    console.error('[REPAIR]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});