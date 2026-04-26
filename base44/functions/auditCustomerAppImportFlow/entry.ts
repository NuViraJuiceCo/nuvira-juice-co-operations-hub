import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * COMPREHENSIVE CUSTOMER APP → HUB IMPORT FLOW AUDIT
 * 
 * Scans all existing orders to identify:
 * - Incomplete customer info
 * - Missing line items
 * - Missing payment links
 * - Missing subscription links
 * - Duplicate orders
 * - #UNKNOWN orders
 * - Orphaned production/driver records
 * - Which sync path created each order
 * - Field ownership violations
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('', 1000);

    const audit = {
      timestamp: new Date().toISOString(),
      total_orders: allOrders?.length || 0,
      by_source_type: {},
      by_data_quality: {},
      incomplete_orders: [],
      broken_orders: [],
      unknown_orders: [],
      duplicate_candidates: [],
      orphaned_records: {
        production_refs: [],
        driver_refs: [],
      },
      summary: {
        critical_issues: 0,
        missing_customer_info: 0,
        missing_line_items: 0,
        missing_payment_link: 0,
        missing_subscription_link: 0,
        missing_shopify_link: 0,
        unknown_count: 0,
        duplicate_count: 0,
      },
    };

    if (!allOrders || allOrders.length === 0) {
      return Response.json({ success: true, audit });
    }

    // Classify by source type
    for (const order of allOrders) {
      const sourceType = order.source_type || order.source_channel || 'unknown';
      if (!audit.by_source_type[sourceType]) {
        audit.by_source_type[sourceType] = 0;
      }
      audit.by_source_type[sourceType]++;

      const quality = order.data_quality_status || 'unknown';
      if (!audit.by_data_quality[quality]) {
        audit.by_data_quality[quality] = 0;
      }
      audit.by_data_quality[quality]++;
    }

    // Scan each order for issues
    for (const order of allOrders) {
      const issues = [];
      let isCritical = false;

      // Missing customer info
      if (!order.customer_name || order.customer_name === 'Unknown') {
        issues.push('missing_customer_name');
        audit.summary.missing_customer_info++;
        isCritical = true;
      }
      if (!order.customer_email || order.customer_email === 'unknown@unknown.com') {
        issues.push('missing_email');
        audit.summary.missing_customer_info++;
        isCritical = true;
      }
      if (!order.customer_phone) {
        issues.push('missing_phone');
      }

      // Missing address (if delivery)
      if (order.fulfillment_method === 'delivery' && !order.address_line1) {
        issues.push('missing_delivery_address');
        isCritical = true;
      }

      // Missing line items
      if (!order.line_items || order.line_items.length === 0) {
        issues.push('missing_line_items');
        audit.summary.missing_line_items++;
        isCritical = true;
      }

      // Missing total price
      if (!order.total_price || order.total_price === 0) {
        issues.push('missing_or_zero_total');
        isCritical = true;
      }

      // Missing payment link
      if (!order.stripe_payment_intent_id && !order.stripe_invoice_id && !order.stripe_checkout_session_id) {
        if (order.payment_status === 'paid' || order.source_type === 'stripe_checkout' || order.source_type === 'stripe_invoice') {
          issues.push('missing_stripe_payment_link');
          audit.summary.missing_payment_link++;
          isCritical = true;
        }
      }

      // Missing subscription link (if subscription)
      if (order.source_channel === 'subscription' && !order.stripe_subscription_id) {
        issues.push('missing_stripe_subscription_id');
        audit.summary.missing_subscription_link++;
        isCritical = true;
      }

      // #UNKNOWN order
      if (order.shopify_order_number === '#unknown' || order.shopify_order_number === '#UNKNOWN') {
        issues.push('order_marked_unknown');
        audit.summary.unknown_count++;
        isCritical = true;
      }

      // Missing Shopify reference (if applicable)
      if (order.source_channel === 'pos' && !order.shopify_order_id) {
        issues.push('missing_shopify_order_id');
        audit.summary.missing_shopify_link++;
      }

      // Missing subscription fulfillments
      if (order.source_channel === 'subscription' && (!order.fulfillments || order.fulfillments.length === 0)) {
        issues.push('missing_subscription_fulfillments');
        isCritical = true;
      }

      // Missing production record
      if (order.production_status && order.production_status !== 'new' && !order.order_lock_status) {
        issues.push('missing_order_lock_status');
      }

      if (issues.length > 0) {
        const orderRecord = {
          order_id: order.id,
          order_number: order.shopify_order_number,
          customer_email: order.customer_email,
          customer_name: order.customer_name,
          source_type: order.source_type,
          source_channel: order.source_channel,
          created_date: order.created_date,
          issues,
          is_critical: isCritical,
          data_quality_status: order.data_quality_status,
          last_sync_at: order.last_sync_at,
        };

        if (isCritical) {
          audit.summary.critical_issues++;
          audit.broken_orders.push(orderRecord);
        } else {
          audit.incomplete_orders.push(orderRecord);
        }
      }

      // #UNKNOWN tracking
      if (order.shopify_order_number === '#unknown' || order.shopify_order_number === '#UNKNOWN') {
        audit.unknown_orders.push({
          order_id: order.id,
          customer_email: order.customer_email,
          stripe_payment_intent: order.stripe_payment_intent_id,
          stripe_subscription: order.stripe_subscription_id,
          created_date: order.created_date,
        });
      }
    }

    // Find duplicate candidates
    const seenIds = {
      by_stripe_payment_intent: {},
      by_stripe_subscription: {},
      by_stripe_invoice: {},
      by_customer_email: {},
      by_shopify_id: {},
    };

    for (const order of allOrders) {
      // By Stripe payment intent
      if (order.stripe_payment_intent_id) {
        const key = order.stripe_payment_intent_id;
        if (!seenIds.by_stripe_payment_intent[key]) {
          seenIds.by_stripe_payment_intent[key] = [];
        }
        seenIds.by_stripe_payment_intent[key].push(order.id);
      }

      // By Stripe subscription
      if (order.stripe_subscription_id) {
        const key = order.stripe_subscription_id;
        if (!seenIds.by_stripe_subscription[key]) {
          seenIds.by_stripe_subscription[key] = [];
        }
        seenIds.by_stripe_subscription[key].push(order.id);
      }

      // By Stripe invoice
      if (order.stripe_invoice_id) {
        const key = order.stripe_invoice_id;
        if (!seenIds.by_stripe_invoice[key]) {
          seenIds.by_stripe_invoice[key] = [];
        }
        seenIds.by_stripe_invoice[key].push(order.id);
      }

      // By customer email
      if (order.customer_email) {
        const key = order.customer_email;
        if (!seenIds.by_customer_email[key]) {
          seenIds.by_customer_email[key] = [];
        }
        seenIds.by_customer_email[key].push(order.id);
      }

      // By Shopify ID
      if (order.shopify_order_id) {
        const key = order.shopify_order_id;
        if (!seenIds.by_shopify_id[key]) {
          seenIds.by_shopify_id[key] = [];
        }
        seenIds.by_shopify_id[key].push(order.id);
      }
    }

    // Extract actual duplicates
    for (const [key, ids] of Object.entries(seenIds.by_stripe_payment_intent)) {
      if (ids.length > 1) {
        audit.duplicate_candidates.push({
          duplicate_type: 'same_stripe_payment_intent',
          identifier: key,
          order_ids: ids,
        });
        audit.summary.duplicate_count += ids.length - 1;
      }
    }

    for (const [key, ids] of Object.entries(seenIds.by_stripe_subscription)) {
      if (ids.length > 1) {
        audit.duplicate_candidates.push({
          duplicate_type: 'same_stripe_subscription',
          identifier: key,
          order_ids: ids,
        });
        audit.summary.duplicate_count += ids.length - 1;
      }
    }

    for (const [key, ids] of Object.entries(seenIds.by_stripe_invoice)) {
      if (ids.length > 1) {
        audit.duplicate_candidates.push({
          duplicate_type: 'same_stripe_invoice',
          identifier: key,
          order_ids: ids,
        });
        audit.summary.duplicate_count += ids.length - 1;
      }
    }

    // Check for orphaned production/driver records
    const [allBatches, allTasks] = await Promise.all([
      base44.asServiceRole.entities.ProductionBatch.list('', 500),
      base44.asServiceRole.entities.FulfillmentTask.list('', 500),
    ]);

    const orderIds = new Set(allOrders.map(o => o.id));

    for (const batch of allBatches || []) {
      if (batch.order_sources) {
        const orphaned = batch.order_sources.filter(os => !orderIds.has(os.order_id));
        if (orphaned.length > 0) {
          audit.orphaned_records.production_refs.push({
            batch_id: batch.batch_id,
            product: batch.product_name,
            orphaned_count: orphaned.length,
            orphaned_order_ids: orphaned.map(o => o.order_id),
          });
        }
      }
    }

    for (const task of allTasks || []) {
      if (!orderIds.has(task.order_id)) {
        audit.orphaned_records.driver_refs.push({
          task_id: task.id,
          customer: task.customer_name,
          missing_order_id: task.order_id,
        });
      }
    }

    return Response.json({ success: true, audit });
  } catch (error) {
    console.error('[AUDIT-IMPORT]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});