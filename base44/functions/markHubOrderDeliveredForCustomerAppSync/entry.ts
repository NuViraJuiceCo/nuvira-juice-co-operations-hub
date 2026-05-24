import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const COMMAND = 'hub_order_customer_delivered';
const TARGET_TYPE = 'ShopifyOrder';
const SOURCE = 'customer_app_admin';
const COMMAND_SOURCE = 'customer_app';
const FUNCTION_NAME = 'markHubOrderDeliveredForCustomerAppSync';

const MAX_TEXT_LENGTH = 120;
const MAX_REASON_LENGTH = 300;
const APPROVED_TASK_ID = '6a1311c0bc31d3bd809130aa';
const APPROVED_HUB_ORDER_ID = '6a1311a975183e90a5da8f70';
const APPROVED_ORDER_NUMBER = 'NV-TEST-G15E-DELIVERED';
const APPROVED_TEST_EMAIL = 'delivered-test@nuvirajuice.com';
const APPROVED_SYNTHETIC_ORDER_ID_PREFIX = 'TEST-NONPROVIDER-';
const DELIVERED_TASK_STATUS = 'Completed';
const DELIVERED_TASK_DELIVERY_STATUS = 'delivered';
const FULFILLED_STATUS = 'fulfilled';
const IDEMPOTENT_SUCCESS_STATUSES = new Set(['success', 'skipped']);
const ALLOWED_BODY_KEYS = new Set([
  'fulfillment_task_id',
  'request_id',
  'hub_order_id',
  'reason',
  'actor_email',
  'actor_role',
  'source',
]);
const SAFE_PROVIDER_PAYMENT_KEYS = new Set([
  'payment_status',
  'production_status',
  'fulfillment_status',
  'order_status',
  'order_number',
  'shopify_order_number',
]);
const PROVIDER_PAYMENT_KEY_TERMS = [
  'stripe',
  'shopify',
  'payment_intent',
  'checkout_session',
  'session_id',
  'subscription_id',
  'provider',
  'external_id',
  'gateway',
  'transaction',
  'charge',
  'invoice',
  'payment_method',
  'processor',
  'fulfillment_provider',
];
const CUSTOMER_DATA_KEY_TERMS = [
  'email',
  'contact',
  'customer',
  'recipient',
  'name',
  'phone',
  'address',
  'shipping',
  'billing',
  'street',
  'city',
  'state',
  'zip',
  'postal',
  'apartment',
  'unit',
  'lat',
  'lng',
  'longitude',
  'latitude',
  'geo',
];
const PROOF_DROP_KEY_TERMS = [
  'proof',
  'photo',
  'image',
  'file',
  'attachment',
  'upload',
  'drop',
  'dropoff',
  'drop_location',
  'delivery_photo',
  'delivery_proof',
];

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeSingleLine(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function normalizeLower(value) {
  return normalizeSingleLine(value).toLowerCase();
}

function normalizeEmail(value) {
  const email = normalizeSingleLine(value).toLowerCase();
  if (!email || email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

function normalizeOrderNumber(value) {
  return normalizeSingleLine(value).replace(/^#/, '').toUpperCase();
}

function sanitizeText(value, maxLength = MAX_TEXT_LENGTH) {
  const text = normalizeSingleLine(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl)\b/gi, '[redacted address]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]');

  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function sanitizeMetadataValue(value, maxLength = MAX_TEXT_LENGTH) {
  const text = normalizeSingleLine(value)
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]');

  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function normalizeId(value, fieldName, required = true) {
  const text = normalizeSingleLine(value);
  if (!text) {
    if (required) throw new Error(`${fieldName} is required`);
    return '';
  }
  if (text.length > 160 || !/^[A-Za-z0-9._:@/-]+$/.test(text)) {
    throw new Error(`${fieldName} contains unsupported characters`);
  }
  return text;
}

function normalizeReason(value) {
  return sanitizeText(value, MAX_REASON_LENGTH);
}

function normalizeActorEmail(value) {
  const email = normalizeSingleLine(value).toLowerCase();
  if (!email) return 'customer_app_admin';
  if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('actor_email must be a valid email address');
  }
  return email;
}

function normalizeActorRole(value) {
  const role = sanitizeMetadataValue(value, 60);
  return role || 'admin';
}

function normalizeSource(value) {
  const source = normalizeLower(value || SOURCE);
  if (source !== SOURCE) throw new Error('source must be customer_app_admin');
  return source;
}

function isValidIsoTimestamp(value) {
  const text = normalizeSingleLine(value);
  return Boolean(text && !Number.isNaN(Date.parse(text)));
}

function findUnsupportedBodyKey(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const key of Object.keys(body)) {
    const normalized = normalizeLower(key);
    if (!ALLOWED_BODY_KEYS.has(normalized)) return key;
  }
  return null;
}

function normalizeFieldKey(key) {
  const snake = (key ?? '').toString().trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
  return {
    snake,
    compact: snake.replace(/[^a-z0-9]/g, ''),
  };
}

function fieldKeyMatchesTerms(key, terms) {
  const normalized = normalizeFieldKey(key);
  return terms.some((term) => {
    const normalizedTerm = normalizeFieldKey(term);
    return normalized.snake.includes(normalizedTerm.snake) ||
      normalized.compact.includes(normalizedTerm.compact);
  });
}

function hasMeaningfulFieldValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return Boolean(normalizeSingleLine(value));
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(normalizeSingleLine(value));
}

function findUnsafeFieldKeys(source, { terms, safeKeys = new Set(), isAllowed = () => false }, depth = 0) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return [];

  return Object.entries(source).reduce((keys, [key, value]) => {
    if (!hasMeaningfulFieldValue(value)) return keys;
    const normalized = normalizeFieldKey(key);
    if (safeKeys.has(normalized.snake) || safeKeys.has(normalized.compact)) return keys;
    if (isAllowed({ normalized, value })) return keys;
    if (fieldKeyMatchesTerms(key, terms)) keys.push(normalized.snake || 'unknown_field');
    if (typeof value === 'object' && !Array.isArray(value) && depth < 2) {
      keys.push(...findUnsafeFieldKeys(value, { terms, safeKeys, isAllowed }, depth + 1));
    }
    return keys;
  }, []);
}

