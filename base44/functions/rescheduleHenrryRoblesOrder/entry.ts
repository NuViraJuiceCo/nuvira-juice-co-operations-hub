import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TARGET = {
  order_number: "NV-MOPV2CIK",
  customer_email: "henrryalbert23@yahoo.com",
  customer_name: "Henrry Robles",
  fulfillment_task_id: "69f77aa2d81dbc896f90ec40",
};

const NEW_SCHEDULE = {
  production_date: "2026-05-08",
  assigned_delivery_date: "2026-05-09",
};

const NOTE_ORDER = "Customer could not receive May 6 delivery. Rescheduled to Friday May 8 production batch with Saturday May 9 delivery.";
const NOTE_TASK  = "Rescheduled from May 6 delivery to May 9 delivery.";

// Abort statuses — do not touch these
const ABORT_STATUSES_ORDER = [
  'in_production', 'bottled', 'labeled', 'qc_checked', 'packed',
  'in_cold_storage', 'assigned_for_pickup', 'assigned_for_delivery',
  'out_for_delivery', 'fulfilled', 'canceled', 'refunded',
  'Cancelled', 'Refunded', 'Delivered', 'Completed'
];
const ABORT_LOCK_LEVELS = ['in_production', 'out_for_delivery', 'fulfilled'];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false;

    const report = {
      dry_run: dryRun,
      executed_by: user.email,
      timestamp: new Date().toISOString(),
      hub_shopify_order: null,
      hub_fulfillment_task: null,
      customer_app_order: null,
      production_batch_check: null,
      blockers: [],
      live_run_safe: false,
    };

    // ── 1. Find Hub ShopifyOrder ──────────────────────────────────────────
    const orders = await base44.entities.ShopifyOrder.filter({ shopify_order_number: TARGET.order_number });
    const order = orders?.[0] || null;

    if (!order) {
      report.blockers.push(`Hub ShopifyOrder not found for order_number ${TARGET.order_number}`);
      return Response.json(report);
    }

    // Identity guard
    if (order.customer_email && !order.customer_email.toLowerCase().includes('henrry') &&
        order.customer_email.toLowerCase() !== TARGET.customer_email.toLowerCase()) {
      report.blockers.push(`Identity mismatch: expected ${TARGET.customer_email}, found ${order.customer_email}`);
      return Response.json(report);
    }

    // Abort status guard
    if (ABORT_STATUSES_ORDER.includes(order.production_status) ||
        ABORT_STATUSES_ORDER.includes(order.fulfillment_status)) {
      report.blockers.push(`Order is in abort status: production_status=${order.production_status}, fulfillment_status=${order.fulfillment_status}`);
      return Response.json(report);
    }
    if (ABORT_LOCK_LEVELS.includes(order.order_lock_status)) {
      report.blockers.push(`Order lock level is '${order.order_lock_status}' — cannot reschedule`);
      return Response.json(report);
    }
    if (order.payment_status && !['paid', 'authorized', 'Paid'].includes(order.payment_status)) {
      report.blockers.push(`Payment status is '${order.payment_status}' — expected paid`);
      return Response.json(report);
    }
    if (order.is_locked) {
      report.blockers.push(`Order record is locked (is_locked=true)`);
      return Response.json(report);
    }

    report.hub_shopify_order = {
      id: order.id,
      order_number: order.shopify_order_number,
      customer_email: order.customer_email,
      customer_name: order.customer_name,
      production_status: order.production_status,
      payment_status: order.payment_status,
      order_lock_status: order.order_lock_status,
      current: {
        assigned_delivery_date: order.assigned_delivery_date,
        production_date: order.production_date || order.assigned_production_date,
        internal_notes: order.internal_notes,
      },
      proposed: {
        assigned_delivery_date: NEW_SCHEDULE.assigned_delivery_date,
        production_date: NEW_SCHEDULE.production_date,
        internal_notes: (order.internal_notes ? order.internal_notes + " | " : "") + NOTE_ORDER,
      },
      action: dryRun ? "DRY_RUN — would update" : "UPDATING",
    };

    // ── 2. Find Hub FulfillmentTask ───────────────────────────────────────
    let task = null;
    try {
      const tasks = await base44.entities.FulfillmentTask.filter({ id: TARGET.fulfillment_task_id });
      task = tasks?.[0] || null;
    } catch (_) {}

    // Fallback: search by email
    if (!task) {
      const tasksByEmail = await base44.entities.FulfillmentTask.filter({ customer_name: TARGET.customer_name });
      task = tasksByEmail?.find(t => t.order_id && t.scheduled_date === "2026-05-06") || tasksByEmail?.[0] || null;
    }

    if (task) {
      const taskAbort = ['Completed', 'Cancelled', 'cancelled', 'completed'];
      if (taskAbort.includes(task.status)) {
        report.blockers.push(`FulfillmentTask status is '${task.status}' — cannot reschedule`);
      } else {
        report.hub_fulfillment_task = {
          id: task.id,
          customer_name: task.customer_name,
          status: task.status,
          current: {
            assigned_delivery_date: task.assigned_delivery_date,
            scheduled_date: task.scheduled_date,
            time_window: task.time_window,
          },
          proposed: {
            assigned_delivery_date: NEW_SCHEDULE.assigned_delivery_date,
            scheduled_date: NEW_SCHEDULE.assigned_delivery_date,
          },
          action: dryRun ? "DRY_RUN — would update" : "UPDATING",
        };
      }
    } else {
      report.hub_fulfillment_task = { status: "NOT_FOUND", note: "No FulfillmentTask found for this customer/date" };
    }

    // ── 3. Find Customer App Order ────────────────────────────────────────
    const CUSTOMER_APP_URL = Deno.env.get("CUSTOMER_APP_API_URL");
    const SYNC_SECRET = Deno.env.get("CUSTOMER_APP_SYNC_SECRET");

    if (CUSTOMER_APP_URL && SYNC_SECRET) {
      try {
        const resp = await fetch(`${CUSTOMER_APP_URL}/api/orders/lookup?order_number=${TARGET.order_number}`, {
          headers: { "x-sync-secret": SYNC_SECRET, "Content-Type": "application/json" },
        });
        if (resp.ok) {
          const data = await resp.json();
          const caOrder = data?.order || data;
          report.customer_app_order = {
            found: true,
            id: caOrder?.id,
            order_number: caOrder?.order_number || caOrder?.shopify_order_number,
            current: {
              assigned_delivery_date: caOrder?.assigned_delivery_date,
              status: caOrder?.status,
              tracker_step: caOrder?.tracker_step,
            },
            proposed: {
              assigned_delivery_date: NEW_SCHEDULE.assigned_delivery_date,
              tracker_step: "Scheduled For Production",
              status: "scheduled_for_production",
            },
            action: dryRun ? "DRY_RUN — would push update" : "PUSHING UPDATE",
          };
        } else {
          report.customer_app_order = { found: false, note: `Customer App returned ${resp.status}` };
        }
      } catch (e) {
        report.customer_app_order = { found: false, note: `Customer App lookup failed: ${e.message}` };
      }
    } else {
      report.customer_app_order = { found: false, note: "CUSTOMER_APP_API_URL or CUSTOMER_APP_SYNC_SECRET not configured" };
    }

    // ── 4. Production Batch Check ─────────────────────────────────────────
    const batches = await base44.entities.ProductionBatch.filter({ production_date: "2026-05-05" });
    const matchingBatch = batches?.find(b =>
      b.order_sources?.some(os => os.order_number === TARGET.order_number || os.customer_email === TARGET.customer_email)
    );
    report.production_batch_check = {
      searched_date: "2026-05-05",
      found_in_batch: !!matchingBatch,
      batch_id: matchingBatch?.batch_id || null,
      batch_status: matchingBatch?.status || null,
      note: matchingBatch
        ? `Order is linked to May 5 batch ${matchingBatch.batch_id} — manual removal from batch may be needed`
        : "Order not found in any May 5 production batch",
    };
    if (matchingBatch && ['in_production', 'completed_pending_verification', 'verified_logged'].includes(matchingBatch.status)) {
      report.blockers.push(`Order is in an active/completed batch ${matchingBatch.batch_id} (status: ${matchingBatch.status}) — cannot reschedule`);
    }

    // ── 5. Apply if live run and no blockers ──────────────────────────────
    if (!dryRun && report.blockers.length === 0) {
      // Update Hub ShopifyOrder
      const orderPatch = {
        assigned_delivery_date: NEW_SCHEDULE.assigned_delivery_date,
        internal_notes: report.hub_shopify_order.proposed.internal_notes,
      };
      // Also patch production_date if field exists
      if (order.assigned_production_date !== undefined) orderPatch.assigned_production_date = NEW_SCHEDULE.production_date;
      if (order.production_date !== undefined) orderPatch.production_date = NEW_SCHEDULE.production_date;

      await base44.entities.ShopifyOrder.update(order.id, orderPatch);
      report.hub_shopify_order.action = "UPDATED";

      // Update Hub FulfillmentTask
      if (task && report.hub_fulfillment_task?.id) {
        await base44.entities.FulfillmentTask.update(task.id, {
          assigned_delivery_date: NEW_SCHEDULE.assigned_delivery_date,
          scheduled_date: NEW_SCHEDULE.assigned_delivery_date,
        });
        report.hub_fulfillment_task.action = "UPDATED";
      }

      // Push to Customer App
      if (CUSTOMER_APP_URL && SYNC_SECRET && report.customer_app_order?.found) {
        try {
          await fetch(`${CUSTOMER_APP_URL}/api/orders/update`, {
            method: "POST",
            headers: { "x-sync-secret": SYNC_SECRET, "Content-Type": "application/json" },
            body: JSON.stringify({
              order_number: TARGET.order_number,
              assigned_delivery_date: NEW_SCHEDULE.assigned_delivery_date,
              tracker_step: "Scheduled For Production",
              status: "scheduled_for_production",
            }),
          });
          report.customer_app_order.action = "PUSHED";
        } catch (e) {
          report.customer_app_order.action = `PUSH_FAILED: ${e.message}`;
        }
      }
    }

    // ── Summary ───────────────────────────────────────────────────────────
    report.records_found = {
      hub_order: !!order,
      hub_task: !!task,
      customer_app_order: report.customer_app_order?.found || false,
    };
    report.current_dates = {
      assigned_delivery_date: order.assigned_delivery_date,
      production_date: order.production_date || order.assigned_production_date,
    };
    report.proposed_new_dates = NEW_SCHEDULE;
    report.live_run_safe = report.blockers.length === 0;

    return Response.json(report);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});