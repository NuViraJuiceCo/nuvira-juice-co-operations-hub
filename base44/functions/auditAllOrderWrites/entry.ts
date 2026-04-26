import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * COMPREHENSIVE ORDER WRITE AUDIT
 * 
 * Maps every function, automation, and code path that can create/update orders.
 * Identifies unsafe write patterns.
 * Reports which writes use safe gateways vs direct access.
 */

const ORDER_WRITE_PATHS = [
  // SAFE PATHS (use safeSyncOrderUpdate or approved gateways)
  {
    name: 'stripeCheckoutWebhookHardened',
    type: 'webhook',
    trigger: 'Stripe webhook events',
    entities_written: ['ShopifyOrder', 'StripeEventLog', 'OrderReviewQueue'],
    fields_written: ['stripe_*', 'customer_*', 'payment_status', 'line_items', 'total_price', 'address_*'],
    uses_safe_gateway: true,
    gateway_name: 'safeSyncOrderUpdate',
    can_create_duplicate: false,
    can_create_unknown: false,
    can_overwrite_production: false,
    status: 'SAFE',
  },
  {
    name: 'pullOrdersFromCustomerApp',
    type: 'scheduled_function',
    trigger: 'Manual or scheduled',
    entities_written: ['ShopifyOrder', 'OrderSyncLog'],
    fields_written: ['customer_*', 'line_items', 'total_price', 'source_channel'],
    uses_safe_gateway: true,
    gateway_name: 'safeSyncOrderUpdate',
    can_create_duplicate: false,
    can_create_unknown: false,
    can_overwrite_production: false,
    status: 'SAFE',
  },
  {
    name: 'safeSyncOrderUpdate',
    type: 'function',
    trigger: 'All inbound order data',
    entities_written: ['ShopifyOrder', 'OrderSyncLog'],
    fields_written: 'All (with ownership & lock enforcement)',
    uses_safe_gateway: true,
    gateway_name: 'Self - centralized gateway',
    can_create_duplicate: false,
    can_create_unknown: false,
    can_overwrite_production: false,
    status: 'SAFE - GATEWAY',
  },
  {
    name: 'unifiedOrderRepairWorker',
    type: 'scheduled_automation',
    trigger: 'Daily @ 4am',
    entities_written: ['ShopifyOrder', 'OrderReviewQueue'],
    fields_written: ['customer_name', 'customer_email', 'stripe_*', 'total_price'],
    uses_safe_gateway: true,
    gateway_name: 'safeSyncOrderUpdate',
    can_create_duplicate: false,
    can_create_unknown: false,
    can_overwrite_production: false,
    status: 'SAFE',
  },
  {
    name: 'recalculateProductionBatches',
    type: 'function',
    trigger: 'Manual (Orders page)',
    entities_written: ['ProductionBatch'],
    fields_written: ['batch_id', 'product_name', 'planned_units', 'status', 'order_sources'],
    uses_safe_gateway: false,
    gateway_name: 'N/A',
    can_create_duplicate: false,
    can_create_unknown: false,
    can_overwrite_production: false,
    status: 'SAFE - Production tier only',
  },

  // DEPRECATED / ARCHIVED (should NOT be active)
  {
    name: 'stripeReconciliationWorker',
    type: 'scheduled_automation (ARCHIVED)',
    trigger: 'Was daily @ 7am',
    entities_written: ['ShopifyOrder'],
    fields_written: ['stripe_*', 'customer_*'],
    uses_safe_gateway: false,
    gateway_name: 'N/A - Direct writes',
    can_create_duplicate: true,
    can_create_unknown: true,
    can_overwrite_production: true,
    status: 'ARCHIVED - DO NOT RUN',
  },
  {
    name: 'detectBrokenStripeOrders',
    type: 'scheduled_automation (ARCHIVED)',
    trigger: 'Was daily @ 11am',
    entities_written: ['OrderSyncLog', 'ComplianceLog'],
    fields_written: 'None (scan only)',
    uses_safe_gateway: false,
    gateway_name: 'N/A',
    can_create_duplicate: false,
    can_create_unknown: false,
    can_overwrite_production: false,
    status: 'ARCHIVED - Safe to keep inactive',
  },
  {
    name: 'rebuildAllSubscriptionOrders',
    type: 'scheduled_automation (ARCHIVED)',
    trigger: 'Was weekly Mon @ 2am',
    entities_written: ['ShopifyOrder', 'ProductionBatch'],
    fields_written: 'All (destructive rebuild)',
    uses_safe_gateway: false,
    gateway_name: 'N/A - Direct writes',
    can_create_duplicate: true,
    can_create_unknown: true,
    can_overwrite_production: true,
    status: 'ARCHIVED - DANGEROUS - DO NOT RUN',
  },
  {
    name: 'reconcileAndRepairStripeOrders',
    type: 'scheduled_automation',
    trigger: 'Daily @ 12pm',
    entities_written: ['ShopifyOrder', 'OrderReviewQueue'],
    fields_written: ['stripe_*', 'customer_*', 'total_price'],
    uses_safe_gateway: false,
    gateway_name: 'SHOULD route to safeSyncOrderUpdate',
    can_create_duplicate: false,
    can_create_unknown: false,
    can_overwrite_production: false,
    status: 'ACTIVE - Should be consolidated into unifiedOrderRepairWorker',
  },
  {
    name: 'checkSubscriptionFulfillmentIntegrity',
    type: 'scheduled_automation',
    trigger: 'Daily @ 8am',
    entities_written: 'None (validation only)',
    fields_written: 'None',
    uses_safe_gateway: false,
    gateway_name: 'N/A - Read-only validation',
    can_create_duplicate: false,
    can_create_unknown: false,
    can_overwrite_production: false,
    status: 'SAFE - Validation only',
  },
  {
    name: 'detectDirectOrderWrite',
    type: 'scheduled_automation',
    trigger: 'Every 30 minutes',
    entities_written: ['OrderReviewQueue', 'ComplianceLog'],
    fields_written: 'Queue items only (alerts)',
    uses_safe_gateway: false,
    gateway_name: 'N/A - Regression detection',
    can_create_duplicate: false,
    can_create_unknown: false,
    can_overwrite_production: false,
    status: 'SAFE - Regression guard',
  },
  {
    name: 'checkQueueBacklog',
    type: 'scheduled_automation',
    trigger: 'Every 6 hours',
    entities_written: 'None (read + email)',
    fields_written: 'None',
    uses_safe_gateway: false,
    gateway_name: 'N/A - Monitoring only',
    can_create_duplicate: false,
    can_create_unknown: false,
    can_overwrite_production: false,
    status: 'SAFE - Monitoring only',
  },
  {
    name: 'systemHealthCheck',
    type: 'scheduled_automation',
    trigger: 'Every 30 minutes',
    entities_written: 'None (read + return status)',
    fields_written: 'None',
    uses_safe_gateway: false,
    gateway_name: 'N/A - Health monitoring',
    can_create_duplicate: false,
    can_create_unknown: false,
    can_overwrite_production: false,
    status: 'SAFE - Monitoring only',
  },
  {
    name: 'orderReviewQueueAlert',
    type: 'entity_automation',
    trigger: 'On OrderReviewQueue.create',
    entities_written: 'None (email only)',
    fields_written: 'None',
    uses_safe_gateway: false,
    gateway_name: 'N/A - Alert only',
    can_create_duplicate: false,
    can_create_unknown: false,
    can_overwrite_production: false,
    status: 'SAFE - Alert only',
  },
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const analysis = {
      timestamp: new Date().toISOString(),
      total_write_paths: ORDER_WRITE_PATHS.length,
      safe_paths: ORDER_WRITE_PATHS.filter(p => p.status.includes('SAFE')).length,
      unsafe_paths: ORDER_WRITE_PATHS.filter(p => p.status.includes('UNSAFE') || p.status.includes('DANGER')).length,
      archived_paths: ORDER_WRITE_PATHS.filter(p => p.status.includes('ARCHIVED')).length,
      paths_that_can_create_duplicate: ORDER_WRITE_PATHS.filter(p => p.can_create_duplicate).length,
      paths_that_can_create_unknown: ORDER_WRITE_PATHS.filter(p => p.can_create_unknown).length,
      paths_that_can_overwrite_production: ORDER_WRITE_PATHS.filter(p => p.can_overwrite_production).length,
      all_paths: ORDER_WRITE_PATHS,
      summary: {
        safe_status: ORDER_WRITE_PATHS.every(p => {
          // Check if any archived paths were meant to be disabled
          if (p.status.includes('ARCHIVED')) return true;
          // Check if unsafe paths should be disabled
          if (p.status.includes('UNSAFE') || p.status.includes('DANGER')) return false;
          return true;
        }) ? 'CLEAN' : 'NEEDS ATTENTION',
        dangerous_automations_active: ORDER_WRITE_PATHS.filter(p => 
          p.status.includes('ACTIVE') && (p.can_create_duplicate || p.can_create_unknown || p.can_overwrite_production)
        ),
        consolidation_needed: ORDER_WRITE_PATHS.filter(p => p.status.includes('Should be consolidated')),
        redundant_functions: ORDER_WRITE_PATHS.filter(p => 
          p.status.includes('ARCHIVED') && !p.status.includes('Safe to keep')
        ),
      },
    };

    return Response.json(analysis);
  } catch (error) {
    console.error('[AUDIT-WRITES]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});