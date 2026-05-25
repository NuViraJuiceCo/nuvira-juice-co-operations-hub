import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const REAL_CORRECTION_ENABLED = (Deno.env.get('ENABLE_REAL_PRODUCTION_INGREDIENT_USAGE_CORRECTION') || '').trim().toLowerCase() === 'true';
const REAL_CORRECTION_ALLOWED_EMAILS = Deno.env.get('REAL_PRODUCTION_INGREDIENT_USAGE_CORRECTION_ALLOWED_EMAILS') || '';
const REAL_CORRECTION_BATCH_ALLOWLIST = Deno.env.get('REAL_PRODUCTION_INGREDIENT_USAGE_CORRECTION_BATCH_ALLOWLIST') || '';

const COMMAND = 'production_ingredient_usage_correction';
const TARGET_TYPE = 'ProductionBatch';
const SOURCE = 'customer_app_admin';
const COMMAND_SOURCE = 'customer_app';
const FUNCTION_NAME = 'correctProductionIngredientUsageForCustomerApp';
const REQUIRED_STATUS = 'verified_logged';
const DEDUCTION_COMMAND_TYPE = 'production_inventory_deduction';
const MAX_TEXT_LENGTH = 160;
const MAX_RECIPE_ROWS = 50;
const INVENTORY_QUERY_LIMIT = 1000;
const RECIPE_QUERY_LIMIT = 500;
const YIELD_QUERY_LIMIT = 1000;

const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'batch_id',
  'expected_status',
  'request_id',
  'reason',
  'actor_email',
  'actor_role',
  'source',
]);

const IDEMPOTENT_SUCCESS_STATUSES = new Set(['success', 'skipped']);

const PRODUCT_ALIASES = {
  're nu': ['re-nu', 're nu', 'renu'],
  oasis: ['oasis'],
  aura: ['aura'],
  'reset shot': ['reset', 'reset shot'],
  'hydration shot': ['hydration', 'hydration shot'],
  'radiance shot': ['radiance', 'radiance shot'],
  'orange juice': ['orange', 'orange juice'],
  'pineapple juice': ['pineapple', 'pineapple juice'],
  'watermelon juice': ['watermelon', 'watermelon juice'],
};

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeSingleLine(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function normalizeLower(value) {
  return normalizeSingleLine(value).toLowerCase();
}

function normalizeKey(value) {
  return normalizeLower(value)
    .replace(/[-_]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\b(juice|product|shot)\b/g, '')
    .trim();
}

function singularizeIngredientKey(key) {
  const normalized = normalizeKey(key);
  if (!normalized) return '';
  return normalized
    .split(' ')
    .map((part) => {
      if (part.length > 3 && part.endsWith('ies')) return `${part.slice(0, -3)}y`;
      if (part.length > 3 && part.endsWith('s') && !part.endsWith('ss')) return part.slice(0, -1);
      return part;
    })
    .join(' ');
}

function genericIngredientFallbackKey(key) {
  const parts = singularizeIngredientKey(key).split(' ').filter(Boolean);
  if (parts.length < 2) return '';
  return parts[parts.length - 1];
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

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value) {
  const parsed = numberOrNull(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function roundThousandth(value) {
  const parsed = numberOrNull(value);
  return parsed === null ? null : Math.round(parsed * 1000) / 1000;
}

function normalizeId(value, fieldName) {
  const text = normalizeSingleLine(value);
  if (!text) throw new Error(`${fieldName} is required`);
  if (text.length > 180 || !/^[A-Za-z0-9._:@/-]+$/.test(text)) {
    throw new Error(`${fieldName} contains unsupported characters`);
  }
  return text;
}

function normalizeOptionalStatus(value) {
  const status = normalizeSingleLine(value);
  if (!status) return '';
  if (status.length > 80 || !/^[A-Za-z0-9._ -]+$/.test(status)) {
    throw new Error('expected_status contains unsupported characters');
  }
  return status;
}

function normalizeActorEmail(value) {
  const email = normalizeSingleLine(value).toLowerCase();
  if (!email) throw new Error('actor_email is required');
  if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('actor_email must be a valid email address');
  }
  return email;
}

function normalizeSource(value) {
  const source = normalizeLower(value);
  if (!source) throw new Error('source is required');
  if (source !== SOURCE) throw new Error('source must be customer_app_admin');
  return source;
}

function parseEmailAllowlist(raw) {
  return new Set((raw || '')
    .split(',')
    .map((email) => normalizeLower(email))
    .filter(Boolean));
}

function parseBatchAllowlist(raw) {
  return (raw || '')
    .split(',')
    .map((entry) => normalizeSingleLine(entry))
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(':');
      if (separator <= 0 || separator === entry.length - 1) return null;
      return {
        productionBatchId: entry.slice(0, separator).trim(),
        batchDisplayId: entry.slice(separator + 1).trim(),
      };
    })
    .filter(Boolean);
}

