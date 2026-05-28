import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET') || '';

const TARGET = {
  order_id: '6a188b516e3006cf4112f8e6',
  order_number: 'NV-MPPU43TO',
  customer_email: 'info@nuvirajuice.com',
  current_delivery_date: '2026-05-30',
  current_production_date: '2026-05-29',
  current_window_label: 'Saturday 12 PM - 3 PM',
  target_delivery_date: '2026-06-03',
  target_production_date: '2026-06-02',
  target_window_label: 'Wednesday 5 PM - 8 PM',
};

const CONFIRMATION = 'correct_NV-MPPU43TO_to_2026-06-03';
const TERMINAL_ORDER_STATUSES = new Set(['fulfilled', 'canceled', 'cancelled', 'refunded']);
const TERMINAL_TASK_STATUSES = new Set(['Packed', 'In Transit', 'Out For Delivery', 'Completed', 'Unable To Deliver', 'Cancelled']);
const LOCKED_BATCH_STATUSES = new Set(['verified_logged', 'archived', 'in_production', 'completed_pending_verification']);

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function sanitizeText(value, maxLength = 180) {
  const text = normalizeText(value)
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]');
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function normalizeId(value, fieldName) {
  const text = normalizeText(value);
  if (!text) throw new Error(`${fieldName} is required`);
  if (text.length > 180 || !/^[A-Za-z0-9._:@/-]+$/.test(text)) {
    throw new Error(`${fieldName} contains unsupported characters`);
  }
  return text;
}

function bodyHasUnsupportedKeys(body) {
  const allowed = new Set([
    'dry_run',
    'confirm',
    'request_id',
    'order_id',
    'order_number',
    'target_delivery_date',
    'target_production_date',
    'target_window_label',
    'actor_email',
    'actor_role',
  ]);
  return Object.keys(body || {}).filter((key) => !allowed.has(key));
}

async function resolveActor(base44, req, body) {
  const authHeader = req.headers.get('authorization') || '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  if (CUSTOMER_APP_SYNC_SECRET && bearer === CUSTOMER_APP_SYNC_SECRET) {
    return {
      ok: true,
      actor_email: sanitizeText(body.actor_email, 160) || 'customer-app-admin',
      actor_role: sanitizeText(body.actor_role, 80) || 'admin',
      actor_type: 'system',
    };
  }

  const user = await base44.auth.me().catch(() => null);
  if (user?.role === 'admin') {
    return {
      ok: true,
      actor_email: user.email || 'admin',
      actor_role: user.role,
      actor_type: 'admin',
    };
  }

  return { ok: false };
}

function safeOrderSnapshot(order) {
  if (!order) return null;
  return {
    id: order.id,
    order_number: order.shopify_order_number,
    customer_email: order.customer_email,
    payment_status: order.payment_status || null,
    production_status: order.production_status || null,
    fulfillment_status: order.fulfillment_status || null,
    order_lock_status: order.order_lock_status || null,
    requested_delivery_date: order.requested_delivery_date || null,
    selected_delivery_date: order.selected_delivery_date || null,
    assigned_delivery_date: order.assigned_delivery_date || null,
    production_date: order.production_date || null,
    delivery_window_label: order.delivery_window_label || null,
    fulfillments: Array.isArray(order.fulfillments)
      ? order.fulfillments.map((fulfillment) => ({
          fulfillment_number: fulfillment.fulfillment_number || null,
          production_date: fulfillment.production_date || null,
          delivery_date: fulfillment.delivery_date || null,
          status: fulfillment.status || null,
          item_count: Array.isArray(fulfillment.items) ? fulfillment.items.length : 0,
        }))
      : [],
    audit_trail_count: Array.isArray(order.audit_trail) ? order.audit_trail.length : 0,
  };
}

function safeTaskSnapshot(task) {
  if (!task) return null;
  return {
    id: task.id,
    order_id: task.order_id || null,
    order_number: task.order_number || null,
    status: task.status || null,
    scheduled_date: task.scheduled_date || null,
    production_date: task.production_date || null,
    delivery_window_label: task.delivery_window_label || task.time_window || null,
    assigned_driver: task.assigned_driver || null,
  };
}

function safeBatchSnapshot(batch, sourceCount = null) {
  if (!batch) return null;
  return {
    id: batch.id,
    batch_id: batch.batch_id,
    product_name: batch.product_name,
    status: batch.status || null,
    is_locked: batch.is_locked === true,
    production_date: batch.production_date,
    planned_units: Number(batch.planned_units) || 0,
    order_sources_count: Array.isArray(batch.order_sources) ? batch.order_sources.length : 0,
    matching_order_sources_count: sourceCount,
  };
}

