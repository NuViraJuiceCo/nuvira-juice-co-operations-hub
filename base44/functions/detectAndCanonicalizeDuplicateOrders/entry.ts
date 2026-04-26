import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * DUPLICATE DETECTION & CANONICALIZATION
 * 
 * Scans database for duplicate orders and identifies canonical records.
 * Classifies duplicates by type.
 * Recommends which records to archive/quarantine.
 */

async function findDuplicateGroups(orders) {
  const groups = {
    by_stripe_payment_intent: {},
    by_stripe_subscription: {},
    by_stripe_invoice: {},
    by_stripe_customer: {},
    by_customer_email_phone: {},
    by_shopify_id: {},
    by_line_item_signature: {},
    by_subscription_delivery_sequence: {},
  };

  for (const order of orders) {
    // Group by Stripe Payment Intent
    if (order.stripe_payment_intent_id) {
      const key = order.stripe_payment_intent_id;
      if (!groups.by_stripe_payment_intent[key]) {
        groups.by_stripe_payment_intent[key] = [];
      }
      groups.by_stripe_payment_intent[key].push(order.id);
    }

    // Group by Stripe Subscription
    if (order.stripe_subscription_id) {
      const key = order.stripe_subscription_id;
      if (!groups.by_stripe_subscription[key]) {
        groups.by_stripe_subscription[key] = [];
      }
      groups.by_stripe_subscription[key].push(order.id);
    }

    // Group by Stripe Invoice
    if (order.stripe_invoice_id) {
      const key = order.stripe_invoice_id;
      if (!groups.by_stripe_invoice[key]) {
        groups.by_stripe_invoice[key] = [];
      }
      groups.by_stripe_invoice[key].push(order.id);
    }

    // Group by Stripe Customer + Email
    if (order.stripe_customer_id && order.customer_email) {
      const key = `${order.stripe_customer_id}:${order.customer_email}`;
      if (!groups.by_stripe_customer[key]) {
        groups.by_stripe_customer[key] = [];
      }
      groups.by_stripe_customer[key].push(order.id);
    }

    // Group by Email + Phone
    if (order.customer_email && order.customer_phone) {
      const key = `${order.customer_email}:${order.customer_phone}`;
      if (!groups.by_customer_email_phone[key]) {
        groups.by_customer_email_phone[key] = [];
      }
      groups.by_customer_email_phone[key].push(order.id);
    }

    // Group by Shopify ID
    if (order.shopify_order_id) {
      const key = order.shopify_order_id;
      if (!groups.by_shopify_id[key]) {
        groups.by_shopify_id[key] = [];
      }
      groups.by_shopify_id[key].push(order.id);
    }

    // Group by Line Item Signature (hash of items)
    if (order.line_items && order.line_items.length > 0) {
      const sig = JSON.stringify(
        order.line_items.map(i => `${i.title}:${i.quantity}:${i.price}`).sort()
      );
      const key = `${order.customer_email}:${sig}:${order.total_price}`;
      if (!groups.by_line_item_signature[key]) {
        groups.by_line_item_signature[key] = [];
      }
      groups.by_line_item_signature[key].push(order.id);
    }

    // Group subscription deliveries by sequence
    if (order.subscription_parent_id && order.fulfillment_sequence_number !== null) {
      const key = `${order.subscription_parent_id}:${order.fulfillment_sequence_number}`;
      if (!groups.by_subscription_delivery_sequence[key]) {
        groups.by_subscription_delivery_sequence[key] = [];
      }
      groups.by_subscription_delivery_sequence[key].push(order.id);
    }
  }

  return groups;
}