function isApprovedSyntheticShopifyId(value) {
  return normalizeSingleLine(value).startsWith(APPROVED_SYNTHETIC_ORDER_ID_PREFIX);
}

function hasProofOrDrop(order, task) {
  const taskUnsafeKeys = findUnsafeFieldKeys(task, { terms: PROOF_DROP_KEY_TERMS });
  const orderUnsafeKeys = findUnsafeFieldKeys(order, { terms: PROOF_DROP_KEY_TERMS });

  return taskUnsafeKeys.length > 0 || orderUnsafeKeys.length > 0;
}

function hasProviderPaymentLinkage(order, task) {
  const taskUnsafeKeys = findUnsafeFieldKeys(task, {
    terms: PROVIDER_PAYMENT_KEY_TERMS,
    safeKeys: SAFE_PROVIDER_PAYMENT_KEYS,
  });
  const orderUnsafeKeys = findUnsafeFieldKeys(order, {
    terms: PROVIDER_PAYMENT_KEY_TERMS,
    safeKeys: SAFE_PROVIDER_PAYMENT_KEYS,
    isAllowed: ({ normalized, value }) => (
      normalized.snake === 'shopify_order_id' &&
      isApprovedSyntheticShopifyId(value)
    ),
  });

  return taskUnsafeKeys.length > 0 || orderUnsafeKeys.length > 0;
}

function isApprovedTestContactField({ normalized, value }) {
  if (normalized.compact.includes('email')) {
    return normalizeEmail(value) === APPROVED_TEST_EMAIL;
  }
  if (normalized.compact.includes('name')) {
    return normalizeSingleLine(value) === 'G15E Delivered Test - No Customer';
  }
  return false;
}

function hasCustomerContactOrAddress(order, task) {
  const taskUnsafeKeys = findUnsafeFieldKeys(task, {
    terms: CUSTOMER_DATA_KEY_TERMS,
    isAllowed: isApprovedTestContactField,
  });
  const orderUnsafeKeys = findUnsafeFieldKeys(order, {
    terms: CUSTOMER_DATA_KEY_TERMS,
    isAllowed: isApprovedTestContactField,
  });

  return taskUnsafeKeys.length > 0 || orderUnsafeKeys.length > 0;
}

function orderNumber(order) {
  return normalizeOrderNumber(order?.shopify_order_number || order?.order_number);
}

