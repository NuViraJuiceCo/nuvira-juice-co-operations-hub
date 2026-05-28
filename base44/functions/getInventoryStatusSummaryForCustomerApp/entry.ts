import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const QUERY_LIMIT = MAX_LIMIT + 1;
const VALID_STATUSES = new Set(['ok', 'low', 'critical', 'out_of_stock']);
const OPEN_PO_STATUSES = new Set(['draft', 'ordered', 'in transit']);
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

function normalizeKey(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, ' ');
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
    cost_per_unit: numberOrNull(item.cost_per_unit),
    cost_per_supplier_unit: numberOrNull(item.cost_per_supplier_unit),
    supplier_packaging_unit: item.supplier_packaging_unit || null,
    supplier_packaging_qty: item.supplier_packaging_qty || null,
    supplier: item.supplier || null,
    location: item.location || null,
    status: computeStatus(item),
    updated_date: item.updated_date || null,
  };
}

function sanitizePurchaseOrder(po) {
  const items = Array.isArray(po.items)
    ? po.items.slice(0, 25).map(item => ({
      ingredient: item?.ingredient || null,
      quantity: numberOrNull(item?.quantity),
      unit: item?.unit || null,
      unit_cost: numberOrNull(item?.unit_cost),
    })).filter(item => item.ingredient)
    : [];

  return {
    id: po.id || null,
    po_number: po.po_number || null,
    supplier: po.supplier || null,
    status: po.status || null,
    item_count: items.length,
    items,
    total_amount: numberOrNull(po.total_amount),
    order_date: po.order_date || null,
    expected_date: po.expected_date || null,
    updated_date: po.updated_date || null,
  };
}

function buildOpenPoQuantityMap(purchaseOrders) {
  const map = new Map();

  for (const po of purchaseOrders) {
    if (!Array.isArray(po.items)) continue;
    for (const item of po.items) {
      const key = normalizeKey(item?.ingredient);
      if (!key) continue;
      const quantity = numberOrNull(item?.quantity) || 0;
      const existing = map.get(key) || { quantity: 0, po_numbers: [] };
      existing.quantity += quantity;
      if (po.po_number && !existing.po_numbers.includes(po.po_number)) {
        existing.po_numbers.push(po.po_number);
      }
      map.set(key, existing);
    }
  }

  return map;
}

function buildProcurementPlan(items, purchaseOrders) {
  const openPoQuantityMap = buildOpenPoQuantityMap(purchaseOrders);

  return items
    .filter(item => item.status !== 'ok')
    .map(item => {
      const stock = item.stock ?? 0;
      const target = item.max_stock ?? item.reorder_point ?? 0;
      const suggestedQuantity = Math.max(0, target - stock);
      const openPo = openPoQuantityMap.get(normalizeKey(item.ingredient)) || { quantity: 0, po_numbers: [] };
      const netSuggestedQuantity = Math.max(0, suggestedQuantity - openPo.quantity);
      const costPerUnit = item.cost_per_unit ?? null;

      return {
        inventory_item_id: item.id,
        ingredient: item.ingredient,
        category: item.category,
        supplier: item.supplier,
        status: item.status,
        stock: item.stock,
        reorder_point: item.reorder_point,
        max_stock: item.max_stock,
        unit: item.unit,
        supplier_packaging_unit: item.supplier_packaging_unit,
        supplier_packaging_qty: item.supplier_packaging_qty,
        suggested_quantity: suggestedQuantity,
        open_po_quantity: openPo.quantity,
        open_po_numbers: openPo.po_numbers.slice(0, 10),
        net_suggested_quantity: netSuggestedQuantity,
        estimated_cost: costPerUnit === null ? null : Number((netSuggestedQuantity * costPerUnit).toFixed(2)),
      };
    })
    .sort((a, b) => {
      const bySupplier = (a.supplier || '').localeCompare(b.supplier || '');
      if (bySupplier !== 0) return bySupplier;
      return (a.ingredient || '').localeCompare(b.ingredient || '');
    });
}

function buildProcurementSummary(plan, purchaseOrders) {
  const suppliers = new Set(plan.map(item => normalizeText(item.supplier)).filter(Boolean));
  return {
    procurement_item_count: plan.length,
    procurement_supplier_count: suppliers.size,
    open_purchase_order_count: purchaseOrders.length,
    net_procurement_item_count: plan.filter(item => Number(item.net_suggested_quantity || 0) > 0).length,
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
    const [inventoryItems, purchaseOrders] = await Promise.all([
      base44.asServiceRole.entities.InventoryItem.list('-updated_date', QUERY_LIMIT),
      base44.asServiceRole.entities.PurchaseOrder.list('-updated_date', 100),
    ]);

    const sanitizedItems = (inventoryItems || [])
      .map(sanitizeItem)
      .sort(sortItems);
    const openPurchaseOrders = (purchaseOrders || [])
      .map(sanitizePurchaseOrder)
      .filter(po => OPEN_PO_STATUSES.has(normalizeKey(po.status)))
      .slice(0, 50);
    const procurementPlan = buildProcurementPlan(sanitizedItems, openPurchaseOrders);
    const summary = {
      ...buildSummary(sanitizedItems),
      ...buildProcurementSummary(procurementPlan, openPurchaseOrders),
    };

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
      procurement_plan: procurementPlan.slice(0, 100),
      open_purchase_orders: openPurchaseOrders,
    });
  } catch (error) {
    console.error('[INVENTORY-STATUS-SUMMARY] Error:', error.message);
    return Response.json({ error: 'Unable to load inventory status summary' }, { status: 500 });
  }
});
