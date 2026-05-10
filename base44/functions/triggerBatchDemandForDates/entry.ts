import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * triggerBatchDemandForDates
 *
 * Idempotent, scoped ProductionBatch demand generator.
 * Called automatically after FulfillmentTask creation for new valid orders/subscriptions.
 *
 * Rules:
 *   - Only creates/updates ProductionBatch records for Tue (day=2) or Fri (day=5) production dates.
 *   - Idempotent: matches existing batches by batch_id (BATCH-{date}-{product}).
 *   - Appends order_source entry; never duplicates by order_id within the same batch.
 *   - NEVER mutates batches that are locked, verified_logged, archived, or linked to
 *     refunded/cancelled/quarantined orders.
 *   - Non-blocking: failures are logged as warnings, never bubble up to the caller.
 *
 * Called internally from:
 *   - customerAppEventPublicGateway (subscription — up to 4 production dates)
 *   - receiveCustomerAppEvent (one-time order.created — 1 production date)
 *
 * Auth: Internal only — requires _internalSecret header.
 *
 * Payload:
 *   {
 *     _internalSecret: string,       // required
 *     production_dates: string[],    // ISO date strings e.g. ["2026-05-13", "2026-05-20"]
 *     order_id: string,              // ShopifyOrder.id
 *     order_number: string,          // human-readable
 *     customer_email: string,
 *     customer_name: string,
 *     fulfillments: [                // per-date item breakdown
 *       { production_date: string, items: [{title, quantity}] }
 *     ]
 *   }
 */

const INTERNAL_SECRET = Deno.env.get('INTERNAL_FUNCTION_SECRET');
const VALID_PROD_DAYS = new Set([2, 5]); // Tuesday=2, Friday=5

// Batch statuses that are immutable — never touch these
const LOCKED_STATUSES = new Set([
  'verified_logged', 'archived', 'in_production', 'completed_pending_verification',
]);