function isBlockedOrderState(order) {
  const productionStatus = normalizeLower(order?.production_status);
  const fulfillmentStatus = normalizeLower(order?.fulfillment_status);
  const orderStatus = normalizeLower(order?.order_status);
  const paymentStatus = normalizeLower(order?.payment_status);
  const syncStatus = normalizeLower(order?.sync_status);
  const operationalVisibility = normalizeLower(order?.operational_visibility);
  const dataQualityStatus = normalizeLower(order?.data_quality_status);
  const fulfillmentMethod = normalizeLower(order?.fulfillment_method || order?.fulfillment_type);
  const tags = Array.isArray(order?.tags) ? order.tags.map((tag) => normalizeLower(tag)) : [];

  return productionStatus === 'canceled' ||
    productionStatus === 'cancelled' ||
    productionStatus === 'refunded' ||
    fulfillmentStatus === 'picked_up' ||
    orderStatus === 'canceled' ||
    orderStatus === 'cancelled' ||
    orderStatus === 'refunded' ||
    orderStatus === 'archived' ||
    paymentStatus === 'refunded' ||
    syncStatus === 'do_not_sync' ||
    operationalVisibility === 'archived' ||
    dataQualityStatus === 'quarantined' ||
    fulfillmentMethod === 'pickup' ||
    tags.includes('do_not_sync') ||
    tags.includes('do-not-sync') ||
    tags.includes('excluded') ||
    tags.includes('exclude_from_sync') ||
    tags.includes('excluded_from_sync') ||
    tags.includes('quarantined');
}

function evaluateFakeGate(task, order, taskId) {
  const failures = [];

  if (taskId !== APPROVED_TASK_ID) failures.push('task_not_approved_fake_id');
  if (normalizeSingleLine(task?.order_id) !== APPROVED_HUB_ORDER_ID) failures.push('task_order_id_not_approved');
  if (normalizeSingleLine(order?.id) !== APPROVED_HUB_ORDER_ID) failures.push('hub_order_id_not_approved');
  if (orderNumber(order) !== APPROVED_ORDER_NUMBER) failures.push('hub_order_number_not_approved');
  if (normalizeOrderNumber(task?.order_number) !== APPROVED_ORDER_NUMBER) failures.push('task_order_number_not_approved');
  if (normalizeEmail(order?.customer_email) !== APPROVED_TEST_EMAIL) failures.push('hub_email_not_approved');
  if (normalizeEmail(task?.customer_email) !== APPROVED_TEST_EMAIL) failures.push('task_email_not_approved');
  if (!isApprovedSyntheticShopifyId(order?.shopify_order_id)) failures.push('synthetic_shopify_order_id_not_approved');
  if (hasProviderPaymentLinkage(order, task)) failures.push('provider_payment_linkage_present');
  if (hasCustomerContactOrAddress(order, task)) failures.push('customer_data_present');
  if (hasProofOrDrop(order, task)) failures.push('proof_drop_out_of_scope');
  if (isBlockedOrderState(order)) failures.push('blocked_hub_order_state');

  return {
    passed: failures.length === 0,
    failures,
  };
}

function evaluatePreconditions(task, order) {
  const errors = [];

  if (normalizeSingleLine(task?.status) !== DELIVERED_TASK_STATUS) errors.push('task_not_completed');
  if (normalizeLower(task?.delivery_status) !== DELIVERED_TASK_DELIVERY_STATUS) errors.push('task_not_delivered');
  if (!isValidIsoTimestamp(task?.delivered_at)) errors.push('task_delivered_at_required');
  if (!normalizeSingleLine(task?.assigned_driver)) errors.push('driver_assignment_required');
  if (isBlockedOrderState(order)) errors.push('blocked_hub_order_state');
  if (hasProofOrDrop(order, task)) errors.push('proof_drop_out_of_scope');
  if (hasProviderPaymentLinkage(order, task)) errors.push('provider_payment_linkage_present');
  if (hasCustomerContactOrAddress(order, task)) errors.push('customer_data_present');

  return {
    passed: errors.length === 0,
    errors,
  };
}

function commandId(requestId, orderId) {
  return `${COMMAND}:${TARGET_TYPE}:${orderId}:${requestId}`;
}

