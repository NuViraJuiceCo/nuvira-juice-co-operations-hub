import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * NuVira Production Scheduling Rules:
 * Orders placed before Friday midnight ship on the NEXT Friday.
 * Production happens 3 days before delivery:
 *   - Friday delivery → produce Tuesday
 *   - Saturday delivery → produce Wednesday
 *
 * Simple rule used here:
 *   Find the next upcoming production day (Tue, Fri, Sat) from today.
 *   Orders with requested_delivery_date use that date's preceding production day.
 *   Orders without a delivery date use the next upcoming production day.
 */

const PRODUCTION_DAYS = [2, 5, 6]; // Tue=2, Fri=5, Sat=6 (0=Sun)

const FIRST_PRODUCTION_DATE = '2026-05-01'; // First production date (May 1st)
const FIRST_DELIVERY_DATE = '2026-05-02'; // Deliveries start May 2nd

function getNextProductionDate(fromDate) {
  const d = new Date(fromDate);
  d.setHours(0, 0, 0, 0);
  
  // Never schedule before the first production date
  const firstProd = new Date(FIRST_PRODUCTION_DATE + 'T00:00:00');
  if (d < firstProd) {
    return FIRST_PRODUCTION_DATE;
  }
  
  for (let i = 1; i <= 14; i++) {
    const next = new Date(d);
    next.setDate(d.getDate() + i);
    if (PRODUCTION_DAYS.includes(next.getDay())) {
      const nextStr = next.toISOString().split('T')[0];
      return nextStr < FIRST_PRODUCTION_DATE ? FIRST_PRODUCTION_DATE : nextStr;
    }
  }
  // fallback
  const fallback = new Date(d);
  fallback.setDate(d.getDate() + 3);
  const fallbackStr = fallback.toISOString().split('T')[0];
  return fallbackStr < FIRST_PRODUCTION_DATE ? FIRST_PRODUCTION_DATE : fallbackStr;
}

function getProductionDateForDelivery(deliveryDateStr) {
  const d = new Date(deliveryDateStr);
  d.setHours(0, 0, 0, 0);
  // production is 3 days before delivery
  d.setDate(d.getDate() - 3);
  // snap to nearest prior production day
  for (let i = 0; i <= 7; i++) {
    const check = new Date(d);
    check.setDate(d.getDate() - i);
    if (PRODUCTION_DAYS.includes(check.getDay())) {
      const result = check.toISOString().split('T')[0];
      return result < FIRST_PRODUCTION_DATE ? FIRST_PRODUCTION_DATE : result;
    }
  }
  const result = d.toISOString().split('T')[0];
  return result < FIRST_PRODUCTION_DATE ? FIRST_PRODUCTION_DATE : result;
}