function makeBatchId(dateStr, productName) {
  const safeName = normalizeText(productName).replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
  return `BATCH-${dateStr}-${safeName || 'Juice_Order'}`;
}

function groupSourcesByProduct(sources) {
  const grouped = new Map();
  for (const source of sources) {
    const productName = sanitizeText(source.source_item || source.product_name || 'Juice Order', 120) || 'Juice Order';
    const key = normalizeLower(productName);
    const current = grouped.get(key) || {
      product_name: productName,
      quantity: 0,
      sources: [],
    };
    current.quantity += Number(source.quantity) || 0;
    current.sources.push({ ...source, source_item: source.source_item || productName });
    grouped.set(key, current);
  }
  return Array.from(grouped.values());
}

function orderSourceMatches(source, order) {
  return source?.order_id === order?.id ||
    source?.order_number === TARGET.order_number ||
    normalizeLower(source?.customer_email) === normalizeLower(TARGET.customer_email);
}

function buildCorrectedFulfillments(order) {
  const fulfillments = Array.isArray(order.fulfillments) && order.fulfillments.length > 0
    ? order.fulfillments
    : [{
        fulfillment_number: 1,
        items: Array.isArray(order.line_items) ? order.line_items : [],
        status: 'pending',
        address_line1: order.address_line1 || '',
        address_line2: order.address_line2 || '',
        address_city: order.address_city || '',
        address_state: order.address_state || '',
        address_postal_code: order.address_postal_code || '',
        address_country: order.address_country || 'US',
        delivery_notes: order.delivery_notes || '',
      }];

  return fulfillments.map((fulfillment, index) => {
    if (index !== 0) return fulfillment;
    return {
      ...fulfillment,
      production_date: TARGET.target_production_date,
      delivery_date: TARGET.target_delivery_date,
      status: fulfillment.status || 'pending',
    };
  });
}

async function loadSnapshot(base44) {
  const [orderById, orderByNumber, allTasks, allBatches, commandLogs] = await Promise.all([
    base44.asServiceRole.entities.ShopifyOrder.filter({ id: TARGET.order_id }).catch(() => []),
    base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_number: TARGET.order_number }).catch(() => []),
    base44.asServiceRole.entities.FulfillmentTask.list('-created_date', 300).catch(() => []),
    base44.asServiceRole.entities.ProductionBatch.list('-production_date', 500).catch(() => []),
    base44.asServiceRole.entities.HubCommandLog.filter({ target_display_id: TARGET.order_number }).catch(() => []),
  ]);

  const order = orderById?.[0] || orderByNumber?.[0] || null;
  const tasks = (allTasks || []).filter((task) => task.order_id === order?.id || task.order_number === TARGET.order_number);
  const batchesWithSource = (allBatches || []).map((batch) => {
    const sources = Array.isArray(batch.order_sources) ? batch.order_sources : [];
    const matches = sources.filter((source) => orderSourceMatches(source, order));
    return { batch, matches };
  }).filter((row) => row.matches.length > 0);

  return { order, tasks, allBatches: allBatches || [], batchesWithSource, commandLogs: commandLogs || [] };
}

function validateSnapshot(snapshot) {
  const blockers = [];
  const warnings = [];
  const { order, tasks, batchesWithSource } = snapshot;

  if (!order) blockers.push('order_not_found');
  if (order) {
    if (order.id !== TARGET.order_id) blockers.push('order_id_mismatch');
    if (order.shopify_order_number !== TARGET.order_number) blockers.push('order_number_mismatch');
    if (normalizeLower(order.customer_email) !== normalizeLower(TARGET.customer_email)) blockers.push('customer_email_mismatch');
    if (order.payment_status !== 'paid') blockers.push('payment_not_paid');
    if (TERMINAL_ORDER_STATUSES.has(order.production_status) || TERMINAL_ORDER_STATUSES.has(order.order_status)) blockers.push('order_terminal_status');
    if (order.assigned_delivery_date !== TARGET.current_delivery_date) warnings.push('current_assigned_delivery_date_not_expected');
    if (order.production_date !== TARGET.current_production_date) warnings.push('current_production_date_not_expected');
  }

  for (const task of tasks) {
    if (TERMINAL_TASK_STATUSES.has(task.status)) blockers.push(`task_terminal_status:${task.id}`);
  }

  for (const { batch } of batchesWithSource) {
    if (LOCKED_BATCH_STATUSES.has(batch.status) || batch.is_locked === true) {
      blockers.push(`matching_batch_locked:${batch.batch_id || batch.id}`);
    }
  }

  return { blockers: [...new Set(blockers)], warnings: [...new Set(warnings)] };
}