async function findExistingCommandLog(base44, requestId, orderId) {
  const candidates = await base44.asServiceRole.entities.HubCommandLog.filter(
    { idempotency_key: requestId },
    '-created_date',
    20,
  ).catch(() => []);

  return (candidates || []).find(log => (
    log.command_type === COMMAND &&
    log.target_entity === TARGET_TYPE &&
    log.target_id === orderId &&
    log.idempotency_key === requestId
  )) || null;
}

function buildNotes({
  taskId,
  orderId,
  displayOrderNumber,
  requestId,
  previousProductionStatus,
  newProductionStatus,
  previousFulfillmentStatus,
  newFulfillmentStatus,
  taskDeliveredAtPresent,
}) {
  return JSON.stringify({
    task_id: sanitizeMetadataValue(taskId, 160) || null,
    hub_order_id: sanitizeMetadataValue(orderId, 160) || null,
    order_number: sanitizeMetadataValue(displayOrderNumber, 80) || null,
    previous_production_status: sanitizeMetadataValue(previousProductionStatus, 40) || null,
    new_production_status: sanitizeMetadataValue(newProductionStatus, 40) || null,
    previous_fulfillment_status: sanitizeMetadataValue(previousFulfillmentStatus, 40) || null,
    new_fulfillment_status: sanitizeMetadataValue(newFulfillmentStatus, 40) || null,
    task_delivered_at_present: taskDeliveredAtPresent === true,
    source: SOURCE,
    request_id: sanitizeMetadataValue(requestId, 160),
    notification_expected_after_sync: true,
    proof_drop_omitted: true,
    fake_test_only: true,
  });
}

