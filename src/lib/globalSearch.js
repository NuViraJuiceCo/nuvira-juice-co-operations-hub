/**
 * NuVira Hub — Global Search Service
 * READ-ONLY. No writes, no mutations, no side effects.
 */
import { base44 } from '@/api/base44Client';

// ── Static page registry ─────────────────────────────────────────────────────
export const PAGES = [
  { title: 'Dashboard', route: '/', keywords: ['home', 'overview', 'stats', 'kpi', 'dashboard'] },
  { title: 'Orders', route: '/orders', keywords: ['orders', 'shopify', 'stripe', 'customer orders', 'nv-mo'] },
  { title: 'Production', route: '/production', keywords: ['production', 'batches', 'batch history', 'juice production'] },
  { title: 'Production Planning', route: '/production-planning', keywords: ['planning', 'production schedule', 'ingredient needs'] },
  { title: 'Production Scheduler', route: '/prod-scheduler', keywords: ['scheduler', 'weekly batches', 'batch planner'] },
  { title: 'Fulfillment', route: '/fulfillment', keywords: ['fulfillment', 'delivery tasks', 'driver', 'pickup'] },
  { title: 'Driver Portal', route: '/driver-portal', keywords: ['driver', 'route', 'deliveries', 'amar', 'driver portal'] },
  { title: 'Compliance Logs', route: '/compliance', keywords: ['compliance', 'logs', 'ph', 'sanitation', 'ccp', 'batch logs'] },
  { title: 'Compliance Center', route: '/compliance-center', keywords: ['compliance center', 'daily checklist', 'corrective action', 'temperature'] },
  { title: 'Labels & Allergens', route: '/compliance-center', keywords: ['label', 'labels', 'allergen', 'allergens', 'product labels', 'nutrition label', 'ingredient statement', 'allergen review', 'label review', 'net volume', 'barcode'] },
  { title: 'HACCP Plan Review', route: '/compliance-center', keywords: ['haccp', 'hazard analysis', 'food safety plan', 'ccp review', 'critical control point', 'haccp plan', 'corrective action review', 'verification procedure'] },
  { title: 'Operations Calendar', route: '/calendar', keywords: ['calendar', 'schedule', 'events calendar', 'operations'] },
  { title: 'Inventory', route: '/inventory', keywords: ['inventory', 'ingredients', 'stock', 'produce', 'reorder'] },
  { title: 'Suppliers', route: '/suppliers', keywords: ['suppliers', 'vendor', 'produce supplier'] },
  { title: 'Purchase Orders', route: '/purchase-orders', keywords: ['purchase orders', 'po', 'procurement'] },
  { title: 'Events', route: '/events', keywords: ['events', 'pop-up', 'market', 'festival', 'corporate'] },
  { title: 'Partnerships', route: '/partnerships', keywords: ['partnerships', 'leads', 'wholesale', 'b2b'] },
  { title: 'Loyalty Admin', route: '/loyalty-admin', keywords: ['loyalty', 'points', 'rewards', 'members'] },
  { title: 'Reporting', route: '/reporting', keywords: ['reporting', 'revenue', 'analytics', 'charts'] },
  { title: 'Resources', route: '/resources', keywords: ['resources', 'sops', 'documents', 'files', 'brand assets'] },
  { title: 'Operations Manager', route: '/operations-manager', keywords: ['system health', 'ops', 'status', 'stripe health'] },
  { title: 'Order Review Queue', route: '/order-review-queue', keywords: ['review queue', 'quarantine', 'rejected orders', 'repair queue'] },
  { title: 'Stripe Repair', route: '/stripe-repair', keywords: ['stripe repair', 'stripe recovery', 'stripe orders', 'stripe sync'] },
  { title: 'User Management', route: '/users', keywords: ['users', 'admin', 'staff', 'invite user'] },
  { title: 'Audit Logs', route: '/audit-logs', keywords: ['audit', 'logs', 'repair audit', 'history', 'changes'] },
  { title: 'Settings', route: '/settings', keywords: ['settings', 'preferences', 'configuration'] },
  { title: 'Report Scheduler', route: '/report-scheduler', keywords: ['report', 'scheduled report', 'weekly report'] },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
const q = (s) => (s || '').toLowerCase();

function matchesQuery(query, ...fields) {
  const lq = q(query);
  return fields.some(f => q(f).includes(lq));
}

function highlight(text, query) {
  if (!text || !query) return text || '';
  return String(text); // pass-through; highlighting done in UI
}

const LIMIT = 8;

// ── Category searchers (all read-only) ───────────────────────────────────────

async function searchPages(query) {
  const lq = q(query);
  return PAGES
    .filter(p => q(p.title).includes(lq) || p.keywords.some(k => k.includes(lq)))
    .slice(0, LIMIT)
    .map(p => ({
      id: p.route,
      type: 'Page',
      category: 'Pages',
      title: p.title,
      subtitle: p.route,
      status: null,
      meta: null,
      route: p.route,
      record_id: null,
      action: 'navigate',
    }));
}

async function searchOrders(query, isAdmin) {
  try {
    const all = await base44.entities.ShopifyOrder.list('-updated_date', 200);
    return all
      .filter(o => {
        if (!isAdmin && ['quarantined', 'test_order'].includes(o.data_quality_status)) return false;
        return matchesQuery(query,
          o.shopify_order_number, o.customer_name, o.customer_email,
          o.customer_phone, o.address_line1, o.address_city, o.address_postal_code,
          o.payment_status, o.production_status, o.order_lock_status,
          o.stripe_payment_intent_id, o.stripe_checkout_session_id, o.shopify_order_id,
          o.stripe_subscription_id, o.delivery_address,
        );
      })
      .slice(0, LIMIT)
      .map(o => ({
        id: o.id,
        type: 'Order',
        category: 'Orders',
        title: o.shopify_order_number || o.id,
        subtitle: [o.customer_name, o.customer_email].filter(Boolean).join(' — '),
        status: o.production_status || o.payment_status,
        meta: o.assigned_delivery_date ? `Delivery ${o.assigned_delivery_date}` : null,
        route: '/orders',
        record_id: o.id,
        action: 'view_only',
      }));
  } catch { return []; }
}

async function searchBatches(query) {
  try {
    const all = await base44.entities.ProductionBatch.list('-production_date', 200);
    return all
      .filter(b => matchesQuery(query,
        b.batch_id, b.product_name, b.production_date, b.status,
        b.production_status, (b.staff_on_duty || []).join(' '), b.assigned_to,
      ))
      .slice(0, LIMIT)
      .map(b => ({
        id: b.id,
        type: 'Batch',
        category: 'Production Batches',
        title: b.batch_id,
        subtitle: `${b.product_name} — ${b.production_date}`,
        status: b.status,
        meta: b.planned_units ? `${b.planned_units} units planned` : null,
        route: '/production',
        record_id: b.id,
        action: 'view_only',
      }));
  } catch { return []; }
}

async function searchComplianceLogs(query) {
  try {
    const all = await base44.entities.BatchComplianceLog.list('-date', 200);
    return all
      .filter(l => matchesQuery(query,
        l.batch_id, l.juice_flavor, l.date, l.passed_failed,
        l.verified_by, (l.staff_on_duty || []).join(' '),
      ))
      .slice(0, LIMIT)
      .map(l => ({
        id: l.id,
        type: 'ComplianceLog',
        category: 'Compliance Logs',
        title: l.batch_id || l.id,
        subtitle: `${l.juice_flavor} — ${l.date}`,
        status: l.passed_failed,
        meta: l.verified_by ? `Verified by ${l.verified_by.split('@')[0]}` : 'Unverified',
        route: '/compliance',
        record_id: l.id,
        action: 'view_only',
      }));
  } catch { return []; }
}

async function searchFulfillment(query) {
  try {
    const all = await base44.entities.FulfillmentTask.list('-scheduled_date', 200);
    return all
      .filter(f => matchesQuery(query,
        f.customer_name, f.address, f.assigned_driver,
        f.scheduled_date, f.status, f.order_id, f.items_summary,
      ))
      .slice(0, LIMIT)
      .map(f => ({
        id: f.id,
        type: 'DeliveryTask',
        category: 'Delivery / Fulfillment',
        title: f.customer_name,
        subtitle: `${f.fulfillment_type} — ${f.address || ''}`,
        status: f.status,
        meta: f.scheduled_date ? `Scheduled ${f.scheduled_date}` : null,
        route: '/fulfillment',
        record_id: f.id,
        action: 'view_only',
      }));
  } catch { return []; }
}

async function searchEvents(query) {
  try {
    const all = await base44.entities.Event.list('-date', 100);
    return all
      .filter(e => matchesQuery(query,
        e.name, e.type, e.date, e.location,
        e.contact_name, e.contact_email, e.status, e.notes,
      ))
      .slice(0, LIMIT)
      .map(e => ({
        id: e.id,
        type: 'Event',
        category: 'Events',
        title: e.name,
        subtitle: `${e.type} — ${e.location || ''}`,
        status: e.status,
        meta: e.date,
        route: '/events',
        record_id: e.id,
        action: 'view_only',
      }));
  } catch { return []; }
}

async function searchLoyalty(query) {
  try {
    const members = await base44.entities.LoyaltyMember.list('-updated_date', 100);
    const matched = members
      .filter(m => matchesQuery(query, m.email, m.full_name, m.phone, m.id))
      .slice(0, LIMIT)
      .map(m => ({
        id: m.id,
        type: 'Loyalty',
        category: 'Loyalty',
        title: m.full_name || m.email,
        subtitle: m.email,
        status: m.status,
        meta: m.total_points != null ? `${m.total_points} pts` : null,
        route: '/loyalty-admin',
        record_id: m.id,
        action: 'view_only',
      }));
    return matched;
  } catch { return []; }
}

async function searchLabelsAllergens(query) {
  try {
    const all = await base44.entities.LabelAllergenReview.list('-updated_date', 100);
    return all
      .filter(r => matchesQuery(query,
        r.product_name, r.label_version, r.ingredient_statement,
        r.allergen_statement, r.review_status, r.approval_status,
        r.reviewed_by, r.approved_by, r.notes,
      ))
      .slice(0, LIMIT)
      .map(r => ({
        id: r.id,
        type: 'ComplianceLog',
        category: 'Labels & Allergens',
        title: r.product_name,
        subtitle: `Label ${r.label_version || ''} — ${r.allergen_statement || 'No allergen statement'}`,
        status: r.approval_status,
        meta: r.review_date ? `Reviewed ${r.review_date}` : null,
        route: '/compliance-center',
        record_id: r.id,
        action: 'view_only',
      }));
  } catch { return []; }
}

async function searchHACCP(query) {
  try {
    const all = await base44.entities.HACCPPlanReview.list('-review_date', 100);
    return all
      .filter(r => matchesQuery(query,
        r.plan_version, r.review_period, r.review_date,
        r.reviewed_by, r.approval_status, r.approved_by,
        r.change_summary, r.notes,
      ))
      .slice(0, LIMIT)
      .map(r => ({
        id: r.id,
        type: 'ComplianceLog',
        category: 'HACCP Plan',
        title: `HACCP Plan ${r.plan_version}`,
        subtitle: r.review_period || r.review_date || '',
        status: r.approval_status,
        meta: r.review_date ? `Reviewed ${r.review_date}` : null,
        route: '/compliance-center',
        record_id: r.id,
        action: 'view_only',
      }));
  } catch { return []; }
}

async function searchSystemAudit(query, isAdmin) {
  if (!isAdmin) return [];
  try {
    const [auditLogs, reviewQueue] = await Promise.all([
      base44.entities.RepairAuditLog.list('-timestamp', 100),
      base44.entities.OrderReviewQueue.list('-updated_date', 100),
    ]);
    const auditResults = auditLogs
      .filter(l => matchesQuery(query,
        l.repair_function, l.executed_by, l.reason,
        l.changes ? JSON.stringify(l.changes) : '',
      ))
      .slice(0, 4)
      .map(l => ({
        id: l.id,
        type: 'System',
        category: 'System / Audit',
        title: l.repair_function,
        subtitle: `by ${(l.executed_by || '').split('@')[0]}`,
        status: l.action,
        meta: l.timestamp ? l.timestamp.slice(0, 10) : null,
        route: '/audit-logs',
        record_id: l.id,
        action: 'view_only',
      }));
    const queueResults = reviewQueue
      .filter(r => matchesQuery(query,
        r.customer_email, r.customer_name, r.existing_order_number,
        r.incident_type, r.issue_description, r.status,
      ))
      .slice(0, 4)
      .map(r => ({
        id: r.id,
        type: 'System',
        category: 'System / Audit',
        title: r.incident_type?.replace(/_/g, ' '),
        subtitle: [r.customer_name, r.customer_email].filter(Boolean).join(' — '),
        status: r.status,
        meta: r.existing_order_number || null,
        route: '/order-review-queue',
        record_id: r.id,
        action: 'view_only',
      }));
    return [...auditResults, ...queueResults];
  } catch { return []; }
}

// ── Main search entry point ───────────────────────────────────────────────────
export async function globalSearch(query, { isAdmin = false, includeArchived = false } = {}) {
  if (!query || query.trim().length < 2) return {};

  const [pages, orders, batches, compliance, fulfillment, events, loyalty, labels, haccp, system] = await Promise.all([
    searchPages(query),
    searchOrders(query, isAdmin),
    searchBatches(query),
    searchComplianceLogs(query),
    searchFulfillment(query),
    searchEvents(query),
    searchLoyalty(query),
    searchLabelsAllergens(query),
    searchHACCP(query),
    searchSystemAudit(query, isAdmin),
  ]);

  const results = {};
  if (pages.length) results['Pages'] = pages;
  if (orders.length) results['Orders'] = orders;
  if (batches.length) results['Production Batches'] = batches;
  if (compliance.length) results['Compliance Logs'] = compliance;
  if (labels.length) results['Labels & Allergens'] = labels;
  if (haccp.length) results['HACCP Plan'] = haccp;
  if (fulfillment.length) results['Delivery / Fulfillment'] = fulfillment;
  if (events.length) results['Events'] = events;
  if (loyalty.length) results['Loyalty'] = loyalty;
  if (isAdmin && system.length) results['System / Audit'] = system;

  return results;
}