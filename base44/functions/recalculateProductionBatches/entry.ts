import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * NuVira Production Scheduling Rules:
 * Production/juicing days are TUESDAY and FRIDAY ONLY.
 * We do NOT produce on Thursdays, Saturdays, or any other day.
 *
 * Delivery → Production mapping:
 *   Saturday delivery → Friday production (1 day prior)
 *   Wednesday delivery → Tuesday production (1 day prior)
 *
 * General rule: find the nearest valid production day (Tue or Fri)
 * that is STRICTLY BEFORE the delivery date (never same day).
 */

const PRODUCTION_DAYS = [2, 5]; // Tue=2, Fri=5 — NuVira production days ONLY (no Saturday)

// ─── Phase 5: Validate production date day-of-week before creating/updating batches ──
// Only Tue and Fri are valid. If a planMap entry has an invalid production date, skip it.
function isValidNuViraProductionDate(dateStr) {
  if (!dateStr) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 2 || dow === 5; // Tue=2, Fri=5
}

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

/**
 * Map delivery date to production date using NuVira's schedule:
 *   Saturday delivery  → Friday production  (1 day prior)
 *   Wednesday delivery → Tuesday production (1 day prior)
 *
 * Searches STRICTLY backwards (starting at -1) for the nearest
 * valid NuVira production day (Tue=2, Fri=5). Never uses the delivery
 * date itself as the production date.
 *
 * CRITICAL: Do NOT use delivery date as production date.
 * CRITICAL: Sat=6 is NOT a production day.
 */
