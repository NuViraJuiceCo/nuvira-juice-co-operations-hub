import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_NOTE_LENGTH = 1000;

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeSingleLine(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function normalizeOrderNumber(value) {
  return normalizeText(value).replace(/^#/, '');
}

function orderNumberCandidates(value) {
  const normalized = normalizeOrderNumber(value);
  if (!normalized) return [];
  return [...new Set([normalized, `#${normalized}`])];
}

function normalizeNote(value) {
  return normalizeSingleLine(value);
}

function hasDuplicateRequest(order, requestId) {
  const auditTrail = Array.isArray(order.audit_trail) ? order.audit_trail : [];
  const auditMatch = auditTrail.some(entry => normalizeText(entry?.request_id) === requestId);
  const notesMatch = normalizeText(order.internal_notes).includes(`request_id=${requestId}`);
  return auditMatch || notesMatch;
}

function appendNote(existingNotes, noteLine) {
  const current = normalizeText(existingNotes);
  return current ? `${current}\n${noteLine}` : noteLine;
}

async function findOrder(base44, hubOrderId, orderNumber) {
  if (hubOrderId) {
    const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({ id: hubOrderId }, '-updated_date', 1);
    if (orders?.[0]) return { order: orders[0], matchedBy: 'hub_order_id' };
  }

  for (const candidate of orderNumberCandidates(orderNumber)) {
    const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_number: candidate }, '-updated_date', 1);
    if (orders?.[0]) return { order: orders[0], matchedBy: 'order_number' };
  }

  return { order: null, matchedBy: null };
}

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return Response.json({ error: 'Missing or invalid Authorization header' }, { status: 401 });
    }

    const token = authHeader.slice(7);
    if (!SYNC_SECRET || token !== SYNC_SECRET) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));

    const hubOrderId = normalizeText(body.hub_order_id);
    const orderNumber = normalizeOrderNumber(body.order_number);
    const note = normalizeNote(body.note);
    const actorEmail = normalizeSingleLine(body.actor_email);
    const actorRole = normalizeSingleLine(body.actor_role);
    const source = normalizeSingleLine(body.source);
    const requestId = normalizeSingleLine(body.request_id);

    if (!hubOrderId && !orderNumber) {
      return Response.json({
        error: 'At least one scoped identifier is required',
        required_any_of: ['hub_order_id', 'order_number'],
      }, { status: 400 });
    }

    if (!note) {
      return Response.json({ error: 'note is required' }, { status: 400 });
    }

    if (note.length > MAX_NOTE_LENGTH) {
      return Response.json({ error: `note must be ${MAX_NOTE_LENGTH} characters or fewer` }, { status: 400 });
    }

    if (!actorEmail || !actorRole || source !== 'customer_app_admin' || !requestId) {
      return Response.json({
        error: 'actor_email, actor_role, source="customer_app_admin", and request_id are required',
      }, { status: 400 });
    }

    const { order, matchedBy } = await findOrder(base44, hubOrderId, orderNumber);
    if (!order) {
      return Response.json({
        success: false,
        error: 'Hub order not found',
        request_id: requestId,
      }, { status: 404 });
    }

    if (hasDuplicateRequest(order, requestId)) {
      return Response.json({
        success: true,
        appended: false,
        skipped: true,
        reason: 'duplicate_request_id',
        mutated: false,
        request_id: requestId,
        hub_order_id: order.id || null,
        order_number: order.shopify_order_number || orderNumber || null,
      });
    }

    const timestamp = new Date().toISOString();
    const noteLine = `[CUSTOMER_APP_ADMIN_NOTE | ${timestamp} | request_id=${requestId}] actor: ${actorEmail} | note: ${note}`;
    const updatedInternalNotes = appendNote(order.internal_notes, noteLine);
    const auditEntry = {
      timestamp,
      action: 'customer_app_admin_note_appended',
      performed_by: actorEmail,
      source: 'customer_app_admin',
      request_id: requestId,
      after: { note_appended: true },
      reason: 'Admin internal note from Customer App',
    };

    const existingAuditTrail = Array.isArray(order.audit_trail) ? order.audit_trail : [];
    const updatePayload = {
      internal_notes: updatedInternalNotes,
      audit_trail: [...existingAuditTrail, auditEntry],
    };

    try {
      await base44.asServiceRole.entities.ShopifyOrder.update(order.id, updatePayload);
    } catch (error) {
      console.warn('[APPEND-INTERNAL-NOTE] audit append failed; retrying note-only update:', error.message);
      await base44.asServiceRole.entities.ShopifyOrder.update(order.id, {
        internal_notes: updatedInternalNotes,
      });
    }

    console.log(`[APPEND-INTERNAL-NOTE] appended note to order ${order.shopify_order_number || order.id} via ${matchedBy}`);

    return Response.json({
      success: true,
      appended: true,
      skipped: false,
      reason: null,
      request_id: requestId,
      hub_order_id: order.id || null,
      order_number: order.shopify_order_number || orderNumber || null,
    });
  } catch (error) {
    console.error('[APPEND-INTERNAL-NOTE] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