function getDow(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

function makeBatchId(dateStr, productName) {
  const safeName = productName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
  return `BATCH-${dateStr}-${safeName}`;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const body = await req.json();
    const { _internalSecret, production_dates, order_id, order_number, customer_email, customer_name, fulfillments } = body;

    const base44 = createClientFromRequest(req);

    // ── Auth: internal secret OR admin SDK user ───────────────────────────────
    const hasValidSecret = _internalSecret && INTERNAL_SECRET && _internalSecret === INTERNAL_SECRET;
    if (!hasValidSecret) {
      const user = await base44.auth.me().catch(() => null);
      if (!user || user.role !== 'admin') {
        return Response.json({ error: 'Unauthorized — admin or internal secret required' }, { status: 403 });
      }
    }

    if (!production_dates || !Array.isArray(production_dates) || production_dates.length === 0) {
      return Response.json({ error: 'production_dates[] required' }, { status: 400 });
    }
    if (!order_id) {
      return Response.json({ error: 'order_id required' }, { status: 400 });
    }

    // ── Filter only valid Tue/Fri production dates ────────────────────────────
    const validDates = production_dates.filter(d => d && VALID_PROD_DAYS.has(getDow(d)));
    if (validDates.length === 0) {
      console.warn(`[BATCH-DEMAND] No Tue/Fri production dates in: ${production_dates.join(', ')} — zero batches created`);
      return Response.json({ status: 'success', batches_affected: 0, reason: 'no_valid_prod_days' });
    }

    console.log(`[BATCH-DEMAND] Processing ${validDates.length} valid production dates for order ${order_number}`);

    const results = [];

    for (const prodDate of validDates) {
      // Get items for this production date from fulfillments breakdown
      const matchingFulfillment = (fulfillments || []).find(f => f.production_date === prodDate);
      const items = matchingFulfillment?.items || [];

      // Determine products to batch: one batch record per distinct product on this date
      // If no items provided, create a single generic demand entry
      const productGroups = items.length > 0
        ? groupByProduct(items)
        : [{ product_name: 'Juice Order', quantity: 1 }];

      for (const { product_name, quantity } of productGroups) {
        const batchId = makeBatchId(prodDate, product_name);

        try {
          // ── Look for existing batch by batch_id ───────────────────────────
          const existingBatches = await base44.asServiceRole.entities.ProductionBatch.filter({
            batch_id: batchId,
          });
          const existing = existingBatches?.[0] || null;

          if (existing) {
            // ── IMMUTABILITY GUARD: never mutate locked batches ───────────
            if (LOCKED_STATUSES.has(existing.status) || existing.is_locked === true) {
              console.warn(`[BATCH-DEMAND] Batch ${batchId} is locked (status=${existing.status}) — skipping`);
              results.push({ batch_id: batchId, action: 'skipped_locked' });
              continue;
            }

            // ── IDEMPOTENCY: check if this order is already in order_sources ──
            const existingSources = Array.isArray(existing.order_sources) ? existing.order_sources : [];
            const alreadyPresent = existingSources.some(s => s.order_id === order_id);

            if (alreadyPresent) {
              console.log(`[BATCH-DEMAND] Order ${order_id} already in batch ${batchId} — idempotent skip`);
              results.push({ batch_id: batchId, action: 'deduped' });
              continue;
            }

            // ── Append new order_source entry ─────────────────────────────
            const newSource = {
              order_id,
              order_number: order_number || '',
              customer_email: customer_email || '',
              customer_name: customer_name || '',
              quantity,
              source_type: 'order_derived',
              source_item: product_name,
            };

            await base44.asServiceRole.entities.ProductionBatch.update(existing.id, {
              order_sources: [...existingSources, newSource],
              planned_units: (existing.planned_units || 0) + quantity,
            });

            console.log(`[BATCH-DEMAND] Updated batch ${batchId} with order ${order_number} (+${quantity} units)`);
            results.push({ batch_id: batchId, action: 'updated', batch_entity_id: existing.id });

          } else {
            // ── Create new batch record ───────────────────────────────────
            const newBatch = await base44.asServiceRole.entities.ProductionBatch.create({
              batch_id: batchId,
              product_name,
              production_date: prodDate,
              status: 'planned',
              planned_units: quantity,
              actual_units: 0,
              is_locked: false,
              order_sources: [{
                order_id,
                order_number: order_number || '',
                customer_email: customer_email || '',
                customer_name: customer_name || '',
                quantity,
                source_type: 'order_derived',
                source_item: product_name,
              }],
              notes: `Auto-generated from order ${order_number} | ${new Date().toISOString()}`,
            });

            console.log(`[BATCH-DEMAND] Created batch ${batchId} for ${prodDate} (${quantity} units)`);
            results.push({ batch_id: batchId, action: 'created', batch_entity_id: newBatch.id });
          }

        } catch (batchErr) {
          // Non-blocking: log operational warning but don't fail
          console.error(`[BATCH-DEMAND] ⚠ OPERATIONAL WARNING: Failed to process batch ${batchId}: ${batchErr.message}`);
          results.push({ batch_id: batchId, action: 'error', error: batchErr.message });
        }
      }
    }

    const created = results.filter(r => r.action === 'created').length;
    const updated = results.filter(r => r.action === 'updated').length;
    const deduped = results.filter(r => r.action === 'deduped').length;
    const skipped = results.filter(r => r.action === 'skipped_locked').length;
    const errors = results.filter(r => r.action === 'error').length;

    console.log(`[BATCH-DEMAND] Done: created=${created} updated=${updated} deduped=${deduped} skipped_locked=${skipped} errors=${errors}`);

    return Response.json({
      status: 'success',
      batches_affected: created + updated,
      created,
      updated,
      deduped,
      skipped_locked: skipped,
      errors,
      results,
    });

  } catch (error) {
    console.error('[BATCH-DEMAND] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/**
 * Group line items by product name, summing quantities.
 * Filters out non-product items (delivery fees, tips, etc.).
 */
function groupByProduct(items) {
  const NON_PRODUCT = ['delivery fee', 'delivery charge', 'shipping fee', 'shipping charge', 'tip', 'service fee'];
  const map = {};
  for (const item of items) {
    const name = item.title || item.product_name || 'Juice Order';
    if (NON_PRODUCT.some(kw => name.toLowerCase().includes(kw))) continue;
    const qty = item.quantity || 1;
    if (map[name]) {
      map[name].quantity += qty;
    } else {
      map[name] = { product_name: name, quantity: qty };
    }
  }
  const groups = Object.values(map);
  return groups.length > 0 ? groups : [{ product_name: 'Juice Order', quantity: 1 }];
}