function parseNotesMetadata(notes) {
  try {
    const parsed = JSON.parse(normalizeText(notes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return {
      task_id: sanitizeMetadataValue(parsed.task_id, 160) || null,
      previous_production_status: sanitizeMetadataValue(parsed.previous_production_status, 40) || null,
      new_production_status: sanitizeMetadataValue(parsed.new_production_status, 40) || null,
      previous_fulfillment_status: sanitizeMetadataValue(parsed.previous_fulfillment_status, 40) || null,
      new_fulfillment_status: sanitizeMetadataValue(parsed.new_fulfillment_status, 40) || null,
      delivered_at: sanitizeMetadataValue(parsed.delivered_at, 40) || null,
    };
  } catch {
    return {};
  }
}

function buildLogPayload({
  requestId,
  taskId,
  orderId,
  displayOrderNumber,
  actorEmail,
  actorRole,
  previousProductionStatus,
  newProductionStatus,
  previousFulfillmentStatus,
  newFulfillmentStatus,
  deliveredAt,
  status,
  errorCode,
  detailsSummary,
  timestamp,
  durationMs,
}) {
  return {
    command_id: commandId(requestId, orderId),
    command_type: COMMAND,
    command_source: COMMAND_SOURCE,
    status,
    target_entity: TARGET_TYPE,
    target_id: orderId,
    target_display_id: displayOrderNumber,
    actor_email: actorEmail,
    actor_role: actorRole,
    actor_type: 'admin',
    idempotency_key: requestId,
    idempotent_skipped: status === 'skipped',
    submitted_at: timestamp,
    started_at: timestamp,
    completed_at: timestamp,
    duration_ms: durationMs,
    function_name: FUNCTION_NAME,
    related_order_id: orderId,
    related_order_number: displayOrderNumber,
    notes: buildNotes({
      taskId,
      orderId,
      displayOrderNumber,
      requestId,
      previousProductionStatus,
      newProductionStatus,
      previousFulfillmentStatus,
      newFulfillmentStatus,
      taskDeliveredAtPresent: Boolean(deliveredAt),
    }),
    error_code: errorCode || null,
    error_message: errorCode ? sanitizeText(detailsSummary, 200) : null,
  };
}

async function createCommandLog(base44, payload) {
  await base44.asServiceRole.entities.HubCommandLog.create(payload);
}

async function findFulfillmentTask(base44, taskId) {
  const tasks = await base44.asServiceRole.entities.FulfillmentTask.filter({ id: taskId }, '-updated_date', 1);
  return tasks?.[0] || null;
}

async function findShopifyOrder(base44, orderId) {
  const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({ id: orderId }, '-updated_date', 1);
  return orders?.[0] || null;
}

function isCoherentlyFulfilled(order, taskDeliveredAt) {
  return normalizeLower(order?.production_status) === FULFILLED_STATUS &&
    normalizeLower(order?.fulfillment_status) === FULFILLED_STATUS &&
    Boolean(normalizeSingleLine(order?.delivered_at)) &&
    normalizeSingleLine(order?.delivered_at) === taskDeliveredAt;
}

function safeResponse({
  orderId,
  taskId,
  previousProductionStatus,
  productionStatus,
  previousFulfillmentStatus,
  fulfillmentStatus,
  deliveredAt,
  requestId,
  skipped,
  updatedAt,
}) {
  return {
    success: true,
    hub_order_id: orderId,
    fulfillment_task_id: taskId,
    previous_production_status: previousProductionStatus || null,
    production_status: productionStatus || null,
    previous_fulfillment_status: previousFulfillmentStatus || null,
    fulfillment_status: fulfillmentStatus || null,
    delivered_at: deliveredAt || null,
    request_id: requestId,
    skipped: skipped === true,
    updated_at: updatedAt || null,
    sync_required: true,
    notification_expected_after_sync: true,
    proof_drop_omitted: true,
    fake_test_only: true,
  };
}

Deno.serve(async (req) => {
  const startTime = Date.now();

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

    const body = await req.json().catch(() => ({}));
    const unsupportedKey = findUnsupportedBodyKey(body);
    if (unsupportedKey) {
      return Response.json({
        error: `Unsupported field: ${sanitizeText(unsupportedKey, 80)}`,
        error_code: 'unsupported_field',
      }, { status: 400 });
    }

    let taskId;
    let requestId;
    let suppliedOrderId;
    let actorEmail;
    let actorRole;

    try {
      taskId = normalizeId(body.fulfillment_task_id, 'fulfillment_task_id');
      requestId = normalizeId(body.request_id, 'request_id');
      suppliedOrderId = normalizeId(body.hub_order_id, 'hub_order_id', false);
      actorEmail = normalizeActorEmail(body.actor_email);
      actorRole = normalizeActorRole(body.actor_role);
      normalizeSource(body.source);
      normalizeReason(body.reason);
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const timestamp = new Date().toISOString();
    const task = await findFulfillmentTask(base44, taskId);

    if (!task) {
      return Response.json({
        success: false,
        error: 'Fulfillment task not found',
        error_code: 'task_not_found',
        request_id: requestId,
      }, { status: 404 });
    }

    const linkedOrderId = normalizeSingleLine(task.order_id);
    if (!linkedOrderId) {
      return Response.json({
        success: false,
        error: 'Fulfillment task is not linked to a Hub order',
        error_code: 'missing_order_link',
        fulfillment_task_id: taskId,
        request_id: requestId,
      }, { status: 409 });
    }

    if (suppliedOrderId && suppliedOrderId !== linkedOrderId) {
      return Response.json({
        success: false,
        error: 'Supplied Hub order id does not match fulfillment task',
        error_code: 'hub_order_mismatch',
        fulfillment_task_id: taskId,
        request_id: requestId,
      }, { status: 409 });
    }

    const order = await findShopifyOrder(base44, linkedOrderId);
    if (!order) {
      return Response.json({
        success: false,
        error: 'Linked Hub order not found',
        error_code: 'hub_order_not_found',
        fulfillment_task_id: taskId,
        request_id: requestId,
      }, { status: 404 });
    }

    const orderId = normalizeSingleLine(order.id);
    const displayOrderNumber = orderNumber(order);
    const previousProductionStatus = sanitizeMetadataValue(order.production_status, 40);
    const previousFulfillmentStatus = sanitizeMetadataValue(order.fulfillment_status, 40);
    const taskDeliveredAt = normalizeSingleLine(task.delivered_at);
    const existingLog = await findExistingCommandLog(base44, requestId, orderId);

    if (existingLog) {
      const existingStatus = normalizeLower(existingLog.status);
      const metadata = parseNotesMetadata(existingLog.notes);

      if (IDEMPOTENT_SUCCESS_STATUSES.has(existingStatus)) {
        return Response.json(safeResponse({
          orderId,
          taskId: metadata.task_id || taskId,
          previousProductionStatus: metadata.previous_production_status || null,
          productionStatus: metadata.new_production_status || FULFILLED_STATUS,
          previousFulfillmentStatus: metadata.previous_fulfillment_status || null,
          fulfillmentStatus: metadata.new_fulfillment_status || FULFILLED_STATUS,
          deliveredAt: normalizeSingleLine(order.delivered_at) || metadata.delivered_at || null,
          requestId,
          skipped: true,
          updatedAt: existingLog.completed_at || existingLog.created_date || null,
        }));
      }

      if (existingStatus === 'rejected') {
        return Response.json({
          success: false,
          error: 'Command request was already rejected',
          error_code: 'idempotency_conflict',
          request_id: requestId,
          skipped: true,
        }, { status: 409 });
      }

      if (isCoherentlyFulfilled(order, taskDeliveredAt) && evaluateFakeGate(task, order, taskId).passed) {
        return Response.json(safeResponse({
          orderId,
          taskId,
          previousProductionStatus,
          productionStatus: FULFILLED_STATUS,
          previousFulfillmentStatus,
          fulfillmentStatus: FULFILLED_STATUS,
          deliveredAt: normalizeSingleLine(order.delivered_at),
          requestId,
          skipped: true,
          updatedAt: existingLog.completed_at || existingLog.created_date || null,
        }));
      }

      return Response.json({
        success: false,
        error: 'Command request already exists and cannot be safely resolved',
        error_code: 'idempotency_conflict',
        request_id: requestId,
        skipped: true,
      }, { status: 409 });
    }

    const fakeGate = evaluateFakeGate(task, order, taskId);
    if (!fakeGate.passed) {
      const fakeGateErrorCode = fakeGate.failures.includes('customer_data_present')
        ? 'customer_data_present'
        : fakeGate.failures.includes('proof_drop_out_of_scope')
          ? 'proof_drop_out_of_scope'
          : 'fake_test_gate_failed';

      await createCommandLog(base44, buildLogPayload({
        requestId,
        taskId,
        orderId,
        displayOrderNumber,
        actorEmail,
        actorRole,
        previousProductionStatus,
        newProductionStatus: previousProductionStatus,
        previousFulfillmentStatus,
        newFulfillmentStatus: previousFulfillmentStatus,
        deliveredAt: null,
        status: 'rejected',
        errorCode: fakeGateErrorCode,
        detailsSummary: 'Fake-test gate failed',
        timestamp,
        durationMs: Date.now() - startTime,
      })).catch(() => null);

      return Response.json({
        success: false,
        error: 'Fake-test gate failed',
        error_code: fakeGateErrorCode,
        fulfillment_task_id: taskId,
        hub_order_id: orderId,
        request_id: requestId,
      }, { status: 409 });
    }

    const preconditions = evaluatePreconditions(task, order);
    if (!preconditions.passed) {
      const errorCode = preconditions.errors[0] || 'precondition_failed';
      await createCommandLog(base44, buildLogPayload({
        requestId,
        taskId,
        orderId,
        displayOrderNumber,
        actorEmail,
        actorRole,
        previousProductionStatus,
        newProductionStatus: previousProductionStatus,
        previousFulfillmentStatus,
        newFulfillmentStatus: previousFulfillmentStatus,
        deliveredAt: null,
        status: 'rejected',
        errorCode,
        detailsSummary: 'Customer-facing delivered precondition failed',
        timestamp,
        durationMs: Date.now() - startTime,
      }));

      return Response.json({
        success: false,
        error: 'Customer-facing delivered precondition failed',
        error_code: errorCode,
        fulfillment_task_id: taskId,
        hub_order_id: orderId,
        request_id: requestId,
      }, { status: 409 });
    }

    const productionAlreadyFulfilled = normalizeLower(order.production_status) === FULFILLED_STATUS;
    const fulfillmentAlreadyFulfilled = normalizeLower(order.fulfillment_status) === FULFILLED_STATUS;
    const alreadyFulfilled = productionAlreadyFulfilled && fulfillmentAlreadyFulfilled;
    const currentDeliveredAt = normalizeSingleLine(order.delivered_at);

    if (productionAlreadyFulfilled || fulfillmentAlreadyFulfilled) {
      if (alreadyFulfilled && currentDeliveredAt && currentDeliveredAt === taskDeliveredAt) {
        await createCommandLog(base44, buildLogPayload({
          requestId,
          taskId,
          orderId,
          displayOrderNumber,
          actorEmail,
          actorRole,
          previousProductionStatus,
          newProductionStatus: FULFILLED_STATUS,
          previousFulfillmentStatus,
          newFulfillmentStatus: FULFILLED_STATUS,
          deliveredAt: currentDeliveredAt,
          status: 'skipped',
          errorCode: null,
          detailsSummary: 'Hub order already marked customer-facing delivered',
          timestamp,
          durationMs: Date.now() - startTime,
        }));

        return Response.json(safeResponse({
          orderId,
          taskId,
          previousProductionStatus,
          productionStatus: FULFILLED_STATUS,
          previousFulfillmentStatus,
          fulfillmentStatus: FULFILLED_STATUS,
          deliveredAt: currentDeliveredAt,
          requestId,
          skipped: true,
          updatedAt: timestamp,
        }));
      }

      await createCommandLog(base44, buildLogPayload({
        requestId,
        taskId,
        orderId,
        displayOrderNumber,
        actorEmail,
        actorRole,
        previousProductionStatus,
        newProductionStatus: previousProductionStatus,
        previousFulfillmentStatus,
        newFulfillmentStatus: previousFulfillmentStatus,
        deliveredAt: currentDeliveredAt || null,
        status: 'rejected',
        errorCode: 'conflicting_delivered_at',
        detailsSummary: 'Hub order is already fulfilled with missing or conflicting delivered_at',
        timestamp,
        durationMs: Date.now() - startTime,
      }));

      return Response.json({
        success: false,
        error: 'Hub order has a fulfilled state with missing or conflicting delivered_at',
        error_code: 'conflicting_delivered_at',
        fulfillment_task_id: taskId,
        hub_order_id: orderId,
        request_id: requestId,
      }, { status: 409 });
    }

    try {
      await base44.asServiceRole.entities.ShopifyOrder.update(orderId, {
        production_status: FULFILLED_STATUS,
        fulfillment_status: FULFILLED_STATUS,
        delivered_at: taskDeliveredAt,
      });
    } catch {
      await createCommandLog(base44, buildLogPayload({
        requestId,
        taskId,
        orderId,
        displayOrderNumber,
        actorEmail,
        actorRole,
        previousProductionStatus,
        newProductionStatus: previousProductionStatus,
        previousFulfillmentStatus,
        newFulfillmentStatus: previousFulfillmentStatus,
        deliveredAt: null,
        status: 'failed',
        errorCode: 'update_failed',
        detailsSummary: 'Hub order delivered sync-readiness update failed',
        timestamp,
        durationMs: Date.now() - startTime,
      })).catch(() => null);

      console.error('[MARK-HUB-ORDER-DELIVERED-FOR-CA-SYNC] command failed');
      return Response.json({ error: 'Unable to mark Hub order delivered for Customer App sync' }, { status: 500 });
    }

    try {
      await createCommandLog(base44, buildLogPayload({
        requestId,
        taskId,
        orderId,
        displayOrderNumber,
        actorEmail,
        actorRole,
        previousProductionStatus,
        newProductionStatus: FULFILLED_STATUS,
        previousFulfillmentStatus,
        newFulfillmentStatus: FULFILLED_STATUS,
        deliveredAt: taskDeliveredAt,
        status: 'success',
        errorCode: null,
        detailsSummary: 'Hub order marked customer-facing delivered for scoped Customer App sync',
        timestamp,
        durationMs: Date.now() - startTime,
      }));
    } catch {
      console.error('[MARK-HUB-ORDER-DELIVERED-FOR-CA-SYNC] audit log failed after update');
      return Response.json(safeResponse({
        orderId,
        taskId,
        previousProductionStatus,
        productionStatus: FULFILLED_STATUS,
        previousFulfillmentStatus,
        fulfillmentStatus: FULFILLED_STATUS,
        deliveredAt: taskDeliveredAt,
        requestId,
        skipped: false,
        updatedAt: timestamp,
      }));
    }

    return Response.json(safeResponse({
      orderId,
      taskId,
      previousProductionStatus,
      productionStatus: FULFILLED_STATUS,
      previousFulfillmentStatus,
      fulfillmentStatus: FULFILLED_STATUS,
      deliveredAt: taskDeliveredAt,
      requestId,
      skipped: false,
      updatedAt: timestamp,
    }));
  } catch {
    console.error('[MARK-HUB-ORDER-DELIVERED-FOR-CA-SYNC] Error');
    return Response.json({ error: 'Unable to mark Hub order delivered for Customer App sync' }, { status: 500 });
  }
});
