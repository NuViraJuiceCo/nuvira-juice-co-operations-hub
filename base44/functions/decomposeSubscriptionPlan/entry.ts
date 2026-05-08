import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * decomposeSubscriptionPlan — Canonical subscription decomposition helper
 *
 * Returns the per-weekly-fulfillment product quantities for a given plan.
 * This is the SINGLE SOURCE OF TRUTH for subscription decomposition.
 *
 * Rules:
 *   - Monthly Ritual: 1x Aura, 1x Oasis, 1x Re-Nu per weekly fulfillment
 *   - VIP Wellness:   2x Aura, 2x Oasis, 2x Re-Nu per weekly fulfillment
 *   - Both have 4 weekly fulfillments per monthly billing cycle
 *   - Components in the Bundle entity store PER-FULFILLMENT quantities (not totals)
 *   - NEVER multiply per-fulfillment quantities by fulfillment_count
 *
 * Input:  { plan_name, plan_id (optional) }
 * Output: { plan_name, fulfillment_cadence, billing_cadence, fulfillments_per_cycle,
 *           products: [{product_name, quantity}], items_summary, decomposition_version }
 */

// Hardcoded fallback in case Bundle entity lookup fails
const PLAN_DECOMPOSITION_FALLBACK = {
  'Monthly Ritual': {
    fulfillment_cadence: 'weekly',
    billing_cadence: 'monthly',
    fulfillments_per_cycle: 4,
    products: [
      { product_name: 'Aura', quantity: 1 },
      { product_name: 'Oasis', quantity: 1 },
      { product_name: 'Re-Nu', quantity: 1 },
    ],
  },
  'VIP Wellness': {
    fulfillment_cadence: 'weekly',
    billing_cadence: 'monthly',
    fulfillments_per_cycle: 4,
    products: [
      { product_name: 'Aura', quantity: 2 },
      { product_name: 'Oasis', quantity: 2 },
      { product_name: 'Re-Nu', quantity: 2 },
    ],
  },
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { plan_name, plan_id } = body;

    if (!plan_name && !plan_id) {
      return Response.json({ error: 'plan_name or plan_id required' }, { status: 400 });
    }

    // Try to load from Bundle entity first (source of truth)
    let bundle = null;
    if (plan_id) {
      try {
        const bundles = await base44.asServiceRole.entities.Bundle.filter({ id: plan_id });
        bundle = bundles?.[0] || null;
      } catch (e) {
        console.warn('[DECOMPOSE] Bundle lookup by plan_id failed:', e.message);
      }
    }
    if (!bundle && plan_name) {
      try {
        const bundles = await base44.asServiceRole.entities.Bundle.filter({ bundle_name: plan_name });
        bundle = bundles?.[0] || null;
      } catch (e) {
        console.warn('[DECOMPOSE] Bundle lookup by plan_name failed:', e.message);
      }
    }

    let products, fulfillmentsPerCycle, fulfillmentCadence, billingCadence, resolvedPlanName;

    if (bundle) {
      // Use Bundle entity — components already store PER-FULFILLMENT quantities
      // fulfillment_count on the Bundle tells us how many weekly cycles exist
      fulfillmentsPerCycle = bundle.fulfillment_count || 1;
      fulfillmentCadence = fulfillmentsPerCycle > 1 ? 'weekly' : 'monthly';
      billingCadence = 'monthly';
      resolvedPlanName = bundle.bundle_name;

      // Bundle.components are per-fulfillment quantities (corrected 2026-05-08)
      products = (bundle.components || []).map(c => ({
        product_name: c.product_name,
        quantity: c.quantity,
      }));

      console.log(`[DECOMPOSE] Resolved from Bundle entity: ${resolvedPlanName}, ${fulfillmentsPerCycle} weekly fulfillments, products:`, products);
    } else {
      // Fallback to hardcoded map
      const normalizedName = plan_name?.trim();
      const fallback = PLAN_DECOMPOSITION_FALLBACK[normalizedName];

      if (!fallback) {
        return Response.json({
          error: `Unknown plan: "${plan_name}". Supported plans: ${Object.keys(PLAN_DECOMPOSITION_FALLBACK).join(', ')}`,
          status: 404,
        }, { status: 404 });
      }

      products = fallback.products;
      fulfillmentsPerCycle = fallback.fulfillments_per_cycle;
      fulfillmentCadence = fallback.fulfillment_cadence;
      billingCadence = fallback.billing_cadence;
      resolvedPlanName = normalizedName;

      console.log(`[DECOMPOSE] Resolved from fallback map: ${resolvedPlanName}`);
    }

    const items_summary = products.map(p => `${p.quantity}x ${p.product_name}`).join(', ');

    return Response.json({
      status: 'success',
      plan_name: resolvedPlanName,
      plan_id: bundle?.id || plan_id || null,
      fulfillment_cadence: fulfillmentCadence,
      billing_cadence: billingCadence,
      fulfillments_per_cycle: fulfillmentsPerCycle,
      products,
      items_summary,
      decomposition_version: 'v2',
      source: bundle ? 'bundle_entity' : 'fallback_map',
    });

  } catch (error) {
    console.error('[DECOMPOSE]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});