function buildOrderPatch(order, actor, requestId) {
  const auditEntry = {
    timestamp: new Date().toISOString(),
    action: 'CorrectDeliverySchedule',
    performed_by: actor.actor_email,
    request_id: requestId,
    before: {
      assigned_delivery_date: order.assigned_delivery_date || null,
      selected_delivery_date: order.selected_delivery_date || null,
      requested_delivery_date: order.requested_delivery_date || null,
      production_date: order.production_date || null,
      delivery_window_label: order.delivery_window_label || null,
      fulfillments: Array.isArray(order.fulfillments)
        ? order.fulfillments.map((fulfillment) => ({
            fulfillment_number: fulfillment.fulfillment_number || null,
            production_date: fulfillment.production_date || null,
            delivery_date: fulfillment.delivery_date || null,
          }))
        : [],
    },
    after: {
      assigned_delivery_date: TARGET.target_delivery_date,
      selected_delivery_date: TARGET.target_delivery_date,
      requested_delivery_date: TARGET.target_delivery_date,
      production_date: TARGET.target_production_date,
      delivery_window_label: TARGET.target_window_label,
    },
    reason: 'Customer selected June 3; May 30 was written by stale/conflicting checkout schedule option.',
  };

  return {
    requested_delivery_date: TARGET.target_delivery_date,
    selected_delivery_date: TARGET.target_delivery_date,
    assigned_delivery_date: TARGET.target_delivery_date,
    production_date: TARGET.target_production_date,
    delivery_window_label: TARGET.target_window_label,
    fulfillments: buildCorrectedFulfillments(order),
    manual_override: true,
    manual_override_at: auditEntry.timestamp,
    manual_override_by: actor.actor_email,
    audit_trail: [...(Array.isArray(order.audit_trail) ? order.audit_trail : []), auditEntry],
    internal_notes: `${normalizeText(order.internal_notes)}\n[${auditEntry.timestamp}] Delivery schedule corrected to ${TARGET.target_delivery_date} / production ${TARGET.target_production_date}; request_id=${requestId}.`.trim(),
  };
}

function buildTaskPatch(task, requestId) {
  return {
    scheduled_date: TARGET.target_delivery_date,
    production_date: TARGET.target_production_date,
    time_window: TARGET.target_window_label,
    delivery_window_label: TARGET.target_window_label,
    notes: `${normalizeText(task.notes)}\nDelivery schedule corrected to ${TARGET.target_delivery_date}; production ${TARGET.target_production_date}; request_id=${requestId}.`.trim(),
  };
}