function isActorAllowed(actorEmail, actorRole) {
  if (normalizeLower(actorRole) !== 'admin') return false;
  return parseEmailAllowlist(REAL_CORRECTION_ALLOWED_EMAILS).has(normalizeLower(actorEmail));
}

function isBatchAllowlisted(productionBatchId, batchDisplayId) {
  return parseBatchAllowlist(REAL_CORRECTION_BATCH_ALLOWLIST).some((entry) => (
    entry.productionBatchId === productionBatchId &&
    entry.batchDisplayId === batchDisplayId
  ));
}

function findUnsupportedBodyKey(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  for (const key of Object.keys(body)) {
    if (!ALLOWED_BODY_KEYS.has(normalizeLower(key))) return key;
  }
  return null;
}

function safeError(error, errorCode, message = error) {
  return {
    success: false,
    error: sanitizeText(error, 180),
    error_code: sanitizeText(errorCode, 80),
    message: sanitizeText(message, 220),
  };
}

function commandId(requestId, productionBatchId) {
  return `${COMMAND}:${TARGET_TYPE}:${productionBatchId}:${requestId}`;
}

function buildIngredientLookup(items, getName) {
  const exact = new Map();
  const singular = new Map();
  const generic = new Map();

  for (const item of items || []) {
    const key = normalizeKey(getName(item));
    if (!key) continue;
    const exactItems = exact.get(key) || [];
    exactItems.push(item);
    exact.set(key, exactItems);

    const singularKey = singularizeIngredientKey(key);
    if (singularKey) {
      const singularItems = singular.get(singularKey) || [];
      singularItems.push(item);
      singular.set(singularKey, singularItems);
    }

    const genericKey = genericIngredientFallbackKey(key);
    if (genericKey) {
      const genericItems = generic.get(genericKey) || [];
      genericItems.push(item);
      generic.set(genericKey, genericItems);
    }
  }

  return { exact, singular, generic };
}

function findIngredientMatches(lookup, ingredientName) {
  const key = normalizeKey(ingredientName);
  if (!key || !lookup) return [];

  const exactMatches = lookup.exact?.get(key) || [];
  if (exactMatches.length > 0) return exactMatches;

  const singularKey = singularizeIngredientKey(key);
  const singularMatches = lookup.singular?.get(singularKey) || [];
  if (singularMatches.length > 0) return singularMatches;

  const fallbackKey = genericIngredientFallbackKey(key);
  if (!fallbackKey) return [];
  const fallbackMatches = [
    ...(lookup.exact?.get(fallbackKey) || []),
    ...(lookup.singular?.get(fallbackKey) || []),
    ...(lookup.generic?.get(fallbackKey) || []),
  ];
  return [...new Map(fallbackMatches.map(item => [item.id, item])).values()];
}

function findBestRecipeMatch(recipes, productName) {
  const normalized = normalizeKey(productName);
  if (!normalized) return null;

  const activeRecipes = (recipes || []).filter(recipe => recipe?.is_active !== false);
  const exact = activeRecipes.find(recipe => normalizeKey(recipe?.product_name) === normalized);
  if (exact) return exact;

  for (const [canonicalKey, aliases] of Object.entries(PRODUCT_ALIASES)) {
    if (aliases.map(normalizeKey).includes(normalized)) {
      const aliasMatch = activeRecipes.find(recipe => normalizeKey(recipe?.product_name) === normalizeKey(canonicalKey));
      if (aliasMatch) return aliasMatch;
    }
  }

  return null;
}

function buildInventoryMap(items) {
  return buildIngredientLookup(items, item => item?.ingredient);
}