function normalizeProductName(name) {
  if (!name) return name;
  // Normalize casing: capitalize first letter of each word
  return name.trim().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function stripArticle(name) {
  // Strip leading "The " for fuzzy bundle matching
  if (!name) return name;
  return name.replace(/^the\s+/i, '').trim();
}

function findBundleComponents(bundleMap, itemTitle) {
  // Try multiple variations: exact, normalized, lowercase, without leading "The"
  const stripped = stripArticle(itemTitle);
  return (
    bundleMap[itemTitle] ||
    bundleMap[normalizeProductName(itemTitle)] ||
    bundleMap[itemTitle.toLowerCase()] ||
    bundleMap[stripped] ||
    bundleMap[normalizeProductName(stripped)] ||
    bundleMap[stripped.toLowerCase()] ||
    null
  );
}

/**
 * For subscription orders, the line item quantity is the TOTAL for the subscription period.
 * We need to split this into per-fulfillment quantities spread across consecutive production dates.
 *
 * Detects fulfillment count by:
 * 1. Looking up the Bundle in bundleMap and using its fulfillment_count
 * 2. Falling back to customer_notes pattern matching
 * 3. Default to 1 if not a subscription or not detectable
 */
function detectFulfillmentCount(order, bundleMap) {
  if (order.source_channel !== 'subscription') return 1;
  
  // Try to find fulfillment count from Bundle entity (most reliable for subscriptions)
  if (order.line_items && order.line_items.length > 0) {
    for (const item of order.line_items) {
      const bundleComponents = findBundleComponents(bundleMap, item.title);
      if (bundleComponents !== null) {
        // Found a Bundle—check if it has explicit fulfillment_count
        // bundleMap stores the full bundle data, so we need the original bundle object
        // We'll look it up by the bundle name
        const bundleName = item.title;
        // Search bundleMap keys for a match
        for (const key of Object.keys(bundleMap)) {
          if (key === bundleName || key === bundleName.toLowerCase() || 
              stripArticle(key) === stripArticle(bundleName)) {
            // Found it—but bundleMap only stores components
            // We need to check the actual Bundle entity
            // This will be done in the main function and passed here
            break;
          }
        }
      }
    }
  }

  // Fall back to customer_notes pattern matching
  const notes = (order.customer_notes || '').toLowerCase();
  // Match patterns like "4 weeks", "4 times", "4 deliveries", "every week for 4 weeks"
  const match = notes.match(/(\d+)\s*(week|time|deliver|fulfillment)/);
  if (match) return parseInt(match[1], 10);
  
  return 1; // fallback: treat as single fulfillment
}

/**
 * For subscription orders, track which items go into each fulfillment.
 * This helps drivers see exactly what's in each weekly delivery.
 * 
 * Decomposes bundles into their component products per fulfillment.
 * For non-bundle items, spreads the quantity across fulfillments.
 */
function buildFulfillmentItemsMap(order, fulfillmentCount, bundleMap, bundleFullData) {
  const fulfillmentItems = {};
  for (let i = 0; i < fulfillmentCount; i++) {
    fulfillmentItems[i] = [];
  }
  
  if (order.line_items && order.source_channel === 'subscription') {
    order.line_items.forEach(item => {
      const itemTitle = (item.title || '').trim();
      
      // Check if this is a bundle
      const bundleComponents = findBundleComponents(bundleMap, itemTitle);
      
      if (bundleComponents && bundleComponents.length > 0) {
        // This is a bundle — decompose into components for each fulfillment
        for (let i = 0; i < fulfillmentCount; i++) {
          for (const component of bundleComponents) {
            // Each component qty is already the total per bundle
            // For subscriptions, this is per-fulfillment
            fulfillmentItems[i].push({
              title: component.product_name,
              quantity: Math.max(1, Math.round((component.quantity || 1) / fulfillmentCount)),
              price: 0, // Component pricing not tracked separately
            });
          }
        }
      } else {
        // Non-bundle item — spread quantity across fulfillments
        const qtyPerFulfillment = Math.max(1, Math.round((item.quantity || 0) / fulfillmentCount));
        for (let i = 0; i < fulfillmentCount; i++) {
          fulfillmentItems[i].push({
            title: itemTitle,
            quantity: qtyPerFulfillment,
            price: item.price || 0,
          });
        }
      }
    });
  } else if (order.line_items && order.source_channel !== 'subscription') {
    // One-time order — decompose bundles, keep line items as-is
    order.line_items.forEach(item => {
      const itemTitle = (item.title || '').trim();
      
      // Check if this is a bundle
      const bundleComponents = findBundleComponents(bundleMap, itemTitle);
      
      if (bundleComponents && bundleComponents.length > 0) {
        // This is a bundle — decompose into actual components
        fulfillmentItems[0] = fulfillmentItems[0] || [];
        for (const component of bundleComponents) {
          fulfillmentItems[0].push({
            title: component.product_name,
            quantity: component.quantity || 1,
            price: 0,
          });
        }
      } else {
        // Regular item
        fulfillmentItems[0] = fulfillmentItems[0] || [];
        fulfillmentItems[0].push({
          title: itemTitle,
          quantity: item.quantity || 1,
          price: item.price || 0,
        });
      }
    });
  }
  
  return fulfillmentItems;
}

/**
 * Returns an array of N consecutive valid production dates starting from the given date.
 * Each date is 7 days apart (weekly fulfillments).
 */
function getSubscriptionProductionDates(firstDate, count) {
  const dates = [firstDate];
  if (count <= 1) return dates;
  const base = new Date(firstDate + 'T00:00:00');
  for (let i = 1; i < count; i++) {
    const next = new Date(base);
    next.setDate(base.getDate() + 7 * i);
    dates.push(next.toISOString().split('T')[0]);
  }
  return dates;
}

function inferProductCategory(productName) {
  const name = (productName || '').toLowerCase();
  if (name.includes('shot') || name.includes('ginger') || name.includes('turmeric') || name.includes('wheatgrass') || name.includes('spirulina')) {
    return 'shot';
  }
  return 'juice';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Load all active orders and bundles
    const [allOrders, allBundles, allBatches] = await Promise.all([
      base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500),
      base44.asServiceRole.entities.Bundle.list('-updated_date', 100),
      base44.asServiceRole.entities.ProductionBatch.list('-production_date', 500),
    ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Build bundle lookup map: bundle_name (normalized) -> full bundle object
    // Also map exact original names so we can match order line items flexibly
    const bundleMap = {};
    const bundleFullData = {}; // Store full bundle data for fulfillment count lookup
    for (const b of allBundles) {
      if (b.is_active !== false) {
        const comps = b.components || [];
        bundleMap[b.bundle_name] = comps;
        bundleMap[normalizeProductName(b.bundle_name)] = comps;
        bundleMap[b.bundle_name.toLowerCase()] = comps;
        // Also index without leading "The "
        const stripped = stripArticle(b.bundle_name);
        bundleMap[stripped] = comps;
        bundleMap[normalizeProductName(stripped)] = comps;
        bundleMap[stripped.toLowerCase()] = comps;
        
        // Store full bundle data for fulfillment_count lookup
        const normalizedName = normalizeProductName(b.bundle_name);
        bundleFullData[normalizedName] = b;
      }
    }

    // Build locked batch set (date+product keys that should not be recalculated)
    const lockedKeys = new Set();
    for (const batch of allBatches) {
      if (batch.is_locked) {
        lockedKeys.add(`${batch.production_date}__${normalizeProductName(batch.product_name)}`);
      }
    }

    // ─── DECOMPOSE ALL ORDERS INTO (date, product, qty, source info) ───────────
    // Map: "YYYY-MM-DD__ProductName" -> { units: number, sources: [] }
    const planMap = {};

    const activeStatuses = ['new', 'awaiting_production', 'in_production', 'bottled', 'labeled', 'qc_checked', 'packed', 'in_cold_storage'];

    for (const order of allOrders) {
      if (!order || !order.line_items || order.line_items.length === 0) continue;
      if (!activeStatuses.includes(order.production_status)) continue;

      // Determine production date for this order
      let productionDate;
      if (order.assigned_delivery_date) {
        // Clamp delivery to FIRST_DELIVERY_DATE minimum
        const deliveryDate = order.assigned_delivery_date < FIRST_DELIVERY_DATE ? FIRST_DELIVERY_DATE : order.assigned_delivery_date;
        productionDate = getProductionDateForDelivery(deliveryDate);
      } else if (order.requested_delivery_date) {
        const deliveryDate = order.requested_delivery_date < FIRST_DELIVERY_DATE ? FIRST_DELIVERY_DATE : order.requested_delivery_date;
        productionDate = getProductionDateForDelivery(deliveryDate);
      } else {
        const orderDate = order.customer_order_date ? new Date(order.customer_order_date) : new Date();
        productionDate = getNextProductionDate(orderDate);
      }

      // For subscriptions, detect how many fulfillments are in this order
      // and split the total quantity evenly across that many weekly production dates.
      // First, try to get fulfillment count from Bundle metadata
      let fulfillmentCount = 1;
      if (order.source_channel === 'subscription' && order.line_items && order.line_items.length > 0) {
        for (const item of order.line_items) {
          // Try to find bundle by exact name first
          for (const bKey of Object.keys(bundleFullData)) {
            if (bKey.toLowerCase() === item.title.toLowerCase() || 
                stripArticle(bKey).toLowerCase() === stripArticle(item.title).toLowerCase()) {
              const bundleData = bundleFullData[bKey];
              if (bundleData && bundleData.fulfillment_count) {
                fulfillmentCount = Math.max(1, bundleData.fulfillment_count);
                console.log(`[RECALC] Found bundle "${item.title}" with fulfillment_count=${fulfillmentCount}`);
                break;
              }
            }
          }
          if (fulfillmentCount > 1) break;
        }
      }
      // If no bundle match, fall back to customer_notes or default to 1
      if (fulfillmentCount === 1) {
        fulfillmentCount = detectFulfillmentCount(order, bundleMap);
      }
      
      const fulfillmentDates = getSubscriptionProductionDates(productionDate, fulfillmentCount);
      
      // Build fulfillment breakdown for the order (for driver visibility)
      if (order.source_channel === 'subscription' && fulfillmentCount > 1) {
        const fulfillmentItems = buildFulfillmentItemsMap(order, fulfillmentCount, bundleMap, bundleFullData);
        const fulfillmentsArray = [];
        
        for (let fi = 0; fi < fulfillmentDates.length; fi++) {
          const fDate = fulfillmentDates[fi];
          // Production day → delivery day mapping:
          // Tue (2) → Fri (5): +3 days
          // Fri (5) → Sat (6): +1 day
          // Sat (6) → Sun (0): +1 day (next day)
          const prodDate = new Date(fDate + 'T00:00:00');
          const dayOfWeek = prodDate.getDay();
          const daysToAdd = dayOfWeek === 5 ? 1 : (dayOfWeek === 6 ? 1 : 3);
          const deliveryDate = new Date(prodDate);
          deliveryDate.setDate(deliveryDate.getDate() + daysToAdd);
          
          fulfillmentsArray.push({
            fulfillment_number: fi + 1,
            production_date: fDate,
            delivery_date: deliveryDate.toISOString().split('T')[0],
            items: fulfillmentItems[fi] || [],
            status: 'pending',
            // Inherit address from parent order (source of truth)
            address_line1: order.address_line1 || '',
            address_line2: order.address_line2 || '',
            address_city: order.address_city || '',
            address_state: order.address_state || '',
            address_postal_code: order.address_postal_code || '',
            address_country: order.address_country || 'US',
            delivery_notes: order.delivery_notes || '',
          });
        }
        
        // Update the order with fulfillment breakdown (will be saved later if needed)
        order.fulfillments = fulfillmentsArray;

        // Assign subscription to its first delivery date for driver portal filtering
        if (!order.assigned_delivery_date && fulfillmentsArray.length > 0) {
          order._deliveryDateAssigned = fulfillmentsArray[0].delivery_date;
        }
      } else if (order.source_channel !== 'subscription') {
        // One-time orders: decompose bundles if present
        const fulfillmentItems = buildFulfillmentItemsMap(order, 1, bundleMap, bundleFullData);
        order.fulfillments = [{
          fulfillment_number: 1,
          production_date: productionDate,
          delivery_date: (() => {
            const d = new Date(productionDate + 'T00:00:00');
            const dayOfWeek = d.getDay();
            const daysToAdd = dayOfWeek === 5 ? 1 : (dayOfWeek === 6 ? 1 : 3);
            d.setDate(d.getDate() + daysToAdd);
            return d.toISOString().split('T')[0];
          })(),
          items: fulfillmentItems[0] || [],
          status: 'pending',
          address_line1: order.address_line1 || '',
          address_line2: order.address_line2 || '',
          address_city: order.address_city || '',
          address_state: order.address_state || '',
          address_postal_code: order.address_postal_code || '',
          address_country: order.address_country || 'US',
          delivery_notes: order.delivery_notes || '',
        }];
        if (!order.assigned_delivery_date) {
          order._deliveryDateAssigned = order.fulfillments[0].delivery_date;
        }
      }

      for (const item of order.line_items) {
        const itemTitle = (item.title || '').trim();
        const totalQty = Number(item.quantity) || 0;
        if (totalQty <= 0 || !itemTitle) continue;

        // CRITICAL: Per-fulfillment quantity (divide total ONLY across fulfillments for THIS order)
        // For subscription: if 12 bottles for 4 weeks, this is 3 bottles per week
        const perFulfillmentQty = fulfillmentCount > 1 
          ? Math.round(totalQty / fulfillmentCount) 
          : totalQty;

        // Check if this line item is a bundle (try multiple name variations)
        const bundleComponents = findBundleComponents(bundleMap, itemTitle);

        for (let fi = 0; fi < fulfillmentDates.length; fi++) {
          const fDate = fulfillmentDates[fi];
          const fDateObj = new Date(fDate + 'T00:00:00');
          if (fDateObj < today) continue; // skip past dates

          if (bundleComponents && bundleComponents.length > 0) {
            // Decompose bundle into individual products, FOR THIS FULFILLMENT ONLY
            for (const component of bundleComponents) {
              const productName = normalizeProductName(component.product_name);
              
              // CRITICAL: component.quantity is the TOTAL across all fulfillments in the bundle definition
              // Divide by fulfillmentCount to get per-fulfillment amount
              const componentQtyPerFulfillment = fulfillmentCount > 1
                ? Math.round((Number(component.quantity) || 1) / fulfillmentCount)
                : (Number(component.quantity) || 1);
              const qty = Math.max(1, componentQtyPerFulfillment); // Ensure at least 1 if component exists
              
              const key = `${fDate}__${productName}`;

              if (lockedKeys.has(key)) continue;

              if (!planMap[key]) {
                planMap[key] = { productionDate: fDate, productName, units: 0, sources: [] };
              }
              planMap[key].units += qty;
              planMap[key].sources.push({
                order_id: order.id,
                order_number: order.shopify_order_number,
                customer_email: order.customer_email,
                customer_name: order.customer_name || '',
                quantity: qty,
                source_type: order.source_channel === 'subscription' ? 'subscription' : 'bundle',
                source_item: itemTitle,
                fulfillment_index: fulfillmentCount > 1 ? fi + 1 : undefined,
                fulfillment_total: fulfillmentCount > 1 ? fulfillmentCount : undefined,
              });
            }
          } else {
            // Direct product line item, FOR THIS FULFILLMENT ONLY
            const normalizedTitle = normalizeProductName(itemTitle);
            const key = `${fDate}__${normalizedTitle}`;
            if (lockedKeys.has(key)) continue;

            if (!planMap[key]) {
              planMap[key] = { productionDate: fDate, productName: normalizedTitle, units: 0, sources: [] };
            }
            planMap[key].units += perFulfillmentQty;
            planMap[key].sources.push({
              order_id: order.id,
              order_number: order.shopify_order_number,
              customer_email: order.customer_email,
              customer_name: order.customer_name || '',
              quantity: perFulfillmentQty,
              source_type: order.source_channel === 'subscription' ? 'subscription' : 'direct',
              source_item: normalizedTitle,
              fulfillment_index: fulfillmentCount > 1 ? fi + 1 : undefined,
              fulfillment_total: fulfillmentCount > 1 ? fulfillmentCount : undefined,
            });
          }
        }
      }
    }

    // ─── BUILD EXISTING BATCH LOOKUP (date+product -> batch record) ────────────
    const existingBatchMap = {};
    for (const batch of allBatches) {
      if (batch.is_locked) continue;
      const key = `${batch.production_date}__${normalizeProductName(batch.product_name)}`;
      existingBatchMap[key] = batch;
    }

    // ─── SAVE UPDATED ORDERS (fulfillments, assigned_delivery_date) ────────────
    // Persist fulfillment breakdowns and delivery date assignments back to the database
    const ordersToUpdate = allOrders.filter(o => o.fulfillments || o._deliveryDateAssigned);
    for (const order of ordersToUpdate) {
      if (order.fulfillments || (order._deliveryDateAssigned && !order.assigned_delivery_date)) {
        const updateData = {};
        if (order.fulfillments && order.fulfillments.length > 0) {
          updateData.fulfillments = order.fulfillments;
        }
        if (order._deliveryDateAssigned && !order.assigned_delivery_date) {
          updateData.assigned_delivery_date = order._deliveryDateAssigned;
        }
        if (Object.keys(updateData).length > 0) {
          await base44.asServiceRole.entities.ShopifyOrder.update(order.id, updateData);
        }
      }
    }

    // ─── UPSERT BATCHES ────────────────────────────────────────────────────────
    const results = { created: 0, updated: 0, zeroed: 0, skipped: 0 };

    for (const [key, plan] of Object.entries(planMap)) {
      if (plan.units <= 0) continue;

      const existing = existingBatchMap[key];

      const batchData = {
        product_name: plan.productName,
        product_category: inferProductCategory(plan.productName),
        planned_units: plan.units,
        production_date: plan.productionDate,
        order_sources: plan.sources,
        status: existing?.status || 'Planned',
        assigned_to: existing?.assigned_to || null,
        notes: existing?.notes || null,
        is_locked: false,
        actual_units: existing?.actual_units || null,
      };

      if (existing) {
        // Preserve the existing batch_id
        batchData.batch_id = existing.batch_id;
        await base44.asServiceRole.entities.ProductionBatch.update(existing.id, batchData);
        results.updated++;
        delete existingBatchMap[key]; // mark as handled
      } else {
        // Create new batch
        const datePart = plan.productionDate.replace(/-/g, '');
        const productPart = plan.productName.replace(/\s+/g, '').toUpperCase().slice(0, 8);
        batchData.batch_id = `BATCH-${datePart}-${productPart}`;
        await base44.asServiceRole.entities.ProductionBatch.create(batchData);
        results.created++;
      }
    }

    // ─── ZERO OUT / DELETE STALE BATCHES (no longer needed) ───────────────────
    // Remaining keys in existingBatchMap were not in planMap — no orders for them
    for (const [key, batch] of Object.entries(existingBatchMap)) {
      const prodDateObj = new Date(batch.production_date + 'T00:00:00');
      if (prodDateObj >= today && !batch.is_locked) {
        // Delete batches that have no orders
        await base44.asServiceRole.entities.ProductionBatch.delete(batch.id);
        results.zeroed++;
      } else {
        results.skipped++;
      }
    }

    return Response.json({
      success: true,
      results,
      total_planned_entries: Object.keys(planMap).length,
      message: `Recalculated: ${results.created} created, ${results.updated} updated, ${results.zeroed} removed, ${results.skipped} skipped (past/locked)`,
    });
  } catch (error) {
    console.error('[RECALC]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});