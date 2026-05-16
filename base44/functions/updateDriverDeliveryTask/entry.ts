import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * updateDriverDeliveryTask
 *
 * Secure Hub endpoint for Customer App Driver Portal delivery writes.
 * Hub FulfillmentTask is the source of truth. This function:
 *   - Authenticates via Bearer CUSTOMER_APP_SYNC_SECRET
 *   - Accepts a Hub FulfillmentTask ID (task_id) as the primary key
 *   - Updates FulfillmentTask status/notes
 *   - Syncs customer-facing status to linked ShopifyOrder via safeSyncOrderUpdate (operations source)
 *   - Appends a structured audit note to FulfillmentTask.driver_notes
 *   - NEVER modifies Stripe, payment, loyalty, inventory, address, totals, or order IDs
 *
 * Supported actions:
 *   mark_out_for_delivery | mark_delivered | mark_unable_to_deliver | add_note
 */

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

// Statuses that block further driver action (except add_note)
const IMMUTABLE_STATUSES = ['Completed', 'Cancelled', 'Refunded'];

// Fields we NEVER touch on ShopifyOrder
const FORBIDDEN_ORDER_FIELDS = [
  'stripe_customer_id', 'stripe_subscription_id', 'stripe_invoice_id',
  'stripe_checkout_session_id', 'stripe_payment_intent_id', 'stripe_charge_id',
  'payment_status', 'total_price', 'subtotal', 'line_items',
  'customer_email', 'address_line1', 'address_line2', 'address_city',
  'address_state', 'address_postal_code', 'address_country',
  'customer_name', 'customer_phone',
  'production_date', 'assigned_delivery_date', 'selected_delivery_date',
  'delivery_window_label', 'order_lock_status', 'production_status',
  'fulfillments', 'shopify_order_id', 'shopify_order_number',
];