function selectCanonical(orderGroup, allOrders) {
  const groupOrders = allOrders.filter(o => orderGroup.includes(o.id));
  if (groupOrders.length === 0) return null;
  if (groupOrders.length === 1) return groupOrders[0];

  // Canonicalization priority
  const scored = groupOrders.map(o => {
    let score = 0;

    // Has valid Stripe ID
    if (o.stripe_payment_intent_id || o.stripe_subscription_id || o.stripe_invoice_id) score += 100;

    // Has Shopify ID
    if (o.shopify_order_id && o.shopify_order_id !== o.stripe_payment_intent_id) score += 50;

    // Lock status = production_scheduled or higher (verified & locked)
    if (['production_scheduled', 'in_production', 'out_for_delivery', 'fulfilled'].includes(o.order_lock_status)) score += 80;

    // Data quality = verified
    if (o.data_quality_status === 'verified') score += 70;
    if (o.data_quality_status === 'production_scheduled') score += 60;

    // Has complete customer identity
    if (o.customer_name && o.customer_email && o.customer_phone) score += 40;

    // Is subscription with fulfillments
    if (o.stripe_subscription_id && o.fulfillments && o.fulfillments.length > 0) score += 65;

    // Has line items
    if (o.line_items && o.line_items.length > 0) score += 20;

    // Has non-zero total
    if (o.total_price > 0) score += 15;

    // Not in needs_review / quarantined
    if (!['needs_review', 'quarantined'].includes(o.data_quality_status)) score += 10;

    // Newer is slightly better (tie-breaker)
    const daysOld = (Date.now() - new Date(o.created_date).getTime()) / (1000 * 60 * 60 * 24);
    score -= daysOld * 0.1; // Recent is better

    return { order: o, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].order;
}

function classifyDuplicate(canonical, duplicate) {
  const reasons = [];

  if (canonical.stripe_payment_intent_id === duplicate.stripe_payment_intent_id) {
    reasons.push('same_stripe_payment_intent');
  }
  if (canonical.stripe_subscription_id === duplicate.stripe_subscription_id) {
    reasons.push('same_stripe_subscription');
  }
  if (canonical.stripe_invoice_id === duplicate.stripe_invoice_id) {
    reasons.push('same_stripe_invoice');
  }
  if (canonical.shopify_order_id === duplicate.shopify_order_id && canonical.shopify_order_id) {
    reasons.push('same_shopify_id');
  }
  if (canonical.customer_email === duplicate.customer_email && canonical.customer_email) {
    if (canonical.customer_phone === duplicate.customer_phone && canonical.customer_phone) {
      reasons.push('same_email_phone');
    }
  }
  if (canonical.fulfillment_sequence_number === duplicate.fulfillment_sequence_number && 
      canonical.subscription_parent_id === duplicate.subscription_parent_id) {
    reasons.push('same_subscription_delivery_sequence');
  }

  return reasons;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Load all orders
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('', 1000);

    if (!allOrders || allOrders.length === 0) {
      return Response.json({ success: true, message: 'No orders found', duplicates: [] });
    }

    // Find duplicate groups
    const groups = await findDuplicateGroups(allOrders);

    // Identify duplicates
    const duplicateGroups = [];

    for (const [groupName, groupMembers] of Object.entries(groups)) {
      for (const [key, orderIds] of Object.entries(groupMembers)) {
        if (orderIds.length > 1) {
          const canonical = selectCanonical(orderIds, allOrders);
          if (!canonical) continue;

          const duplicates = orderIds
            .filter(id => id !== canonical.id)
            .map(id => allOrders.find(o => o.id === id))
            .map(dup => ({
              id: dup.id,
              order_number: dup.shopify_order_number,
              customer_email: dup.customer_email,
              created_date: dup.created_date,
              data_quality_status: dup.data_quality_status,
              lock_status: dup.order_lock_status,
              reasons: classifyDuplicate(canonical, dup),
            }));

          if (duplicates.length > 0) {
            duplicateGroups.push({
              group_type: groupName,
              group_key: key,
              canonical_order: {
                id: canonical.id,
                order_number: canonical.shopify_order_number,
                customer_email: canonical.customer_email,
                customer_name: canonical.customer_name,
                total_price: canonical.total_price,
                created_date: canonical.created_date,
                data_quality_status: canonical.data_quality_status,
                lock_status: canonical.order_lock_status,
                stripe_ids: {
                  payment_intent: canonical.stripe_payment_intent_id,
                  subscription: canonical.stripe_subscription_id,
                  invoice: canonical.stripe_invoice_id,
                },
              },
              duplicates,
              recommendation: duplicates.length === 1 ? 'archive_duplicate' : 'quarantine_all_review',
            });
          }
        }
      }
    }

    // Check for orphaned records
    const orphanedProduction = await base44.asServiceRole.entities.ProductionBatch.list('', 500);
    const orderIds = new Set(allOrders.map(o => o.id));
    const orphanedBatches = (orphanedProduction || []).filter(b => {
      const hasOrphan = b.order_sources?.some(os => !orderIds.has(os.order_id));
      return hasOrphan;
    });

    return Response.json({
      success: true,
      timestamp: new Date().toISOString(),
      total_orders_scanned: allOrders.length,
      duplicate_groups_found: duplicateGroups.length,
      total_duplicates: duplicateGroups.reduce((s, g) => s + g.duplicates.length, 0),
      duplicate_groups: duplicateGroups,
      orphaned_batches: orphanedBatches.length,
      orphaned_batch_details: orphanedBatches.map(b => ({
        batch_id: b.batch_id,
        product_name: b.product_name,
        orphaned_order_count: b.order_sources?.filter(os => !orderIds.has(os.order_id)).length || 0,
      })),
      summary: {
        duplicate_free: duplicateGroups.length === 0,
        production_integrity: orphanedBatches.length === 0,
        action_required: duplicateGroups.length > 0 || orphanedBatches.length > 0,
      },
    });
  } catch (error) {
    console.error('[DUPLICATE-DETECT]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});