function buildYieldMap(items) {
  return buildIngredientLookup(items, item => item?.ingredient_name);
}

function buildUsageRows(recipe, batch, inventoryMap, yieldMap) {
  const blockers = [];
  const warnings = [];
  const rows = [];
  const actualUnits = positiveNumber(batch?.actual_units ?? batch?.final_usable_quantity ?? batch?.bottles_produced);
  const yieldFactor = positiveNumber(recipe?.yield_factor) || 1;
  const recipeRows = Array.isArray(recipe?.ingredients) ? recipe.ingredients.slice(0, MAX_RECIPE_ROWS) : [];

  if (!actualUnits) blockers.push('missing_actual_units');
  if (!Array.isArray(recipe?.ingredients) || recipe.ingredients.length === 0) blockers.push('missing_recipe_ingredients');
  if ((recipe?.ingredients || []).length > MAX_RECIPE_ROWS) blockers.push('recipe_rows_exceed_safe_limit');

  for (const ingredient of recipeRows) {
    const ingredientName = sanitizeText(ingredient?.ingredient_name, 120);
    const quantityOzPerUnit = numberOrNull(ingredient?.quantity_oz);
    const proposedQuantityOz = actualUnits && quantityOzPerUnit !== null
      ? roundThousandth(quantityOzPerUnit * actualUnits * yieldFactor)
      : null;
    const rowBlockers = [];
    const rowWarnings = [];

    if (!normalizeKey(ingredient?.ingredient_name) || !ingredientName) rowBlockers.push('invalid_ingredient_name');
    if (quantityOzPerUnit === null || quantityOzPerUnit <= 0) rowBlockers.push('quantity_normalization_issue');
    if (!actualUnits) rowBlockers.push('missing_actual_units');
    if (normalizeLower(ingredient?.unit) && normalizeLower(ingredient.unit) !== 'oz') {
      rowWarnings.push('quantity_field_normalized');
    }

    const inventoryMatches = findIngredientMatches(inventoryMap, ingredient?.ingredient_name);
    const yieldMatches = findIngredientMatches(yieldMap, ingredient?.ingredient_name);
    if (inventoryMatches.length === 0) rowBlockers.push('missing_inventory_item');
    if (inventoryMatches.length > 1) rowBlockers.push('ambiguous_ingredient_match');
    if (yieldMatches.length === 0) rowBlockers.push('missing_ingredient_yield');
    if (yieldMatches.length > 1) rowBlockers.push('ambiguous_ingredient_match');

    blockers.push(...rowBlockers);
    warnings.push(...rowWarnings);

    rows.push({
      ingredient_name: ingredientName,
      quantity: proposedQuantityOz,
      unit: 'oz',
      lot_number: null,
      source: 'recipe_derived_correction',
      ready: rowBlockers.length === 0 && proposedQuantityOz !== null,
      blockers: [...new Set(rowBlockers)],
    });
  }

  return {
    rows,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
  };
}

function publicUsageRows(rows) {
  return (rows || []).map(row => ({
    ingredient_name: sanitizeText(row.ingredient_name, 120),
    quantity: numberOrNull(row.quantity),
    unit: sanitizeText(row.unit, 20),
  }));
}

function buildNotes({
  requestId,
  batchDisplayId,
  previousStatus,
  previousIngredientCount,
  newIngredientCount,
  source,
}) {
  return JSON.stringify({
    batch_id: sanitizeText(batchDisplayId, 160) || null,
    previous_status: sanitizeText(previousStatus, 80) || null,
    source: sanitizeText(source, 80) || SOURCE,
    request_id: sanitizeText(requestId, 160),
    correction_type: 'production_ingredient_usage_only',
    previous_ingredients_used_count: Number(previousIngredientCount) || 0,
    new_ingredients_used_count: Number(newIngredientCount) || 0,
    inventory_stock_changes_deferred: true,
    purchase_order_changes_deferred: true,
    batch_compliance_log_changes_deferred: true,
    customer_app_sync_deferred: true,
    notifications_deferred: true,
  });
}

