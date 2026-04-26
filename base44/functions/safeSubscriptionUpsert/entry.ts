import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Normalize Stripe's formatted line item titles
function normalizeLineItemTitle(title) {
  if (!title) return title;
  let normalized = title.replace(/^\d+\s*×\s*/, '').trim(); // Remove "1 × "
  normalized = normalized.replace(/\s*\(at\s+\$[\d.]+\s*\/\s*\w+\)/i, '').trim(); // Remove "(at $144 / month)"
  normalized = normalized.replace(/\s*\(\$[\d.,]+.*?\)/i, '').trim(); // Remove generic prices
  return normalized;
}

// Build bundle lookup map
function buildBundleMap(bundles) {
  const map = {};
  for (const b of bundles) {
    if (b.is_active === false) continue;
    const key = normalizeLineItemTitle(b.bundle_name);
    map[key] = { components: b.components || [], fulfillment_count: b.fulfillment_count || 1 };
    map[b.bundle_name] = { components: b.components || [], fulfillment_count: b.fulfillment_count || 1 };
  }
  return map;
}

// Get next production date
function getNextProductionDate(fromDate) {
  const PRODUCTION_DAYS = [2, 5, 6];
  const FIRST_PRODUCTION_DATE = '2026-05-01';
  const d = new Date(fromDate);
  d.setHours(0, 0, 0, 0);
  const firstProd = new Date(FIRST_PRODUCTION_DATE + 'T00:00:00');
  if (d < firstProd) return FIRST_PRODUCTION_DATE;
  for (let i = 1; i <= 14; i++) {
    const next = new Date(d);
    next.setDate(d.getDate() + i);
    if (PRODUCTION_DAYS.includes(next.getDay())) {
      const result = next.toISOString().split('T')[0];
      return result < FIRST_PRODUCTION_DATE ? FIRST_PRODUCTION_DATE : result;
    }
  }
  const fallback = new Date(d);
  fallback.setDate(d.getDate() + 3);
  return fallback.toISOString().split('T')[0];
}

