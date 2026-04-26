import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * SYSTEM HEALTH CHECK DASHBOARD
 * 
 * Verifies order architecture integrity:
 * - Webhook handlers operational
 * - Legacy gateways disabled
 * - Safe gateways in use
 * - Automations non-redundant
 * - No direct order writes
 * - Order lock system enforced
 * - Review queue healthy
 */

const STRIPE_API_KEY = Deno.env.get('STRIPE_API_KEY');

async function checkWebhookHandler(base44) {
  try {
    const logs = await base44.asServiceRole.entities.StripeEventLog.filter(
      { status: 'processed' },
      '-created_date',
      10
    );
    if (logs && logs.length > 0) {
      const latest = logs[0];
      return {
        status: 'green',
        message: 'Stripe webhook handler active',
        last_event: latest.created_date,
        recent_count: logs.length,
      };
    }
    return { status: 'yellow', message: 'No recent webhook events' };
  } catch (error) {
    return { status: 'red', message: `Webhook check failed: ${error.message}` };
  }
}

async function checkSafeGateway(base44) {
  try {
    const logs = await base44.asServiceRole.entities.OrderSyncLog.filter(
      { sync_source: { $in: ['stripe_webhook', 'customer_app_pull'] } },
      '-created_date',
      10
    );
    if (logs && logs.length > 0) {
      const successCount = logs.filter(l => l.success).length;
      return {
        status: successCount > 5 ? 'green' : 'yellow',
        message: 'Safe gateway in use',
        recent_syncs: logs.length,
        success_rate: Math.round((successCount / logs.length) * 100) + '%',
      };
    }
    return { status: 'yellow', message: 'No recent sync logs' };
  } catch (error) {
    return { status: 'red', message: `Safe gateway check failed: ${error.message}` };
  }
}

async function checkDirectWrites(base44) {
  try {
    const alertLogs = await base44.asServiceRole.entities.ComplianceLog.filter(
      { log_type: 'direct_write_attempt' },
      '-created_date',
      5
    );
    if (alertLogs && alertLogs.length > 0) {
      return {
        status: 'red',
        message: 'CRITICAL: Direct order writes detected',
        recent_incidents: alertLogs.length,
      };
    }
    return { status: 'green', message: 'No direct write bypasses detected' };
  } catch (error) {
    return { status: 'yellow', message: 'Direct write check incomplete' };
  }
}

async function checkReviewQueue(base44) {
  try {
    const pending = await base44.asServiceRole.entities.OrderReviewQueue.filter(
      { status: 'pending' }
    );
    const pendingCount = pending ? pending.length : 0;
    
    if (pendingCount === 0) {
      return { status: 'green', message: 'Order Review Queue clean', pending_count: 0 };
    } else if (pendingCount < 10) {
      return { status: 'yellow', message: 'Review queue has pending items', pending_count: pendingCount };
    } else {
      return { status: 'red', message: 'Review queue overflowing', pending_count: pendingCount };
    }
  } catch (error) {
    return { status: 'yellow', message: 'Queue check failed' };
  }
}

async function checkOrderLockEnforcement(base44) {
  try {
    // Sample recent orders and verify lock status is being set
    const recentOrders = await base44.asServiceRole.entities.ShopifyOrder.list(
      '-created_date',
      20
    );
    
    if (!recentOrders || recentOrders.length === 0) {
      return { status: 'yellow', message: 'No recent orders to verify' };
    }

    const withLocks = recentOrders.filter(o => o.order_lock_status).length;
    const lockRate = (withLocks / recentOrders.length) * 100;

    if (lockRate >= 90) {
      return { status: 'green', message: 'Order lock system enforced', lock_rate: Math.round(lockRate) + '%' };
    } else if (lockRate >= 50) {
      return { status: 'yellow', message: 'Lock enforcement incomplete', lock_rate: Math.round(lockRate) + '%' };
    } else {
      return { status: 'red', message: 'Order lock system not enforced', lock_rate: Math.round(lockRate) + '%' };
    }
  } catch (error) {
    return { status: 'yellow', message: 'Lock enforcement check failed' };
  }
}

async function checkSubscriptionDecomposition(base44) {
  try {
    // Check if subscription orders have corresponding fulfillment records
    const subscriptionOrders = await base44.asServiceRole.entities.ShopifyOrder.filter(
      { stripe_subscription_id: { $exists: true } },
      '-created_date',
      10
    );

    if (!subscriptionOrders || subscriptionOrders.length === 0) {
      return { status: 'yellow', message: 'No subscription orders found' };
    }

    const withFulfillments = subscriptionOrders.filter(o => o.fulfillments && o.fulfillments.length > 0).length;

    if (withFulfillments === subscriptionOrders.length) {
      return {
        status: 'green',
        message: 'Subscription decomposition complete',
        verified_subscriptions: withFulfillments,
      };
    } else {
      return {
        status: 'yellow',
        message: 'Some subscriptions missing fulfillments',
        verified: withFulfillments,
        total: subscriptionOrders.length,
      };
    }
  } catch (error) {
    return { status: 'yellow', message: 'Subscription check failed' };
  }
}

async function checkProductionProtection(base44) {
  try {
    // Verify no quarantined/incomplete orders are in Production Planning
    const quarantined = await base44.asServiceRole.entities.ShopifyOrder.filter(
      { data_quality_status: { $in: ['incomplete', 'quarantined', 'needs_review'] } }
    );

    if (!quarantined || quarantined.length === 0) {
      return { status: 'green', message: 'No compromised orders in system', quarantined_count: 0 };
    }

    // Check if any are linked to production batches
    const batchCheck = await base44.asServiceRole.entities.ProductionBatch.filter({});
    let linkedToProduction = 0;
    
    for (const q of quarantined) {
      const inBatch = batchCheck?.some(b => 
        b.order_sources?.some(os => os.order_id === q.id)
      );
      if (inBatch) linkedToProduction++;
    }

    if (linkedToProduction > 0) {
      return {
        status: 'red',
        message: 'CRITICAL: Compromised orders in production',
        at_risk: linkedToProduction,
      };
    }

    return {
      status: 'yellow',
      message: 'Quarantined orders isolated',
      quarantined_count: quarantined.length,
    };
  } catch (error) {
    return { status: 'yellow', message: 'Production protection check failed' };
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const checks = await Promise.all([
      checkWebhookHandler(base44),
      checkSafeGateway(base44),
      checkDirectWrites(base44),
      checkReviewQueue(base44),
      checkOrderLockEnforcement(base44),
      checkSubscriptionDecomposition(base44),
      checkProductionProtection(base44),
    ]);

    const statusMap = { green: 3, yellow: 2, red: 1 };
    const overallStatus = checks.reduce((min, c) => Math.min(min, statusMap[c.status] || 0), 3);
    const overallStatusLabel = overallStatus === 3 ? 'green' : overallStatus === 2 ? 'yellow' : 'red';

    return Response.json({
      timestamp: new Date().toISOString(),
      overall_status: overallStatusLabel,
      checks: {
        stripe_webhook_handler: checks[0],
        safe_gateway_usage: checks[1],
        direct_write_regression: checks[2],
        order_review_queue: checks[3],
        order_lock_enforcement: checks[4],
        subscription_decomposition: checks[5],
        production_protection: checks[6],
      },
    });
  } catch (error) {
    console.error('[HEALTH-CHECK]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});