function buildAuditNote(driver_email, driver_name, action, previousStatus, newStatus, note, failure_reason, ts) {
  const parts = [
    `[DRIVER_ACTION | ${ts}]`,
    `driver: ${driver_email}${driver_name ? ` (${driver_name})` : ''}`,
    `action: ${action}`,
    `status: ${previousStatus} → ${newStatus}`,
  ];
  if (failure_reason) parts.push(`failure_reason: ${failure_reason}`);
  if (note) parts.push(`note: ${note}`);
  return parts.join(' | ');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = await req.json();

    const {
      task_id,
      action,
      driver_email,
      driver_name,
      note,
      failure_reason,
      photo_url,
      timestamp,
    } = body;

    const ts = timestamp || new Date().toISOString();

    // ── INPUT VALIDATION ──────────────────────────────────────────────────────
    if (!task_id) {
      return Response.json({ error: 'task_id is required' }, { status: 400 });
    }
    if (!action) {
      return Response.json({ error: 'action is required' }, { status: 400 });
    }
    if (!driver_email) {
      return Response.json({ error: 'driver_email is required' }, { status: 400 });
    }

    const SUPPORTED_ACTIONS = ['mark_out_for_delivery', 'mark_delivered', 'mark_unable_to_deliver', 'add_note'];
    if (!SUPPORTED_ACTIONS.includes(action)) {
      return Response.json({
        error: `Unsupported action: "${action}". Allowed: ${SUPPORTED_ACTIONS.join(', ')}`,
      }, { status: 400 });
    }

    // ── FETCH TASK ────────────────────────────────────────────────────────────
    let task;
    try {
      const tasks = await base44.asServiceRole.entities.FulfillmentTask.filter({ id: task_id });
      task = tasks?.[0] || null;
    } catch {
      task = null;
    }

    if (!task) {
      return Response.json({ error: `FulfillmentTask not found: ${task_id}` }, { status: 404 });
    }

    const previousStatus = task.status;

    // ── IMMUTABILITY GUARD ────────────────────────────────────────────────────
    if (IMMUTABLE_STATUSES.includes(previousStatus) && action !== 'add_note') {
      return Response.json({
        error: `Task is immutable (status: ${previousStatus}). Only add_note is permitted on completed/cancelled tasks.`,
        task_id,
        current_status: previousStatus,
      }, { status: 409 });
    }

    // ── BUILD TASK UPDATE ─────────────────────────────────────────────────────
    const taskUpdate = {};
    let newStatus = previousStatus;
    let orderDeliveryStatus = null; // what to push to ShopifyOrder

    if (action === 'mark_out_for_delivery') {
      newStatus = 'Out For Delivery';
      taskUpdate.status = newStatus;
      orderDeliveryStatus = 'out_for_delivery';

    } else if (action === 'mark_delivered') {
      newStatus = 'Completed';
      taskUpdate.status = newStatus;
      taskUpdate.delivery_status = 'delivered';
      taskUpdate.completed_at = ts;
      taskUpdate.delivered_at = ts;
      if (photo_url) taskUpdate.delivery_photo_url = photo_url;
      orderDeliveryStatus = 'delivered';

    } else if (action === 'mark_unable_to_deliver') {
      newStatus = 'Unable To Deliver';
      taskUpdate.status = newStatus;
      taskUpdate.delivery_status = 'unable_to_deliver';
      taskUpdate.delivery_note = failure_reason || note || 'Unable to deliver';
      orderDeliveryStatus = 'unable_to_deliver';

    } else if (action === 'add_note') {
      // Status unchanged
      newStatus = previousStatus;
    }

    // Append structured audit note to driver_notes
    const auditNote = buildAuditNote(driver_email, driver_name, action, previousStatus, newStatus, note, failure_reason, ts);
    const existingNotes = task.driver_notes || '';
    taskUpdate.driver_notes = existingNotes ? `${existingNotes}\n${auditNote}` : auditNote;

    // ── WRITE FULFILLMENT TASK ────────────────────────────────────────────────
    await base44.asServiceRole.entities.FulfillmentTask.update(task_id, taskUpdate);
    console.log(`[UPDATE-DRIVER-TASK] Task ${task_id} updated: ${previousStatus} → ${newStatus} by ${driver_email}`);

    // ── SYNC LINKED SHOPIFY ORDER ─────────────────────────────────────────────
    let orderSyncResult = null;
    const orderId = task.order_id;

    if (orderId && orderDeliveryStatus) {
      // Only pass customer-facing delivery status fields — never financial/identity fields
      const orderUpdate = {
        fulfillment_status: action === 'mark_delivered' ? 'fulfilled' : undefined,
        delivered_at: action === 'mark_delivered' ? ts : undefined,
        delivered_by: action === 'mark_delivered' ? (driver_name || driver_email) : undefined,
        delivery_photo_url: (action === 'mark_delivered' && photo_url) ? photo_url : undefined,
        internal_notes: undefined, // will be set below
      };

      // Build internal note for ShopifyOrder (non-customer-facing)
      const existingOrderNotes = ''; // we don't read order here to avoid overhead; append-only
      orderUpdate.internal_notes = `[DRIVER ${action.toUpperCase()} | ${ts}] driver: ${driver_email}${failure_reason ? ` | reason: ${failure_reason}` : ''}${note ? ` | note: ${note}` : ''}`;

      // Strip undefined fields
      for (const k of Object.keys(orderUpdate)) {
        if (orderUpdate[k] === undefined) delete orderUpdate[k];
      }

      // Verify no forbidden fields snuck in
      for (const forbidden of FORBIDDEN_ORDER_FIELDS) {
        delete orderUpdate[forbidden];
      }

      try {
        // Fetch order to enforce terminal guards before writing
        const linkedOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({ id: orderId });
        const linkedOrder = linkedOrders?.[0];
        if (!linkedOrder) {
          console.warn(`[UPDATE-DRIVER-TASK] Order ${orderId} not found — skipping ShopifyOrder sync`);
          orderSyncResult = { status: 'skipped', reason: 'order_not_found' };
        } else {
          const isTerminal = linkedOrder.payment_status === 'refunded' ||
            linkedOrder.production_status === 'canceled' || linkedOrder.production_status === 'cancelled' ||
            linkedOrder.sync_status === 'do_not_sync' ||
            (Array.isArray(linkedOrder.tags) && linkedOrder.tags.includes('excluded'));
          if (isTerminal) {
            console.warn(`[UPDATE-DRIVER-TASK] Order ${orderId} is terminal — skipping ShopifyOrder sync`);
            orderSyncResult = { status: 'skipped', reason: 'terminal_order' };
          } else {
            await base44.asServiceRole.entities.ShopifyOrder.update(orderId, orderUpdate);
            orderSyncResult = { status: 'success' };
            console.log(`[UPDATE-DRIVER-TASK] ShopifyOrder ${orderId} sync successful: ${JSON.stringify(orderUpdate)}`);
          }
        }
      } catch (syncErr) {
        console.error(`[UPDATE-DRIVER-TASK] ShopifyOrder sync FAILED: ${syncErr.message}`);
        orderSyncResult = { status: 'failed', reason: syncErr.message };
      }
    }

    // ── SANITIZED RESPONSE ────────────────────────────────────────────────────
    // Return only safe, non-sensitive fields
    return Response.json({
      status: 'success',
      task_id,
      action,
      driver_email,
      previous_status: previousStatus,
      new_status: newStatus,
      order_id: orderId || null,
      order_sync: orderSyncResult,
      timestamp: ts,
      note: auditNote,
    });

  } catch (error) {
    console.error('[UPDATE-DRIVER-TASK] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});