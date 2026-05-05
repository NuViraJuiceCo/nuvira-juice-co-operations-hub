import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const APPROVED_PATCHES = [
  {
    fulfillment_task_id: "69f6faa0690e14bb5bf5938a",
    customer: "Jasdeep Gill",
    order_number: "NV-MOOPFCUS",
    patch: { assigned_delivery_date: "2026-05-06" }
  },
  {
    fulfillment_task_id: "69f6faa0690e14bb5bf5938b",
    customer: "Gavandeep Shinger",
    order_number: "NV-MOOV82PT",
    patch: { assigned_delivery_date: "2026-05-06" }
  },
  {
    fulfillment_task_id: "69f77aa2d81dbc896f90ec40",
    customer: "Henrry Robles",
    order_number: "NV-MOPV2CIK",
    patch: { assigned_delivery_date: "2026-05-06" }
  },
  {
    fulfillment_task_id: "69f509d5a1bea46cdce8e274",
    customer: "Sukhwant Kahlon",
    order_number: "SUB-SK-4X-20260425",
    patch: { assigned_delivery_date: "2026-05-16" }
  },
  {
    fulfillment_task_id: "69f509d5a1bea46cdce8e275",
    customer: "Sukhwant Kahlon",
    order_number: "SUB-SK-4X-20260425",
    patch: { assigned_delivery_date: "2026-05-23" }
  }
];

// Guard: skip completed May 2 tasks, cancelled/refunded
const BLOCKED_STATUSES = ['Completed', 'Cancelled', 'Refunded', 'cancelled', 'refunded', 'completed'];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false; // default to dry_run = true for safety

    const results = [];

    for (const patch of APPROVED_PATCHES) {
      const result = {
        fulfillment_task_id: patch.fulfillment_task_id,
        customer: patch.customer,
        order_number: patch.order_number,
        target_date: patch.patch.assigned_delivery_date,
        status: null,
        identity_match: false,
        current_assigned_delivery_date: null,
        blocker: null,
        action: null,
      };

      // Fetch the FulfillmentTask by ID
      let task = null;
      try {
        const all = await base44.entities.FulfillmentTask.filter({ id: patch.fulfillment_task_id });
        task = all?.[0] || null;
      } catch (e) {
        result.status = 'FETCH_ERROR';
        result.blocker = e.message;
        results.push(result);
        continue;
      }

      if (!task) {
        result.status = 'NOT_FOUND';
        result.blocker = 'Record not found in Hub FulfillmentTask entity';
        results.push(result);
        continue;
      }

      result.current_assigned_delivery_date = task.assigned_delivery_date || null;
      result.task_status = task.status;

      // Guard: blocked statuses
      if (BLOCKED_STATUSES.includes(task.status)) {
        result.status = 'BLOCKED';
        result.blocker = `Task status is '${task.status}' — skipping`;
        results.push(result);
        continue;
      }

      // Guard: identity match — verify order_id or customer_name loosely matches
      const orderIdMatch = task.order_id === patch.fulfillment_task_id ||
        (task.order_id && task.order_id.includes(patch.order_number)) ||
        (typeof task.items_summary === 'string' && task.items_summary.length > 0) ||
        true; // FulfillmentTask doesn't store order_number directly; match on record existence + customer_name

      const customerMatch = patch.customer && task.customer_name &&
        task.customer_name.toLowerCase().includes(patch.customer.split(' ')[0].toLowerCase());

      result.identity_match = customerMatch;
      result.found_customer_name = task.customer_name;
      result.found_order_id = task.order_id;

      if (!customerMatch) {
        result.status = 'IDENTITY_MISMATCH';
        result.blocker = `Customer name mismatch: expected '${patch.customer}', found '${task.customer_name}'`;
        results.push(result);
        continue;
      }

      // Already patched?
      if (task.assigned_delivery_date === patch.patch.assigned_delivery_date) {
        result.status = 'ALREADY_CORRECT';
        result.action = 'NO_OP';
        results.push(result);
        continue;
      }

      // Apply patch or dry-run
      if (dryRun) {
        result.status = 'READY_TO_PATCH';
        result.action = `Would set assigned_delivery_date = '${patch.patch.assigned_delivery_date}'`;
      } else {
        try {
          await base44.entities.FulfillmentTask.update(patch.fulfillment_task_id, {
            assigned_delivery_date: patch.patch.assigned_delivery_date
          });
          result.status = 'PATCHED';
          result.action = `Set assigned_delivery_date = '${patch.patch.assigned_delivery_date}'`;
        } catch (e) {
          result.status = 'PATCH_FAILED';
          result.blocker = e.message;
        }
      }

      results.push(result);
    }

    const summary = {
      dry_run: dryRun,
      executed_by: user.email,
      timestamp: new Date().toISOString(),
      records_found: results.filter(r => r.status !== 'NOT_FOUND' && r.status !== 'FETCH_ERROR').length,
      not_found: results.filter(r => r.status === 'NOT_FOUND').length,
      identity_matches: results.filter(r => r.identity_match).length,
      identity_mismatches: results.filter(r => r.status === 'IDENTITY_MISMATCH').length,
      ready_to_patch: results.filter(r => r.status === 'READY_TO_PATCH').length,
      already_correct: results.filter(r => r.status === 'ALREADY_CORRECT').length,
      blocked: results.filter(r => r.status === 'BLOCKED').length,
      patched: results.filter(r => r.status === 'PATCHED').length,
      failed: results.filter(r => r.status === 'PATCH_FAILED').length,
      records: results,
    };

    return Response.json(summary);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});