async function applyBatchMoves(base44, snapshot) {
  const movedSources = [];
  const oldBatchUpdates = [];
  const newBatchUpdates = [];

  for (const { batch, matches } of snapshot.batchesWithSource) {
    const existingSources = Array.isArray(batch.order_sources) ? batch.order_sources : [];
    const remainingSources = existingSources.filter((source) => !orderSourceMatches(source, snapshot.order));
    const removedQuantity = matches.reduce((sum, source) => sum + (Number(source.quantity) || 0), 0);
    movedSources.push(...matches);

    const nextPlannedUnits = Math.max(0, (Number(batch.planned_units) || 0) - removedQuantity);
    await base44.asServiceRole.entities.ProductionBatch.update(batch.id, {
      order_sources: remainingSources,
      planned_units: nextPlannedUnits,
      notes: `${normalizeText(batch.notes)}\n[${new Date().toISOString()}] Removed ${TARGET.order_number} from ${TARGET.current_production_date} after delivery date correction to ${TARGET.target_delivery_date}.`.trim(),
    });
    oldBatchUpdates.push({
      batch_id: batch.batch_id,
      removed_sources: matches.length,
      removed_units: removedQuantity,
      planned_units_after: nextPlannedUnits,
    });
  }

  const sourceGroups = movedSources.length > 0
    ? groupSourcesByProduct(movedSources)
    : groupSourcesByProduct((Array.isArray(snapshot.order?.line_items) ? snapshot.order.line_items : []).map((item) => ({
        order_id: snapshot.order.id,
        order_number: TARGET.order_number,
        customer_email: TARGET.customer_email,
        customer_name: snapshot.order.customer_name || '',
        quantity: Number(item.quantity) || 0,
        source_type: 'order_derived',
        source_item: item.title || 'Juice Order',
      })));

  for (const group of sourceGroups) {
    if (!group.quantity) continue;
    const existing = (snapshot.allBatches || []).find((batch) =>
      batch.production_date === TARGET.target_production_date &&
      normalizeLower(batch.product_name) === normalizeLower(group.product_name)
    );

    if (existing && (LOCKED_BATCH_STATUSES.has(existing.status) || existing.is_locked === true)) {
      throw new Error(`target_batch_locked:${existing.batch_id || existing.id}`);
    }

    const newSources = group.sources.map((source) => ({
      ...source,
      order_id: snapshot.order.id,
      order_number: TARGET.order_number,
      customer_email: TARGET.customer_email,
      customer_name: snapshot.order.customer_name || source.customer_name || '',
      source_type: source.source_type || 'order_derived',
      source_item: source.source_item || group.product_name,
    }));

    if (existing) {
      const existingSources = Array.isArray(existing.order_sources) ? existing.order_sources : [];
      const alreadyPresent = existingSources.some((source) => orderSourceMatches(source, snapshot.order));
      if (alreadyPresent) {
        newBatchUpdates.push({ batch_id: existing.batch_id, action: 'deduped' });
        continue;
      }
      await base44.asServiceRole.entities.ProductionBatch.update(existing.id, {
        order_sources: [...existingSources, ...newSources],
        planned_units: (Number(existing.planned_units) || 0) + group.quantity,
        notes: `${normalizeText(existing.notes)}\n[${new Date().toISOString()}] Added ${TARGET.order_number} after delivery date correction to ${TARGET.target_delivery_date}.`.trim(),
      });
      newBatchUpdates.push({
        batch_id: existing.batch_id,
        action: 'updated',
        added_sources: newSources.length,
        added_units: group.quantity,
      });
    } else {
      const batchId = makeBatchId(TARGET.target_production_date, group.product_name);
      const created = await base44.asServiceRole.entities.ProductionBatch.create({
        batch_id: batchId,
        product_name: group.product_name,
        production_date: TARGET.target_production_date,
        status: 'planned',
        planned_units: group.quantity,
        actual_units: 0,
        is_locked: false,
        order_sources: newSources,
        notes: `Auto-created by delivery date correction for ${TARGET.order_number}; ${new Date().toISOString()}`,
      });
      newBatchUpdates.push({
        batch_id: batchId,
        batch_entity_id: created.id,
        action: 'created',
        added_sources: newSources.length,
        added_units: group.quantity,
      });
    }
  }

  return { oldBatchUpdates, newBatchUpdates };
}

