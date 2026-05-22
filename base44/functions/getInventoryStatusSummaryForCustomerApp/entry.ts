import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const QUERY_LIMIT = MAX_LIMIT + 1;
const VALID_STATUSES = new Set(['ok', 'low', 'critical', 'out_of_stock']);
const STATUS_SEVERITY = {
  out_of_stock: 0,
  critical: 1,
  low: 2,
  ok: 3,
};

function normalizeText(value) {
  return (value || '').toString().trim();
}

function normalizeSearch(value) {
  return normalizeText(value).toLowerCase();
}

function parseLimit(value) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function computeStatus(item) {
  const stock = numberOrNull(item.stock) ?? 0;
  const reorderPoint = numberOrNull(item.reorder_point);

  if (stock <= 0) return 'out_of_stock';
  if (reorderPoint !== null && reorderPoint > 0 && stock <= reorderPoint * 0.5) return 'critical';
  if (reorderPoint !== null && reorderPoint > 0 && stock <= reorderPoint) return 'low';
  return 'ok';
}

function sanitizeItem(item) {
  return {
    id: item.id || null,
    ingredient: item.ingredient || null,
    category: item.category || null,
    unit: item.unit || null,
    stock: numberOrNull(item.stock),
    reorder_point: numberOrNull(item.reorder_point),
    max_stock: numberOrNull(item.max_stock),
    supplier: item.supplier || null,
    location: item.location || null,
    status: computeStatus(item),
    updated_date: item.updated_date || null,
  };
}

function matchesSearch(item, search) {
  if (!search) return true;
  return [
    item.ingredient,
    item.category,
    item.supplier,
    item.location,
  ].some(value => normalizeSearch(value).includes(search));
}

function sortItems(a, b) {
  const byStatus = (STATUS_SEVERITY[a.status] ?? 9) - (STATUS_SEVERITY[b.status] ?? 9);
  if (byStatus !== 0) return byStatus;

  const byCategory = (a.category || '').localeCompare(b.category || '');
  if (byCategory !== 0) return byCategory;

  return (a.ingredient || '').localeCompare(b.ingredient || '');
}

function buildSummary(items) {
  const categories = new Set(items.map(item => normalizeText(item.category)).filter(Boolean));

  return {
    total_items: items.length,
    low_stock_count: items.filter(item => item.status === 'low').length,
    critical_count: items.filter(item => item.status === 'critical').length,
    out_of_stock_count: items.filter(item => item.status === 'out_of_stock').length,
    category_count: categories.size,
  };
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

    if (req.method !== 'GET') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const url = new URL(req.url);
    const category = normalizeText(url.searchParams.get('category'));
    const status = normalizeSearch(url.searchParams.get('status'));
    const search = normalizeSearch(url.searchParams.get('search'));
    const limit = parseLimit(url.searchParams.get('limit'));

    if (status && !VALID_STATUSES.has(status)) {
      return Response.json({
        error: 'status must be one of ok, low, critical, out_of_stock',
      }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const inventoryItems = await base44.asServiceRole.entities.InventoryItem.list(
      '-updated_date',
      QUERY_LIMIT,
    );

    const sanitizedItems = (inventoryItems || [])
      .map(sanitizeItem)
      .sort(sortItems);
    const summary = buildSummary(sanitizedItems);

    const filteredItems = sanitizedItems.filter(item => {
      if (category && item.category !== category) return false;
      if (status && item.status !== status) return false;
      if (!matchesSearch(item, search)) return false;
      return true;
    });

    const truncated = filteredItems.length > limit || (inventoryItems || []).length > MAX_LIMIT;
    const items = filteredItems.slice(0, limit);

    console.log(`[INVENTORY-STATUS-SUMMARY] count=${items.length} truncated=${truncated}`);

    return Response.json({
      success: true,
      summary,
      count: items.length,
      truncated,
      items,
    });
  } catch (error) {
    console.error('[INVENTORY-STATUS-SUMMARY] Error:', error.message);
    return Response.json({ error: 'Unable to load inventory status summary' }, { status: 500 });
  }
});