// Decompose subscription into weekly fulfillments
function decomposeIntoFulfillments(orderData, bundleMap) {
  if (!orderData.line_items || orderData.line_items.length === 0) {
    return [];
  }

  let fulfillmentCount = 1;
  for (const item of orderData.line_items) {
    const bundleInfo = bundleMap[item.title];
    if (bundleInfo && bundleInfo.fulfillment_count > fulfillmentCount) {
      fulfillmentCount = bundleInfo.fulfillment_count;
    }
  }

  const baseProductionDate = getNextProductionDate(new Date());
  const fulfillments = [];

  for (let i = 0; i < fulfillmentCount; i++) {
    const prodDate = new Date(baseProductionDate + 'T00:00:00');
    prodDate.setDate(prodDate.getDate() + 7 * i);

    const delivDate = new Date(prodDate);
    delivDate.setDate(delivDate.getDate() + 3);

    const items = [];
    for (const lineItem of orderData.line_items) {
      const bundleInfo = bundleMap[lineItem.title];
      if (bundleInfo) {
        for (const comp of bundleInfo.components) {
          const qtyPerFulfillment = Math.max(1, Math.round((comp.quantity || 1) / fulfillmentCount));
          items.push({
            title: comp.product_name,
            quantity: qtyPerFulfillment,
            price: 0,
          });
        }
      } else {
        const qtyPerFulfillment = Math.max(1, Math.round((lineItem.quantity || 1) / fulfillmentCount));
        items.push({
          title: lineItem.title,
          quantity: qtyPerFulfillment,
          price: lineItem.price || 0,
        });
      }
    }

    fulfillments.push({
      fulfillment_number: i + 1,
      production_date: prodDate.toISOString().split('T')[0],
      delivery_date: delivDate.toISOString().split('T')[0],
      items,
      status: 'pending',
      address_line1: orderData.address_line1 || '',
      address_line2: orderData.address_line2 || '',
      address_city: orderData.address_city || '',
      address_state: orderData.address_state || '',
      address_postal_code: orderData.address_postal_code || '',
      address_country: orderData.address_country || 'US',
      delivery_notes: orderData.delivery_notes || '',
    });
  }

  return fulfillments;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let payload;
    
    // Handle both POST with body and function invocation
    try {
      payload = await req.json();
    } catch {
      payload = {};
    }
    
    // If no payload, try to read from request context
    if (!payload.orderData) {
      return Response.json({ error: 'Missing orderData' }, { status: 400 });
    }
    const { orderData, source, event_id } = payload;

    if (!orderData || !orderData.stripe_subscription_id || orderData.source_channel !== 'subscription') {
      return Response.json({ error: 'Invalid subscription order data' }, { status: 400 });
    }

    // Find existing subscription
    let existingOrder = null;
    const matches = await base44.asServiceRole.entities.ShopifyOrder.filter({
      stripe_subscription_id: orderData.stripe_subscription_id,
    });
    if (matches && matches.length > 0) {
      existingOrder = matches[0];
    }

    // Check data completeness
    const completeness = {
      has_email: !!orderData.customer_email,
      has_name: !!orderData.customer_name,
      has_items: !!(orderData.line_items && orderData.line_items.length > 0),
      has_total: !!(orderData.total_price && orderData.total_price > 0),
    };
    const score = Object.values(completeness).filter(v => v).length / 4;

    // Reject incomplete updates if we have existing
    if (score < 0.75 && existingOrder) {
      console.log('[SAFE-SUB] Rejecting incomplete update, keeping existing');
      return Response.json({ action: 'rejected', order_id: existingOrder.id });
    }

    // Normalize line items
    let finalData = { ...orderData };
    if (finalData.line_items) {
      finalData.line_items = finalData.line_items.map(item => ({
        ...item,
        title: normalizeLineItemTitle(item.title),
      }));
    }

    // Preserve critical fields if updating
    if (existingOrder) {
      finalData.stripe_subscription_id = existingOrder.stripe_subscription_id;
      finalData.stripe_customer_id = existingOrder.stripe_customer_id || finalData.stripe_customer_id;
      finalData.source_channel = 'subscription';
      finalData.fulfillment_method = 'delivery';
      
      const meaningfulStatuses = ['awaiting_production','in_production','bottled','labeled','qc_checked','packed','in_cold_storage','assigned_for_pickup','assigned_for_delivery','fulfilled'];
      if (meaningfulStatuses.includes(existingOrder.production_status)) {
        finalData.production_status = existingOrder.production_status;
      }
      if (existingOrder.fulfillments && existingOrder.fulfillments.length > 0) {
        finalData.fulfillments = existingOrder.fulfillments;
      }
      if (existingOrder.internal_notes) {
        finalData.internal_notes = existingOrder.internal_notes;
      }
    }

    // Load bundles and decompose
    const bundles = await base44.asServiceRole.entities.Bundle.list('-updated_date', 100);
    const bundleMap = buildBundleMap(bundles);
    const fulfillments = decomposeIntoFulfillments(finalData, bundleMap);
    
    if (fulfillments && fulfillments.length > 0) {
      finalData.fulfillments = fulfillments;
    }

    // Route ALL writes through safeSyncOrderUpdate — never write directly
    const safeResult = await base44.asServiceRole.functions.invoke('safeSyncOrderUpdate', {
      incomingData: finalData,
      source: 'rebuild_subscriptions',
      matchBy: existingOrder
        ? { stripe_subscription_id: finalData.stripe_subscription_id }
        : undefined,
    });

    if (safeResult?.data?.status === 'rejected') {
      console.warn('[SAFE-SUB] Gateway rejected write:', safeResult.data.reason);
      return Response.json({ action: 'rejected', reason: safeResult.data.reason });
    }

    return Response.json({
      success: true,
      order_id: safeResult?.data?.order_id,
      fulfillments: (finalData.fulfillments || []).length,
      action: safeResult?.data?.action || (existingOrder ? 'updated' : 'created'),
    });

  } catch (error) {
    console.error('[SAFE-SUB] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});