async function findExistingCommandLog(base44, requestId) {
  const logs = await base44.asServiceRole.entities.HubCommandLog.filter({ idempotency_key: requestId }).catch(() => []);
  return (logs || []).find((log) =>
    log.command_type === 'correct_order_delivery_schedule' &&
    log.target_display_id === TARGET.order_number
  ) || null;
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const unsupported = bodyHasUnsupportedKeys(body);
    if (unsupported.length > 0) {
      return Response.json({ error: 'unsupported_fields', fields: unsupported.slice(0, 5) }, { status: 400 });
    }

    const actor = await resolveActor(base44, req, body);
    if (!actor.ok) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const requestId = normalizeId(body.request_id, 'request_id');
    const dryRun = body.dry_run !== false;

    if (body.order_id !== TARGET.order_id || body.order_number !== TARGET.order_number) {
      return Response.json({ success: false, error_code: 'target_not_allowlisted' }, { status: 403 });
    }
    if (body.target_delivery_date !== TARGET.target_delivery_date || body.target_production_date !== TARGET.target_production_date) {
      return Response.json({ success: false, error_code: 'target_date_not_allowlisted' }, { status: 403 });
    }

    const existingLog = await findExistingCommandLog(base44, requestId);
    if (existingLog?.status === 'success') {
      return Response.json({
        success: true,
        skipped: true,
        dry_run: dryRun,
        reason: 'duplicate_request_id',
        request_id: requestId,
        hub_command_log_id: existingLog.id,
      });
    }

    const snapshot = await loadSnapshot(base44);
    const validation = validateSnapshot(snapshot);
    const before = {
      order: safeOrderSnapshot(snapshot.order),
      tasks: snapshot.tasks.map(safeTaskSnapshot),
      batches_with_order_sources: snapshot.batchesWithSource.map((row) => safeBatchSnapshot(row.batch, row.matches.length)),
    };

    if (validation.blockers.length > 0) {
      return Response.json({
        success: false,
        dry_run: true,
        live_allowed: false,
        error_code: 'guard_blocked',
        blockers: validation.blockers,
        warnings: validation.warnings,
        before,
      }, { status: 409 });
    }

    const preview = {
      order_patch: {
        assigned_delivery_date: TARGET.target_delivery_date,
        selected_delivery_date: TARGET.target_delivery_date,
        requested_delivery_date: TARGET.target_delivery_date,
        production_date: TARGET.target_production_date,
        delivery_window_label: TARGET.target_window_label,
        fulfillments_first_delivery_date: TARGET.target_delivery_date,
        fulfillments_first_production_date: TARGET.target_production_date,
      },
      task_patch_count: snapshot.tasks.length,
      production_batch_move: {
        from_production_date: TARGET.current_production_date,
        to_production_date: TARGET.target_production_date,
        matching_batch_count: snapshot.batchesWithSource.length,
      },
    };

    if (dryRun) {
      return Response.json({
        success: true,
        dry_run: true,
        live_allowed: true,
        request_id: requestId,
        target: TARGET,
        blockers: [],
        warnings: validation.warnings,
        before,
        preview,
      });
    }

    if (body.confirm !== CONFIRMATION) {
      return Response.json({ success: false, error_code: 'confirmation_required' }, { status: 400 });
    }

    const commandLog = await base44.asServiceRole.entities.HubCommandLog.create({
      command_type: 'correct_order_delivery_schedule',
      command_source: 'customer_app',
      status: 'processing',
      target_entity: 'ShopifyOrder',
      target_id: TARGET.order_id,
      target_display_id: TARGET.order_number,
      actor_email: actor.actor_email,
      actor_role: actor.actor_role,
      actor_type: actor.actor_type,
      payload: {
        order_number: TARGET.order_number,
        from_delivery_date: TARGET.current_delivery_date,
        to_delivery_date: TARGET.target_delivery_date,
        from_production_date: TARGET.current_production_date,
        to_production_date: TARGET.target_production_date,
      },
      idempotency_key: requestId,
      submitted_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      function_name: 'correctHubOrderDeliveryScheduleForCustomerApp',
      related_order_id: TARGET.order_id,
      related_order_number: TARGET.order_number,
      notes: 'One-record correction for checkout schedule mismatch. No notifications/provider/inventory/PO actions.',
    });

    const orderPatch = buildOrderPatch(snapshot.order, actor, requestId);
    await base44.asServiceRole.entities.ShopifyOrder.update(snapshot.order.id, orderPatch);

    const taskResults = [];
    for (const task of snapshot.tasks) {
      await base44.asServiceRole.entities.FulfillmentTask.update(task.id, buildTaskPatch(task, requestId));
      taskResults.push({ id: task.id, action: 'updated' });
    }

    const batchMoveResult = await applyBatchMoves(base44, snapshot);
    const afterSnapshot = await loadSnapshot(base44);
    const after = {
      order: safeOrderSnapshot(afterSnapshot.order),
      tasks: afterSnapshot.tasks.map(safeTaskSnapshot),
      batches_with_order_sources: afterSnapshot.batchesWithSource.map((row) => safeBatchSnapshot(row.batch, row.matches.length)),
    };

    await base44.asServiceRole.entities.HubCommandLog.update(commandLog.id, {
      status: 'success',
      result: {
        order_updated: true,
        task_updates: taskResults,
        production_batch_move: batchMoveResult,
      },
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
    });

    return Response.json({
      success: true,
      skipped: false,
      dry_run: false,
      request_id: requestId,
      hub_command_log_id: commandLog.id,
      before,
      after,
      task_results: taskResults,
      production_batch_move: batchMoveResult,
      side_effects: {
        notifications_sent: false,
        provider_calls: false,
        stripe_calls: false,
        shopify_calls: false,
        inventory_or_po_mutation: false,
        customer_app_records: false,
      },
    });
  } catch (error) {
    console.error('[correctHubOrderDeliveryScheduleForCustomerApp] Error:', error?.message || error);
    return Response.json({ success: false, error_code: 'correction_failed', error: sanitizeText(error?.message || error, 180) }, { status: 500 });
  }
});
