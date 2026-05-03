import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ORDER_ID  = '69f4cb5cc55b645ed2d3cbf7';
const ORDER_NUM = 'NV-MON367R7';
const STRIPE_PI = 'pi_3TSJHyIrzYHaHkt23wIjLu6m';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hub = base44.asServiceRole;

    const before = await hub.entities.ShopifyOrder.get(ORDER_ID);

    if (!before) {
      return Response.json({
        error: 'Order not found',
        order_id: ORDER_ID,
        order_number: ORDER_NUM
      }, { status: 404 });
    }

    if (before?.payment_status === 'paid') {
      return Response.json({
        status: 'already_correct',
        message: `${ORDER_NUM} payment_status is already 'paid'. No write needed.`,
        order_id: ORDER_ID,
        current_payment_status: before?.payment_status
      });
    }

    if (before?.customer_email !== 'gk5c2nxn8m@privaterelay.appleid.com') {
      return Response.json({
        error: `Unexpected customer_email on order ${ORDER_ID}. Aborting for safety.`,
        expected: 'gk5c2nxn8m@privaterelay.appleid.com',
        found: before?.customer_email
      }, { status: 400 });
    }

    await hub.entities.ShopifyOrder.update(ORDER_ID, {
      payment_status: 'paid'
    });

    const after = await hub.entities.ShopifyOrder.get(ORDER_ID);

    const auditRecord = await hub.entities.RepairAuditLog.create({
      timestamp: new Date().toISOString(),
      executed_by: 'Systems Control — Targeted Payment Status Repair (approved_by: admin)',
      user_role: 'system',
      repair_function: 'repairDeepaNV367R7PaymentStatus',
      action: 'correct_payment_status_field',
      records_affected: 1,
      reason: `NV-MON367R7 Hub ShopifyOrder.payment_status was 'pending' despite Stripe PI ${STRIPE_PI} confirming $41.99 succeeded. Prior repair RPR-20260503-DEEPA-PAYMENT wrote internal_notes correctly but did not update the field. Single-field correction. Admin approved 2026-05-03.`,
      changes: {
        order_number: ORDER_NUM,
        order_id: ORDER_ID,
        field_changed: 'payment_status',
        before: before?.payment_status,
        after: after?.payment_status,
        stripe_payment_intent: STRIPE_PI,
        stripe_amount: '$41.99',
        fields_not_changed: [
          'line_items',
          'total_price',
          'customer_email',
          'address',
          'production_status',
          'delivery_status',
          'assigned_delivery_date',
          'order_lock_status'
        ],
        customer_app_touched: false,
        stripe_touched: false
      },
      details: 'Minimal targeted repair. No other fields altered. Loyalty backfill for NV-MON367R7 proceeds separately.'
    });

    return Response.json({
      status: 'success',
      order_id: ORDER_ID,
      order_number: ORDER_NUM,
      before: {
        payment_status: before?.payment_status,
        order_lock_status: before?.order_lock_status,
        production_status: before?.production_status,
        total_price: before?.total_price,
        customer_email: before?.customer_email
      },
      after: {
        payment_status: after?.payment_status,
        order_lock_status: after?.order_lock_status,
        production_status: after?.production_status,
        total_price: after?.total_price,
        customer_email: after?.customer_email
      },
      audit_log_id: auditRecord?.id,
      next_step: 'Run executeLoyaltyPhase1HubSide with dry_run=true'
    });

  } catch (error) {
    return Response.json({
      status: 'error',
      error: error?.message || String(error)
    }, { status: 500 });
  }
});