function parseNotesMetadata(notes) {
  try {
    const parsed = JSON.parse(normalizeText(notes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return {
      batch_id: sanitizeText(parsed.batch_id, 160) || null,
      previous_ingredients_used_count: Number(parsed.previous_ingredients_used_count) || 0,
      new_ingredients_used_count: Number(parsed.new_ingredients_used_count) || 0,
    };
  } catch {
    return {};
  }
}

function buildLogPayload({
  requestId,
  productionBatchId,
  batchDisplayId,
  actorEmail,
  actorRole,
  previousStatus,
  status,
  errorCode,
  errorMessage,
  timestamp,
  durationMs,
  previousIngredientCount = 0,
  newIngredientCount = 0,
}) {
  return {
    command_id: commandId(requestId, productionBatchId),
    command_type: COMMAND,
    command_source: COMMAND_SOURCE,
    status,
    target_entity: TARGET_TYPE,
    target_id: productionBatchId,
    target_display_id: batchDisplayId || productionBatchId,
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
    notes: buildNotes({
      requestId,
      batchDisplayId,
      previousStatus,
      previousIngredientCount,
      newIngredientCount,
      source: SOURCE,
    }),
    error_code: errorCode || null,
    error_message: errorMessage ? sanitizeText(errorMessage, 220) : null,
  };
}

function safeResponse({
  success,
  productionBatchId,
  batchDisplayId,
  status,
  requestId,
  skipped = false,
  updatedAt,
  previousIngredientCount = 0,
  ingredientCount = 0,
  ingredients = [],
}) {
  return {
    success: success === true,
    production_batch_id: productionBatchId,
    batch_id: batchDisplayId || null,
    status: status || null,
    request_id: requestId,
    skipped: skipped === true,
    updated_at: updatedAt || null,
    previous_ingredients_used_count: Number(previousIngredientCount) || 0,
    ingredients_used_count: Number(ingredientCount) || 0,
    ingredients_used_preview: publicUsageRows(ingredients).slice(0, MAX_RECIPE_ROWS),
    inventory_stock_changes_deferred: true,
    purchase_order_changes_deferred: true,
    batch_compliance_log_changes_deferred: true,
    customer_app_sync_deferred: true,
    notifications_deferred: true,
  };
}

async function findProductionBatch(base44, productionBatchId) {
  const batches = await base44.asServiceRole.entities.ProductionBatch.filter(
    { id: productionBatchId },
    '-updated_date',
    1,
  );
  return batches?.[0] || null;
}

async function findExistingCommandLog(base44, requestId, productionBatchId) {
  const candidates = await base44.asServiceRole.entities.HubCommandLog.filter(
    { idempotency_key: requestId },
    '-created_date',
    20,
  ).catch(() => []);

  return (candidates || []).find((log) => (
    log.command_type === COMMAND &&
    log.target_entity === TARGET_TYPE &&
    log.target_id === productionBatchId &&
    log.idempotency_key === requestId
  )) || null;
}

async function hasPriorDeductionLog(base44, productionBatchId) {
  const logs = await base44.asServiceRole.entities.HubCommandLog.filter({
    command_type: DEDUCTION_COMMAND_TYPE,
    target_entity: TARGET_TYPE,
    target_id: productionBatchId,
  }, '-created_date', 10).catch(() => []);

  return (logs || []).some(log => ['success', 'skipped', 'processing'].includes(normalizeLower(log.status)));
}

function statusForGateFailure(failures) {
  if (failures.includes('actor_not_allowed')) return 403;
  if (failures.includes('invalid_input')) return 400;
  return 409;
}

function evaluateGate({
  batch,
  productionBatchId,
  requestBatchId,
  expectedStatus,
  actorEmail,
  actorRole,
}) {
  const failures = [];
  const batchDisplayId = normalizeSingleLine(batch?.batch_id);
  const currentStatus = normalizeSingleLine(batch?.status);

  if (!REAL_CORRECTION_ENABLED) failures.push('real_ingredient_usage_correction_not_enabled');
  if (!isActorAllowed(actorEmail, actorRole)) failures.push('actor_not_allowed');
  if (!isBatchAllowlisted(productionBatchId, batchDisplayId)) failures.push('batch_not_allowlisted');
  if (!requestBatchId) failures.push('batch_id_required');
  if (requestBatchId && requestBatchId !== batchDisplayId) failures.push('batch_id_mismatch');
  if (!expectedStatus) failures.push('expected_status_required');
  if (expectedStatus && expectedStatus !== currentStatus) failures.push('expected_status_mismatch');
  if (currentStatus !== REQUIRED_STATUS) failures.push('invalid_status_transition');
  if (normalizeSingleLine(batch?.compliance_log_id) === '') failures.push('missing_compliance_log');
  if (!batch?.verified_at || !batch?.verified_by) failures.push('missing_verification_metadata');
  if (Array.isArray(batch?.ingredients_used) && batch.ingredients_used.length > 0) failures.push('existing_ingredient_usage');

  return [...new Set(failures)];
}

Deno.serve(async (req) => {
  const submittedAt = new Date().toISOString();
  const startedMs = Date.now();

  try {
    if (!SYNC_SECRET) {
      return Response.json(safeError('Unauthorized', 'unauthorized'), { status: 401 });
    }

    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ') || authHeader !== `Bearer ${SYNC_SECRET}`) {
      return Response.json(safeError('Unauthorized', 'unauthorized'), { status: 401 });
    }

    if (req.method !== 'POST') {
      return Response.json(safeError('Method not allowed', 'method_not_allowed'), { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const unsupportedKey = findUnsupportedBodyKey(body);
    if (unsupportedKey) {
      return Response.json({
        ...safeError(`Unsupported field: ${unsupportedKey}`, 'unsupported_field'),
      }, { status: 400 });
    }

    let productionBatchId;
    let requestBatchId;
    let expectedStatus;
    let requestId;
    let actorEmail;
    let actorRole;

    try {
      productionBatchId = normalizeId(body.production_batch_id, 'production_batch_id');
      requestBatchId = normalizeId(body.batch_id, 'batch_id');
      expectedStatus = normalizeOptionalStatus(body.expected_status);
      if (!expectedStatus) throw new Error('expected_status is required');
      requestId = normalizeId(body.request_id, 'request_id');
      actorEmail = normalizeActorEmail(body.actor_email);
      actorRole = sanitizeText(body.actor_role, 60);
      if (!actorRole) throw new Error('actor_role is required');
      normalizeSource(body.source);
      if (body.reason !== undefined) sanitizeText(body.reason, 180);
    } catch (error) {
      return Response.json(safeError(error.message, 'invalid_input'), { status: 400 });
    }

    const batch = await findProductionBatch(base44, productionBatchId);
    if (!batch) {
      return Response.json(safeError('ProductionBatch not found', 'batch_not_found'), { status: 404 });
    }

    const existingLog = await findExistingCommandLog(base44, requestId, productionBatchId);
    if (existingLog && IDEMPOTENT_SUCCESS_STATUSES.has(normalizeLower(existingLog.status))) {
      const metadata = parseNotesMetadata(existingLog.notes);
      return Response.json(safeResponse({
        success: true,
        productionBatchId,
        batchDisplayId: metadata.batch_id || sanitizeText(batch.batch_id, 160),
        status: sanitizeText(batch.status, 80),
        requestId,
        skipped: true,
        updatedAt: sanitizeText(existingLog.completed_at || existingLog.updated_date, 80) || null,
        previousIngredientCount: metadata.previous_ingredients_used_count || 0,
        ingredientCount: metadata.new_ingredients_used_count || (Array.isArray(batch.ingredients_used) ? batch.ingredients_used.length : 0),
        ingredients: Array.isArray(batch.ingredients_used) ? batch.ingredients_used : [],
      }));
    }
    if (existingLog) {
      return Response.json(safeError('Conflicting idempotency record exists', 'idempotency_conflict'), { status: 409 });
    }

    const gateFailures = evaluateGate({
      batch,
      productionBatchId,
      requestBatchId,
      expectedStatus,
      actorEmail,
      actorRole,
    });

    if (gateFailures.length > 0) {
      return Response.json(
        safeError('Ingredient usage correction gate failed', gateFailures[0]),
        { status: statusForGateFailure(gateFailures) },
      );
    }

    const priorDeductionLogPresent = await hasPriorDeductionLog(base44, productionBatchId);
    if (priorDeductionLogPresent) {
      return Response.json(safeError('Inventory deduction already logged for this batch', 'prior_deduction_log_present'), { status: 409 });
    }

    const [
      recipes,
      inventoryItems,
      yieldRows,
    ] = await Promise.all([
      base44.asServiceRole.entities.Recipe.list('-updated_date', RECIPE_QUERY_LIMIT),
      base44.asServiceRole.entities.InventoryItem.list('-updated_date', INVENTORY_QUERY_LIMIT),
      base44.asServiceRole.entities.IngredientYield.list('-updated_date', YIELD_QUERY_LIMIT),
    ]);

    const recipe = findBestRecipeMatch(recipes || [], batch.product_name);
    if (!recipe) {
      return Response.json(safeError('Recipe match missing', 'recipe_match_missing'), { status: 409 });
    }

    const inventoryMap = buildInventoryMap(inventoryItems || []);
    const yieldMap = buildYieldMap(yieldRows || []);
    const usagePlan = buildUsageRows(recipe, batch, inventoryMap, yieldMap);
    if (usagePlan.blockers.length > 0 || usagePlan.rows.length === 0 || usagePlan.rows.some(row => row.ready !== true)) {
      return Response.json(safeError('Ingredient usage correction precheck failed', usagePlan.blockers[0] || 'no_usage_rows'), { status: 409 });
    }

    const ingredientsUsed = usagePlan.rows.map(row => ({
      ingredient_name: sanitizeText(row.ingredient_name, 120),
      quantity: numberOrNull(row.quantity),
      unit: 'oz',
      lot_number: null,
    }));
    const now = new Date().toISOString();
    const previousIngredientCount = 0;
    const newIngredientCount = ingredientsUsed.length;
    const durationMs = Date.now() - startedMs;
    const commandMetadata = {
      requestId,
      productionBatchId,
      batchDisplayId: batch.batch_id,
      actorEmail,
      actorRole,
      previousStatus: batch.status,
      timestamp: submittedAt,
      durationMs,
      previousIngredientCount,
      newIngredientCount,
    };

    let commandLog;
    try {
      commandLog = await base44.asServiceRole.entities.HubCommandLog.create(buildLogPayload({
        ...commandMetadata,
        status: 'processing',
      }));
    } catch {
      return Response.json(safeError('Command audit could not be created', 'command_log_failed'), { status: 500 });
    }

    const existingAuditTrail = Array.isArray(batch.audit_trail) ? batch.audit_trail : [];
    const auditEntry = {
      timestamp: now,
      action: 'IngredientUsageCorrected',
      performed_by: actorEmail,
      source: SOURCE,
      request_id: requestId,
      correction_type: 'production_ingredient_usage_only',
      before: {
        status: batch.status,
        ingredients_used_count: previousIngredientCount,
      },
      after: {
        status: batch.status,
        ingredients_used_count: newIngredientCount,
      },
      inventory_stock_changes_deferred: true,
      purchase_order_changes_deferred: true,
      batch_compliance_log_changes_deferred: true,
      customer_app_sync_deferred: true,
      notifications_deferred: true,
    };

    try {
      await base44.asServiceRole.entities.ProductionBatch.update(batch.id, {
        ingredients_used: ingredientsUsed,
        audit_trail: [...existingAuditTrail, auditEntry],
      });
    } catch {
      await base44.asServiceRole.entities.HubCommandLog.update(commandLog.id, buildLogPayload({
        ...commandMetadata,
        status: 'failed',
        errorCode: 'production_batch_update_failed',
        errorMessage: 'Unable to write ingredient usage correction',
        durationMs: Date.now() - startedMs,
      }));
      return Response.json(safeError('Unable to write ingredient usage correction', 'production_batch_update_failed'), { status: 500 });
    }

    try {
      await base44.asServiceRole.entities.HubCommandLog.update(commandLog.id, buildLogPayload({
        ...commandMetadata,
        status: 'success',
        durationMs: Date.now() - startedMs,
      }));
    } catch {
      return Response.json(safeError('Ingredient usage correction applied but command audit was not finalized', 'command_log_update_failed'), { status: 500 });
    }

    return Response.json(safeResponse({
      success: true,
      productionBatchId,
      batchDisplayId: batch.batch_id,
      status: sanitizeText(batch.status, 80),
      requestId,
      skipped: false,
      updatedAt: now,
      previousIngredientCount,
      ingredientCount: newIngredientCount,
      ingredients: ingredientsUsed,
    }));
  } catch {
    return Response.json(safeError('Internal error', 'internal_error'), { status: 500 });
  }
});