function getProductionDateForDelivery(deliveryDateStr) {
  const d = new Date(deliveryDateStr + 'T00:00:00');
  // Production is 1 day before delivery — snap backwards to nearest valid production day
  for (let i = 1; i <= 7; i++) {
    const check = new Date(d);
    check.setDate(d.getDate() - i);
    if (PRODUCTION_DAYS.includes(check.getDay())) {
      const result = check.toISOString().split('T')[0];
      return result < FIRST_PRODUCTION_DATE ? FIRST_PRODUCTION_DATE : result;
    }
  }
  // Fallback: 1 day prior
  const fallback = new Date(d);
  fallback.setDate(d.getDate() - 1);
  const fallbackStr = fallback.toISOString().split('T')[0];
  return fallbackStr < FIRST_PRODUCTION_DATE ? FIRST_PRODUCTION_DATE : fallbackStr;
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
    // Allow: admin users OR automation/service-role calls (no user session)
    const user = await base44.auth.me().catch(() => null);
    if (user !== null && user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Load all active orders, fulfillment tasks, bundles, batches, and manual batches
    const [allOrders, allFulfillmentTasks, allBundles, allBatches, allManualBatches] = await Promise.all([
      base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500),
      base44.asServiceRole.entities.FulfillmentTask.list('-created_date', 500),
      base44.asServiceRole.entities.Bundle.list('-updated_date', 100),
      base44.asServiceRole.entities.ProductionBatch.list('-production_date', 500),
      base44.asServiceRole.entities.ManualProductionBatch.list('-production_date', 200),
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

    // ─── DEDUP: Remove any duplicate batches in DB before recalculating ──────────
    // If multiple batches exist for the same date+product, keep the locked one (or newest), delete the rest.
    const seenBatchKeys = new Map();
    for (const batch of allBatches) {
      const key = `${batch.production_date}__${normalizeProductName(batch.product_name)}`;
      if (!seenBatchKeys.has(key)) {
        seenBatchKeys.set(key, batch);
      } else {
        const existing = seenBatchKeys.get(key);
        // Keep locked one; if neither locked, keep newest updated_date
        if (batch.is_locked && !existing.is_locked) {
          await base44.asServiceRole.entities.ProductionBatch.delete(existing.id);
          seenBatchKeys.set(key, batch);
        } else {
          await base44.asServiceRole.entities.ProductionBatch.delete(batch.id);
        }
        console.log(`[RECALC] Removed duplicate batch for key: ${key}`);
      }
    }
    // Rebuild allBatches from deduplicated map
    const dedupedBatches = Array.from(seenBatchKeys.values());

    // Build locked batch set (date+product keys that should not be recalculated)
    const lockedKeys = new Set();
    for (const batch of dedupedBatches) {
      if (batch.is_locked) {
        lockedKeys.add(`${batch.production_date}__${normalizeProductName(batch.product_name)}`);
      }
    }

    // ─── DECOMPOSE ALL ORDERS INTO (date, product, qty, source info) ───────────
    // Map: "YYYY-MM-DD__ProductName" -> { units: number, sources: [] }
    const planMap = {};

    const activeStatuses = ['new', 'awaiting_production', 'scheduled_for_production', 'in_production', 'bottled', 'labeled', 'qc_checked', 'packed', 'in_cold_storage'];

    // Keywords that are NOT producible items — shared across both FulfillmentTask and Order loops
    const NON_PRODUCTION_KEYWORDS = [
      'delivery fee', 'delivery charge', 'shipping fee', 'shipping charge',
      'tip', 'gratuity', 'discount', 'coupon', 'gift card', 'gift wrap',
      'service fee', 'handling fee', 'tax',
    ];

    // Build a set of ShopifyOrder IDs that are active (not excluded) — used to guard FulfillmentTask dedup
    const activeOrderIds = new Set();
    for (const o of allOrders) {
      const isExcludedCheck =
        o.payment_status === 'refunded' ||
        o.production_status === 'refunded' ||
        o.production_status === 'canceled' ||
        o.production_status === 'cancelled' ||
        (Array.isArray(o.tags) && o.tags.includes('excluded')) ||
        o.do_not_recover === true ||
        o.do_not_sync === true;
      if (!isExcludedCheck) activeOrderIds.add(o.id);
    }

    // Build a set of order IDs whose demand will be covered by ShopifyOrder loop.
    // This includes:
    //   - All active one-time orders (source_channel !== 'subscription')
    //   - All active subscription operational ShopifyOrders that have valid fulfillments
    //     (order_type='subscription' OR source_type='subscription_fulfillment' OR source_channel='subscription')
    // FulfillmentTasks linked to any of these orders must NOT be processed as additional
    // production demand — doing so causes double-counting (order + task both contribute).
    const ordersCoveredByOrderLoop = new Set();
    for (const o of allOrders) {
      const isExcludedCheck =
        o.payment_status === 'refunded' ||
        o.production_status === 'refunded' ||
        o.production_status === 'canceled' ||
        o.production_status === 'cancelled' ||
        (Array.isArray(o.tags) && o.tags.includes('excluded')) ||
        o.do_not_recover === true ||
        o.do_not_sync === true;
      if (isExcludedCheck) continue;

      const isSubscriptionOrder =
        o.source_channel === 'subscription' ||
        o.order_type === 'subscription' ||
        o.source_type === 'subscription_fulfillment';

      // Subscription orders with valid fulfillments OR line_items are covered by the ShopifyOrder loop
      const hasProductData = (isSubscriptionOrder && ((o.fulfillments && o.fulfillments.length > 0) || (o.line_items && o.line_items.length > 0)))
        || (!isSubscriptionOrder && o.line_items && o.line_items.length > 0);

      if (hasProductData) {
        ordersCoveredByOrderLoop.add(o.id);
      }
    }

    // CRITICAL: First, process active FulfillmentTasks (subscription fulfillments ONLY)
    // Only process FulfillmentTasks whose linked order is:
    //   (a) excluded/tagged from ShopifyOrder loop (parent SUB order is excluded but task is still active), OR
    //   (b) a subscription order (source_channel='subscription')
    // NEVER process FulfillmentTasks linked to active one-time orders — those are covered by ShopifyOrder loop.
    console.log(`[RECALC] FulfillmentTask loop: ${allFulfillmentTasks.length} tasks to process`);
    for (const task of allFulfillmentTasks) {
      // GUARDRAIL: Only process active/scheduled delivery tasks
      const isActiveTask = task.status && !['Cancelled', 'Completed', 'cancelled', 'completed'].includes(task.status);
      if (!isActiveTask) continue;

      // GUARDRAIL: Skip FulfillmentTasks linked to active one-time orders (covered by ShopifyOrder loop)
      if (task.order_id && ordersCoveredByOrderLoop.has(task.order_id)) {
        console.log(`[RECALC] Skipping FT ${task.id} (${task.customer_name}): linked to active one-time order covered by order loop`);
        continue;
      }

      // Map scheduled_date to production_date (1 day prior)
      const taskDeliveryDate = task.scheduled_date || task.assigned_delivery_date || task.delivery_date;
      if (!taskDeliveryDate) continue;

      const productionDate = getProductionDateForDelivery(taskDeliveryDate);
      const prodDateObj = new Date(productionDate + 'T00:00:00');
      if (prodDateObj < today) continue; // skip past dates

      console.log(`[RECALC] Processing subscription FulfillmentTask ${task.id}: ${task.customer_name} → ${productionDate}`);

      // Extract items from the task — support both items array and items_summary string
      let taskItems = task.items || [];

      // FALLBACK: Parse items_summary if items array is missing
      // Format: "1x Oasis, 1x Aura, 1x Re-Nu"
      // FIX: Strip parenthetical text BEFORE parsing so "1x Oasis (via The NuVira Trio)" → product="Oasis"
      if (taskItems.length === 0 && task.items_summary) {
        const itemParts = task.items_summary.split(',').map(s => s.trim());
        taskItems = itemParts.map(part => {
          // Strip parenthetical text first: "1x Oasis (via The NuVira Trio)" → "1x Oasis"
          const stripped = part.replace(/\s*\(.*?\)/g, '').trim();
          const match = stripped.match(/^(\d+)x\s+(.+)$/);
          if (match) {
            return { title: match[2].trim(), quantity: parseInt(match[1], 10) };
          }
          return null;
        }).filter(Boolean);
      }

      if (taskItems.length === 0) continue;

      // Resolve order_number: prefer shopify_order_number on linked order, else task.order_id (for SUB orders)
      const linkedOrder = allOrders.find(o => o.id === task.order_id);
      const taskOrderNumber = linkedOrder?.shopify_order_number || task.order_number || task.order_id || ('FT-' + task.id.slice(-6));

      for (const item of taskItems) {
        let itemTitle = (item.title || '').trim();
        // Strip any remaining parenthetical text from product names
        itemTitle = itemTitle.replace(/\s*\(.*?\)/g, '').trim();
        if (!itemTitle) continue;

        const qty = Number(item.quantity) || 0;
        if (qty <= 0) continue;

        if (NON_PRODUCTION_KEYWORDS.some(kw => itemTitle.toLowerCase().includes(kw))) continue;

        const normalizedTitle = normalizeProductName(itemTitle);
        const key = `${productionDate}__${normalizedTitle}`;
        if (lockedKeys.has(key)) continue;

        if (!planMap[key]) {
          planMap[key] = { productionDate, productName: normalizedTitle, units: 0, sources: [] };
        }

        // Dedup guard: skip if this exact task is already in sources
        const alreadyAdded = planMap[key].sources.some(s => s.fulfillment_task_id === task.id && s.source_item === normalizedTitle);
        if (alreadyAdded) continue;

        planMap[key].units += qty;
        planMap[key].sources.push({
          order_id: task.order_id || '',
          order_number: taskOrderNumber,
          customer_email: linkedOrder?.customer_email || task.customer_email || '',
          customer_name: task.customer_name || '',
          quantity: qty,
          source_type: 'subscription_fulfillment',
          source_item: normalizedTitle,
          fulfillment_task_id: task.id,
          scheduled_date: taskDeliveryDate,
          production_date: productionDate,
        });
      }
    }

    for (const order of allOrders) {
      // GUARDRAIL: Exclude refunded, cancelled, and test orders from production planning
      const isExcluded =
        order.payment_status === 'refunded' ||
        order.production_status === 'refunded' ||
        order.production_status === 'canceled' ||
        order.production_status === 'cancelled' ||
        (Array.isArray(order.tags) && order.tags.includes('excluded')) ||
        order.do_not_recover === true ||
        order.do_not_sync === true ||
        order.canceled_at ||
        order.deleted_at;
      if (isExcluded) {
        console.log(`[RECALC] Skipping excluded order ${order.shopify_order_number}: refunded/cancelled/test`);
        continue;
      }

      if (!activeStatuses.includes(order.production_status)) continue;

      // GUARDRAIL: Skip already-bottled/produced orders — they are NOT new production needs.
      // bottled, labeled, qc_checked, packed, in_cold_storage = physically produced, just awaiting delivery.
      // EXCEPTION: multi_delivery (subscription) orders — they have multiple future fulfillment instances
      // that still need production even if the current/past instance is packed/bottled.
      // For subscriptions, the per-fulfillment production_date guards (fDateObj < today) handle skipping past instances.
      const alreadyProducedStatuses = ['bottled', 'labeled', 'qc_checked', 'packed', 'in_cold_storage', 'assigned_for_pickup', 'assigned_for_delivery'];
      const isMultiDelivery = order.fulfillment_mode === 'multi_delivery' || order.order_type === 'subscription';
      if (!isMultiDelivery && alreadyProducedStatuses.includes(order.production_status)) {
        console.log(`[RECALC] Skipping already-produced order ${order.shopify_order_number} (${order.production_status}) — not a new production need`);
        continue;
      }
      if (isMultiDelivery && alreadyProducedStatuses.includes(order.production_status)) {
        console.log(`[RECALC] Subscription ${order.shopify_order_number} (${order.production_status}) — continuing to check future fulfillment instances`);
      }

      // CRITICAL FIX: For subscriptions, read from fulfillments directly instead of parent line_items
      // Parent line_items are empty; fulfillments contain the actual weekly quantities
      // Match ALL subscription order variants: source_channel, order_type, source_type
      const isSubscription =
        order.source_channel === 'subscription' ||
        order.order_type === 'subscription' ||
        order.source_type === 'subscription_fulfillment';
      const hasValidFulfillments = isSubscription && order.fulfillments && order.fulfillments.length > 0;
      
      if (isSubscription && !hasValidFulfillments) {
        console.warn(`[RECALC] Subscription ${order.shopify_order_number} (${order.customer_name}) has no fulfillments — skipping`);
        continue;
      }

      if (!isSubscription && (!order.line_items || order.line_items.length === 0)) {
        console.warn(`[RECALC] One-time order ${order.shopify_order_number} has no line_items — skipping`);
        continue;
      }

      // Determine production date for this order.
      // CRITICAL: assigned_delivery_date is the source of truth — it may have been manually
      // corrected (e.g. from Saturday to Wednesday). Always derive production date from it.
      // NEVER use fulfillments[0].production_date as the primary source — it may be stale/past.
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

      // For subscriptions, use fulfillment count from existing fulfillments
      let fulfillmentCount = 1;
      let fulfillmentDates = [];
      
      if (isSubscription && order.fulfillments && order.fulfillments.length > 0) {
        // SUBSCRIPTIONS: Use embedded fulfillments structure
        fulfillmentCount = order.fulfillments.length;
        fulfillmentDates = order.fulfillments.map(f => f.production_date);
        console.log(`[RECALC] Subscription ${order.shopify_order_number} has ${fulfillmentCount} fulfillments from embedded array`);
      } else {
        // ONE-TIME ORDERS: Calculate from metadata
        // Try to get fulfillment count from Bundle metadata
        if (order.line_items && order.line_items.length > 0) {
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
        fulfillmentDates = getSubscriptionProductionDates(productionDate, fulfillmentCount);
      }
      
      // Build fulfillment breakdown for the order (for driver visibility)
      if (isSubscription && fulfillmentCount > 1) {
        const fulfillmentItems = buildFulfillmentItemsMap(order, fulfillmentCount, bundleMap, bundleFullData);
        const fulfillmentsArray = [];

        for (let fi = 0; fi < fulfillmentDates.length; fi++) {
          const fDate = fulfillmentDates[fi];
          // Production day → delivery day mapping:
          // Fri (5) → Sat (6): +1 day
          // Tue (2) → Wed (3) OR Sat (6): use +1 for standard Wed delivery
          const prodDate = new Date(fDate + 'T00:00:00');
          const dayOfWeek = prodDate.getDay();
          const daysToAdd = dayOfWeek === 5 ? 1 : (dayOfWeek === 2 ? 1 : 1); // Fri→Sat, Tue→Wed
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
      } else if (!isSubscription) {
        // One-time orders: decompose bundles if present (into fulfillments.items ONLY)
        // CRITICAL GUARDRAIL: Never update order.line_items for one-time orders during production recalc.
        // line_items = customer-facing product identity (immutable after order placed)
        // fulfillments.items = internal production decomposition (safe to update)
        const fulfillmentItems = buildFulfillmentItemsMap(order, 1, bundleMap, bundleFullData);
        // For address: prefer existing fulfillment address over order top-level if that's blank
        // This prevents recalculate from overwriting fulfillment address with empty strings
        // when the order parent fields are blank but FulfillmentTask has the real address.
        const existingF0Addr = order.fulfillments?.[0];
        const resolvedAddr1 = order.address_line1 || existingF0Addr?.address_line1 || '';
        const resolvedAddr2 = order.address_line2 || existingF0Addr?.address_line2 || '';
        const resolvedCity  = order.address_city  || existingF0Addr?.address_city  || '';
        const resolvedState = order.address_state || existingF0Addr?.address_state || '';
        const resolvedZip   = order.address_postal_code || existingF0Addr?.address_postal_code || '';
        const resolvedCountry = order.address_country || existingF0Addr?.address_country || 'US';

        order.fulfillments = [{
          fulfillment_number: 1,
          production_date: productionDate,
          delivery_date: (() => {
            const d = new Date(productionDate + 'T00:00:00');
            const daysToAdd = 1;
            d.setDate(d.getDate() + daysToAdd);
            return d.toISOString().split('T')[0];
          })(),
          items: fulfillmentItems[0] || [],
          status: 'pending',
          address_line1: resolvedAddr1,
          address_line2: resolvedAddr2,
          address_city: resolvedCity,
          address_state: resolvedState,
          address_postal_code: resolvedZip,
          address_country: resolvedCountry,
          delivery_notes: order.delivery_notes || '',
        }];
        // DO NOT update order.line_items — preserve original customer-facing product
        if (!order.assigned_delivery_date) {
          order._deliveryDateAssigned = order.fulfillments[0].delivery_date;
        }
      }

      // NON_PRODUCTION_KEYWORDS defined above — skip non-producible items

      // CRITICAL FIX: For subscriptions, iterate through fulfillments directly
      // Each fulfillment has its own items with correct weekly quantities.
      // DOUBLE-COUNT GUARD: subscription operational ShopifyOrders are the single source of truth.
      // Their linked FulfillmentTasks are already excluded from the FulfillmentTask loop via ordersCoveredByOrderLoop.
      if (isSubscription && order.fulfillments && order.fulfillments.length > 0) {
        // ─── SUBSCRIPTION: Process fulfillments array ───
        for (let fi = 0; fi < order.fulfillments.length; fi++) {
          const fulfillment = order.fulfillments[fi];
          const fDate = fulfillment.production_date;
          const fDateObj = new Date(fDate + 'T00:00:00');
          if (fDateObj < today) continue; // skip past dates

          const fulfillmentItems = fulfillment.items && fulfillment.items.length > 0
            ? fulfillment.items
            : order.line_items || []; // Fallback only if fulfillment.items is missing

          for (const item of fulfillmentItems) {
            let itemTitle = (item.title || '').trim();
            if (!itemTitle) continue;

            const qty = Number(item.quantity) || 0;
            if (qty <= 0) continue;

            // Skip non-production items (fees, shipping, etc.)
            if (NON_PRODUCTION_KEYWORDS.some(kw => itemTitle.toLowerCase().includes(kw))) continue;

            // Check if this is a bundle (should not be in fulfillments, but check anyway)
            const bundleComponents = findBundleComponents(bundleMap, itemTitle);

            if (bundleComponents && bundleComponents.length > 0) {
              // Decompose bundle into individual products
              for (const component of bundleComponents) {
                const productName = normalizeProductName(component.product_name);
                const componentQty = Math.max(1, Number(component.quantity) || 1);
                const key = `${fDate}__${productName}`;

                if (lockedKeys.has(key)) continue;

                if (!planMap[key]) {
                  planMap[key] = { productionDate: fDate, productName, units: 0, sources: [] };
                }

                // Dedupe guard
                const alreadyAdded = planMap[key].sources.some(
                  s => s.order_id === order.id && s.fulfillment_index === fi + 1 && s.source_item === itemTitle
                );
                if (alreadyAdded) continue;

                planMap[key].units += componentQty;
                planMap[key].sources.push({
                  order_id: order.id,
                  order_number: order.shopify_order_number,
                  customer_email: order.customer_email,
                  customer_name: order.customer_name || '',
                  quantity: componentQty,
                  source_type: 'subscription_fulfillment',
                  source_item: itemTitle,
                  fulfillment_index: fi + 1,
                  fulfillment_total: fulfillmentCount,
                });
              }
            } else {
              // Direct product line item from fulfillment
              const normalizedTitle = normalizeProductName(itemTitle);
              const key = `${fDate}__${normalizedTitle}`;
              if (lockedKeys.has(key)) continue;

              if (!planMap[key]) {
                planMap[key] = { productionDate: fDate, productName: normalizedTitle, units: 0, sources: [] };
              }

              // Dedupe guard: skip if this exact order+fulfillment index is already in sources
              const alreadyAdded = planMap[key].sources.some(
                s => s.order_id === order.id && s.fulfillment_index === fi + 1 && s.source_item === normalizedTitle
              );
              if (alreadyAdded) continue;

              planMap[key].units += qty;
              planMap[key].sources.push({
                order_id: order.id,
                order_number: order.shopify_order_number,
                customer_email: order.customer_email,
                customer_name: order.customer_name || '',
                quantity: qty,
                source_type: 'subscription_fulfillment',
                source_item: normalizedTitle,
                fulfillment_index: fi + 1,
                fulfillment_total: fulfillmentCount,
              });
            }
          }
        }
      } else {
        // ─── ONE-TIME ORDER: Process parent line_items ───
        for (const item of order.line_items) {
          let itemTitle = (item.title || '').trim();
          
          // CRITICAL FIX: Strip Stripe's quantity prefix (e.g., "1 × Monthly Ritual (at $144.00 / month)" → "Monthly Ritual")
          itemTitle = itemTitle.replace(/^\d+\s*×\s*/, '').trim(); // Remove "1 × " prefix
          itemTitle = itemTitle.replace(/\s*\(at\s+\$[\d.]+\s*\/\s*\w+\)/i, '').trim(); // Remove "(at $144.00 / month)"
          itemTitle = itemTitle.replace(/\s*\(\$[\d.,]+.*?\)/i, '').trim(); // Generic price suffix removal
          
          const totalQty = Number(item.quantity) || 0;
          if (totalQty <= 0 || !itemTitle) continue;

          // Skip non-production line items (fees, shipping, etc.)
          if (NON_PRODUCTION_KEYWORDS.some(kw => itemTitle.toLowerCase().includes(kw))) continue;

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
                
                // component.quantity is the TOTAL across all fulfillments in the bundle definition
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
                  source_type: 'bundle',
                  source_item: itemTitle,
                  fulfillment_index: fulfillmentCount > 1 ? fi + 1 : undefined,
                  fulfillment_total: fulfillmentCount > 1 ? fulfillmentCount : undefined,
                });
              }
            } else {
              // Direct product line item, FOR THIS FULFILLMENT ONLY
              const perFulfillmentQty = fulfillmentCount > 1 
                ? Math.round(totalQty / fulfillmentCount) 
                : totalQty;
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
                source_type: 'direct',
                source_item: normalizedTitle,
                fulfillment_index: fulfillmentCount > 1 ? fi + 1 : undefined,
                fulfillment_total: fulfillmentCount > 1 ? fulfillmentCount : undefined,
              });
            }
          }
        }
      }
    }

    // ─── MERGE MANUAL PRODUCTION BATCHES INTO planMap ─────────────────────────
    // Manual batches are internal production needs (not customer orders).
    // They must appear on production cards with source_type='manual_internal_batch'.
    // Only include statuses that represent real production demand.
    // in_production is also active — batch is being made, still counts as production demand until produced
    const MANUAL_ACTIVE_STATUSES = new Set(['active', 'included_in_planning', 'in_production']);
    const activeManualBatches = allManualBatches.filter(b => MANUAL_ACTIVE_STATUSES.has(b.status));
    console.log(`[RECALC] ManualProductionBatch: ${activeManualBatches.length} active of ${allManualBatches.length} total`);

    for (const batch of activeManualBatches) {
      const productionDate = batch.production_date;
      if (!productionDate) continue;

      // Skip past dates — production has already happened or is not actionable
      const prodDateObj = new Date(productionDate + 'T00:00:00');
      if (prodDateObj < today) continue;

      // Phase 5 guard: only valid NuVira production days (Tue=2, Fri=5)
      // Manual batches may be on any date — if it's not a valid prod day, still include
      // (admin explicitly scheduled it, so we respect their date choice)

      for (const item of (batch.items || [])) {
        const rawName = (item.product_name || '').trim();
        if (!rawName) continue;
        const qty = Number(item.quantity) || 0;
        if (qty <= 0) continue;

        const productName = normalizeProductName(rawName);
        const key = `${productionDate}__${productName}`;

        // Don't override locked customer batches — add to them instead
        // Locked keys are customer-only locks; manual demand still counts on top

        if (!planMap[key]) {
          planMap[key] = { productionDate, productName, units: 0, sources: [] };
        }

        // Dedup guard: skip if this exact manual batch item is already in sources
        const alreadyAdded = planMap[key].sources.some(
          s => s.source_type === 'manual_internal_batch' && s.order_id === batch.id && s.source_item === productName
        );
        if (alreadyAdded) continue;

        planMap[key].units += qty;
        planMap[key].sources.push({
          order_id: batch.id,
          order_number: `INTERNAL-${batch.id.slice(-6)}`,
          customer_email: '',
          customer_name: batch.title,
          quantity: qty,
          source_type: 'manual_internal_batch',
          source_item: productName,
          manual_batch_title: batch.title,
          manual_batch_purpose: batch.purpose || '',
        });

        console.log(`[RECALC] Manual batch "${batch.title}" → ${qty}× ${productName} on ${productionDate}`);
      }
    }

    // ─── BUILD EXISTING BATCH LOOKUP (date+product -> batch record) ────────────
    // IMPORTANT: Include ALL batches (including locked) so we never create duplicates.
    // Locked batches will be found here and skipped at update time, not at lookup time.
    // CRITICAL: Match on BOTH date+product AND batch_id to prevent duplicate batch IDs in DB
    const existingBatchMap = {};
    const existingBatchIdSet = new Set(); // Track batch_id values to prevent duplicates
    for (const batch of dedupedBatches) {
      const key = `${batch.production_date}__${normalizeProductName(batch.product_name)}`;
      // If duplicate keys exist in DB, prefer the locked one, then the most recently updated
      if (!existingBatchMap[key]) {
        existingBatchMap[key] = batch;
        existingBatchIdSet.add(batch.batch_id); // Track this batch_id
      } else if (batch.is_locked && !existingBatchMap[key].is_locked) {
        existingBatchIdSet.delete(existingBatchMap[key].batch_id); // Remove old batch_id
        existingBatchMap[key] = batch;
        existingBatchIdSet.add(batch.batch_id); // Add new batch_id
      }
    }

    // ─── SAVE UPDATED ORDERS (fulfillments only — never overwrite identity/payment/address fields) ────────────
    // GUARDRAIL: Only update fulfillments and assigned_delivery_date.
    // NEVER overwrite: payment_status, address_*, customer_*, production_status, delivery_status, ready_for_driver.
    // These are owned by the source of truth (Stripe/Customer App) or Systems Control repairs.
    // CRITICAL: Only write if data has materially changed (write-diff guard to prevent unnecessary updates).
    const PROTECTED_FIELDS = new Set([
      'payment_status', 'production_status', 'delivery_status', 'ready_for_driver',
      'address_line1', 'address_line2', 'address_city', 'address_state', 'address_postal_code',
      'address_country', 'customer_name', 'customer_email', 'customer_phone',
      'stripe_payment_intent_id', 'stripe_customer_id', 'total_price', 'subtotal',
      'line_items', 'order_lock_status', 'internal_notes',
    ]);
    const ordersToUpdate = allOrders.filter(o => o.fulfillments || o._deliveryDateAssigned);
    let ordersWritten = 0;
    let ordersSkipped = 0;
    for (const order of ordersToUpdate) {
      const updateData = {};
      if (order.fulfillments && order.fulfillments.length > 0) {
        updateData.fulfillments = order.fulfillments;
      }
      if (order._deliveryDateAssigned && !order.assigned_delivery_date) {
        updateData.assigned_delivery_date = order._deliveryDateAssigned;
      }
      // Strip any protected fields that may have been accidentally included
      for (const f of PROTECTED_FIELDS) delete updateData[f];
      if (Object.keys(updateData).length > 0) {
        // WRITE-DIFF GUARD: Only write if data has materially changed
        let hasChange = false;
        if (updateData.fulfillments) {
          const existingJson = JSON.stringify(order.fulfillments || []);
          const incomingJson = JSON.stringify(updateData.fulfillments);
          hasChange = existingJson !== incomingJson;
        }
        if (updateData.assigned_delivery_date && order.assigned_delivery_date !== updateData.assigned_delivery_date) {
          hasChange = true;
        }
        
        if (hasChange) {
          try {
            await base44.asServiceRole.entities.ShopifyOrder.update(order.id, updateData);
            ordersWritten++;
          } catch (err) {
            console.warn(`[RECALC] Failed to update fulfillments for order ${order.id}: ${err.message}`);
          }
        } else {
          ordersSkipped++;
        }
      }
    }
    console.log(`[RECALC] Order updates: ${ordersWritten} written, ${ordersSkipped} skipped (no material change)`);

    // ─── UPSERT BATCHES ────────────────────────────────────────────────────────
    const results = { created: 0, updated: 0, zeroed: 0, skipped: 0 };

    for (const [key, plan] of Object.entries(planMap)) {
      if (plan.units <= 0) continue;

      // ── Phase 5 Guard: Skip batches with invalid production dates ───────────
      if (!isValidNuViraProductionDate(plan.productionDate)) {
        console.warn(`[RECALC] ⚠ Phase 5 guard: skipping batch for invalid production date ${plan.productionDate} (${plan.productName}) — not Tue or Fri`);
        results.skipped++;
        continue;
      }

      const existing = existingBatchMap[key];

      const batchData = {
        product_name: plan.productName,
        product_category: inferProductCategory(plan.productName),
        planned_units: plan.units,
        production_date: plan.productionDate,
        order_sources: plan.sources,
        status: existing?.status || 'planned',
        assigned_to: existing?.assigned_to || null,
        notes: existing?.notes || null,
        is_locked: false,
        actual_units: existing?.actual_units || null,
      };

      if (existing) {
        delete existingBatchMap[key]; // mark as handled regardless of lock status
        if (existing.is_locked) {
          results.skipped++;
          continue; // Never touch locked batches
        }
        // Preserve the existing batch_id
        batchData.batch_id = existing.batch_id;
        await base44.asServiceRole.entities.ProductionBatch.update(existing.id, batchData);
        results.updated++;
      } else {
        // Create new batch — but check if batch_id already exists (dedupe against duplicate batch_ids)
        const datePart = plan.productionDate.replace(/-/g, '');
        const productPart = plan.productName.replace(/\s+/g, '').toUpperCase().slice(0, 8);
        const proposedBatchId = `BATCH-${datePart}-${productPart}`;
        
        // CRITICAL: If batch_id already exists in database, skip creation to avoid duplicates
        if (existingBatchIdSet.has(proposedBatchId)) {
          console.log(`[RECALC] Skipping batch creation: ${proposedBatchId} already exists`);
          results.skipped++;
          continue;
        }
        
        batchData.batch_id = proposedBatchId;
        await base44.asServiceRole.entities.ProductionBatch.create(batchData);
        existingBatchIdSet.add(proposedBatchId); // Track newly created batch_id
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