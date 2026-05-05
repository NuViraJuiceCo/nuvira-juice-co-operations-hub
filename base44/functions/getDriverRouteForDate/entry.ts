import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * getDriverRouteForDate — Sanitized, read-only Hub Driver Portal route endpoint
 *
 * Auth:    Bearer CUSTOMER_APP_SYNC_SECRET
 * Method:  POST
 * Input:   { date: "YYYY-MM-DD" }
 * Output:  Sanitized route buckets — NO Stripe, payment, email, phone, or internal fields.
 *
 * Source of truth: Hub FulfillmentTasks via resolveDeliveryScheduleForDate.
 * This is a read-only projection wrapper. It does NOT modify any data.
 */

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

// Fields allowed in the sanitized task output
function sanitizeTask(task) {
  return {
    task_id:               task.fulfillment_task_id || task.id || null,
    order_id:              task.order_id || null,
    order_number:          task.order_number || null,
    customer_name:         task.customer_name || null,
    delivery_address:      task.delivery_address || null,
    address_line1:         task.address_line1 || null,
    address_line2:         task.address_line2 || null,
    city:                  task.address_city || null,
    state:                 task.address_state || null,
    postal_code:           task.address_postal_code || null,
    items:                 (task.items || []).map(i => ({
                             title: i.title,
                             quantity: i.quantity,
                           })),
    items_summary:         task.items_summary || null,
    status:                task.status || null,
    fulfillment_type:      task.fulfillment_type || 'Delivery',
    scheduled_date:        task.scheduled_date || null,
    delivery_window_label: '5 PM – 8 PM',
    time_window:           task.time_window || '17:00 - 20:00',
    source:                task.source || null,
  };
}

Deno.serve(async (req) => {
  try {
    // ── AUTH ────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return Response.json({ error: 'Missing or invalid Authorization header' }, { status: 401 });
    }
    const token = authHeader.slice(7);
    if (!SYNC_SECRET || token !== SYNC_SECRET) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── INPUT ────────────────────────────────────────────────────────────────
    const body = await req.json();
    const date = body.date;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ error: 'date required (YYYY-MM-DD)' }, { status: 400 });
    }

    // ── RESOLVE VIA HUB RESOLVER ─────────────────────────────────────────────
    // Call resolveDeliveryScheduleForDate internally as service role
    const base44 = createClientFromRequest(req);
    const resolved = await base44.asServiceRole.functions.invoke('resolveDeliveryScheduleForDate', {
      selectedDate: date,
    });

    if (!resolved || resolved.error) {
      return Response.json({ error: 'Resolver failed', detail: resolved?.error }, { status: 500 });
    }

    const readyTasks     = (resolved.ready_deliveries     || []).map(sanitizeTask);
    const scheduledTasks = (resolved.scheduled_deliveries || []).map(sanitizeTask);
    const completedTasks = (resolved.completed_deliveries || []).map(sanitizeTask);

    const total = readyTasks.length + scheduledTasks.length + completedTasks.length;
    const left  = readyTasks.length + scheduledTasks.length; // completed excluded from left

    console.log(`[GET-DRIVER-ROUTE] date=${date} ready=${readyTasks.length} scheduled=${scheduledTasks.length} completed=${completedTasks.length}`);

    return Response.json({
      date,
      delivery_window_label: '5 PM – 8 PM',
      counts: {
        ready:     readyTasks.length,
        scheduled: scheduledTasks.length,
        completed: completedTasks.length,
        total,
        left,
      },
      ready_tasks:     readyTasks,
      scheduled_tasks: scheduledTasks,
      completed_tasks: completedTasks,
    });

  } catch (error) {
    console.error('[GET-DRIVER-ROUTE] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});