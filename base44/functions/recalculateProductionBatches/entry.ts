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
  // fallback: 3 days from now
  const fallback = new Date(d);
  fallback.setDate(d.getDate() + 3);
  return fallback.toISOString().split('T')[0];
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
      return check.toISOString().split('T')[0];
    }
  }
  return d.toISOString().split('T')[0];
}

function normalizeProductName(name) {
  if (!name) return name;
  // Normalize casing: capitalize first letter of each word
  return name.trim().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
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

    // Build bundle lookup map: bundle_name (normalized) -> components
    // Also map exact original names so we can match order line items flexibly
    const bundleMap = {};
    for (const b of allBundles) {
      if (b.is_active !== false) {
        bundleMap[b.bundle_name] = b.components || [];
        bundleMap[normalizeProductName(b.bundle_name)] = b.components || [];
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
        productionDate = getProductionDateForDelivery(order.assigned_delivery_date);
      } else if (order.requested_delivery_date) {
        productionDate = getProductionDateForDelivery(order.requested_delivery_date);
      } else {
        const orderDate = order.customer_order_date ? new Date(order.customer_order_date) : new Date();
        productionDate = getNextProductionDate(orderDate);
      }

      // Skip past production dates
      const prodDateObj = new Date(productionDate + 'T00:00:00');
      if (prodDateObj < today) continue;

      for (const item of order.line_items) {
        const itemTitle = (item.title || '').trim();
        const itemQty = Number(item.quantity) || 0;
        if (itemQty <= 0 || !itemTitle) continue;

        // Check if this line item is a bundle
        const bundleComponents = bundleMap[itemTitle];

        if (bundleComponents && bundleComponents.length > 0) {
          // Decompose bundle into individual products
          for (const component of bundleComponents) {
            const productName = normalizeProductName(component.product_name);
            const componentQty = (Number(component.quantity) || 1) * itemQty;
            const key = `${productionDate}__${productName}`;

            if (lockedKeys.has(key)) continue;

            if (!planMap[key]) {
              planMap[key] = { productionDate, productName, units: 0, sources: [] };
            }
            planMap[key].units += componentQty;
            planMap[key].sources.push({
              order_id: order.id,
              order_number: order.shopify_order_number,
              customer_email: order.customer_email,
              customer_name: order.customer_name || '',
              quantity: componentQty,
              source_type: order.source_channel === 'subscription' ? 'subscription' : 'bundle',
              source_item: itemTitle,
            });
          }
        } else {
          // Direct product line item
          const normalizedTitle = normalizeProductName(itemTitle);
          const key = `${productionDate}__${normalizedTitle}`;
          if (lockedKeys.has(key)) continue;

          if (!planMap[key]) {
            planMap[key] = { productionDate, productName: normalizedTitle, units: 0, sources: [] };
          }
          planMap[key].units += itemQty;
          planMap[key].sources.push({
            order_id: order.id,
            order_number: order.shopify_order_number,
            customer_email: order.customer_email,
            customer_name: order.customer_name || '',
            quantity: itemQty,
            source_type: order.source_channel === 'subscription' ? 'subscription' : 'direct',
            source_item: normalizedTitle,
          });
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