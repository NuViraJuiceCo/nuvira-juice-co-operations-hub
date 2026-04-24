import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * SUBSCRIPTION FULFILLMENT INTEGRITY CHECK
 * 
 * Run daily
 * 
 * Purpose:
 * - Verify future subscription fulfillments exist
 * - Verify each fulfillment has required data
 * - Backfill missing fulfillment rows
 */

const PRODUCTION_DAYS = [2, 5, 6]; // Tue, Fri, Sat

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
  
  const fallback = new Date(d);
  fallback.setDate(d.getDate() + 3);
  return fallback.toISOString().split('T')[0];
}

function detectFulfillmentCount(order) {
  if (order.source_channel !== 'subscription') return 1;
  const notes = (order.customer_notes || '').toLowerCase();
  const match = notes.match(/(\d+)\s*(week|time|deliver|fulfillment)/);
  if (match) return parseInt(match[1], 10);
  
  // Infer from line items: detect bundle fulfillment_count field
  if (order.line_items && order.line_items.length > 0) {
    // Check if any line item title has fulfillment info
    // For now, default to 4 weeks for monthly subscriptions
    if (order.line_items[0].title?.toLowerCase().includes('monthly')) return 4;
  }
  return 1;
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
      checked: 0,
      issues: [],
      backfilled: 0,
    };

    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const order of allOrders) {
      if (order.source_channel !== 'subscription') continue;
      if (!order.stripe_subscription_id) continue;

      result.checked++;

      const fulfillmentCount = detectFulfillmentCount(order);
      const existingCount = (order.fulfillments || []).length;

      // Check if fulfillments exist
      if (existingCount === 0 && fulfillmentCount > 0) {
        result.issues.push({
          order_id: order.id,
          customer_email: order.customer_email,
          issue: 'no_fulfillments',
          expected_count: fulfillmentCount,
          actual_count: 0,
        });

        // Try to backfill
        try {
          const firstProdDate = getNextProductionDate(order.customer_order_date || today);
          const fulfillments = [];

          for (let i = 0; i < fulfillmentCount; i++) {
            const prodDate = new Date(firstProdDate + 'T00:00:00');
            prodDate.setDate(prodDate.getDate() + 7 * i);
            const prodDateStr = prodDate.toISOString().split('T')[0];

            // Production → delivery
            const delivDate = new Date(prodDate);
            const dayOfWeek = prodDate.getDay();
            const daysToAdd = dayOfWeek === 5 ? 1 : (dayOfWeek === 6 ? 1 : 3);
            delivDate.setDate(delivDate.getDate() + daysToAdd);

            fulfillments.push({
              fulfillment_number: i + 1,
              production_date: prodDateStr,
              delivery_date: delivDate.toISOString().split('T')[0],
              items: order.line_items || [],
              status: 'pending',
              address_line1: order.address_line1 || '',
              address_line2: order.address_line2 || '',
              address_city: order.address_city || '',
              address_state: order.address_state || '',
              address_postal_code: order.address_postal_code || '',
              address_country: order.address_country || 'US',
              delivery_notes: order.delivery_notes || '',
            });
          }

          await base44.asServiceRole.entities.ShopifyOrder.update(order.id, {
            fulfillments,
          });

          result.backfilled++;
        } catch (err) {
          console.error('[FULFILLMENT-INTEGRITY] Backfill failed for order', order.id, ':', err.message);
        }
      } else if (existingCount > 0 && existingCount < fulfillmentCount) {
        // Missing some fulfillments
        result.issues.push({
          order_id: order.id,
          customer_email: order.customer_email,
          issue: 'incomplete_fulfillments',
          expected_count: fulfillmentCount,
          actual_count: existingCount,
        });
      }

      // Check each fulfillment has required fields
      if (order.fulfillments && order.fulfillments.length > 0) {
        for (let i = 0; i < order.fulfillments.length; i++) {
          const f = order.fulfillments[i];
          const missing = [];

          if (!f.fulfillment_number) missing.push('fulfillment_number');
          if (!f.delivery_date) missing.push('delivery_date');
          if (!f.address_line1 && !order.address_line1) missing.push('address');
          if (!f.items || f.items.length === 0) missing.push('items');

          if (missing.length > 0) {
            result.issues.push({
              order_id: order.id,
              fulfillment_index: i,
              issue: 'incomplete_fulfillment',
              missing_fields: missing,
            });
          }
        }
      }
    }

    return Response.json({ success: true, result });
  } catch (error) {
    console.error('[FULFILLMENT-INTEGRITY] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});