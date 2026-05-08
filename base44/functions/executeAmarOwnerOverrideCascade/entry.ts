import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * executeAmarOwnerOverrideCascade
 * One-shot admin function to:
 * 1. Cancel Stripe subscription sub_1TUsq1IrzYHaHkt2JnjTdP5a immediately
 * 2. Issue Stripe refund for charge ch_3TUsq2IrzYHaHkt22NYzcImd ($144)
 * Admin only. Idempotent.
 */

const STRIPE_API_KEY = Deno.env.get('STRIPE_API_KEY');

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const SUBSCRIPTION_ID = 'sub_1TUsq1IrzYHaHkt2JnjTdP5a';
    const CHARGE_ID = 'ch_3TUsq2IrzYHaHkt22NYzcImd';
    const REFUND_AMOUNT = 14400; // cents

    const results = {};

    // 1. Cancel Stripe subscription immediately
    const cancelRes = await fetch(`https://api.stripe.com/v1/subscriptions/${SUBSCRIPTION_ID}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${STRIPE_API_KEY}` },
    });
    const cancelData = await cancelRes.json();
    results.stripe_subscription = {
      status: cancelRes.ok ? 'cancelled' : 'error',
      stripe_status: cancelData.status,
      canceled_at: cancelData.canceled_at ? new Date(cancelData.canceled_at * 1000).toISOString() : null,
      error: cancelRes.ok ? null : cancelData.error?.message,
    };

    // 2. Issue full refund on the charge
    const refundRes = await fetch('https://api.stripe.com/v1/refunds', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `charge=${CHARGE_ID}&amount=${REFUND_AMOUNT}&reason=duplicate&metadata[reason]=internal_test_owner_override&metadata[approved_by]=admin`,
    });
    const refundData = await refundRes.json();
    results.stripe_refund = {
      status: refundRes.ok ? 'refunded' : 'error',
      refund_id: refundData.id || null,
      amount: refundData.amount ? refundData.amount / 100 : null,
      refund_status: refundData.status || null,
      error: refundRes.ok ? null : refundData.error?.message,
    };

    return Response.json({
      timestamp: new Date().toISOString(),
      executed_by: user.email,
      ...results,
      overall: (cancelRes.ok || cancelData.status === 'canceled') && refundRes.ok ? 'SUCCESS' : 'PARTIAL',
    });

  } catch (error) {
    console.error('[AMAR-OVERRIDE-CASCADE]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});