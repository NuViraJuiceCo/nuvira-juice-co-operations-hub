/**
 * NuVira Hub — Semantic Status Color System
 * Maps entity status values to Tailwind CSS class sets using design tokens.
 * Always use these helpers in components rather than one-off inline color classes.
 *
 * Usage:
 *   import { getStatusClasses, getStatusDot } from '@/lib/statusColors';
 *   <span className={getStatusClasses('paid')}>Paid</span>
 */

// ── Status → semantic bucket ────────────────────────────────────────────────

const STATUS_MAP = {
  // Success / Green
  paid: 'success',
  captured: 'success',
  completed: 'success',
  completed_pending_verification: 'warning',
  verified_logged: 'success',
  passed: 'success',
  delivered: 'success',
  fulfilled: 'success',
  synced: 'success',
  active: 'success',
  Valid: 'success',
  valid: 'success',
  Completed: 'success',
  Won: 'success',
  bottled: 'success',
  packed: 'success',

  // Info / Blue
  scheduled: 'info',
  in_production: 'info',
  production_scheduled: 'info',
  in_cold_storage: 'info',
  assigned_for_delivery: 'info',
  assigned_for_pickup: 'info',
  in_transit: 'info',
  labeled: 'info',
  qc_checked: 'info',
  authorized: 'info',
  'In Transit': 'info',
  Scheduled: 'info',
  Packed: 'info',
  Confirmed: 'success',

  // Warning / Amber
  pending: 'warning',
  awaiting_production: 'warning',
  new: 'warning',
  New: 'warning',
  ready_for_production: 'warning',
  planned: 'warning',
  Pending: 'warning',
  'Due Soon': 'warning',
  low_stock: 'warning',
  needs_review: 'warning',
  Unassigned: 'warning',
  Applied: 'warning',
  Contacted: 'warning',
  Negotiating: 'warning',
  'Proposal Sent': 'warning',

  // Danger / Red
  failed: 'danger',
  Failed: 'danger',
  blocked: 'danger',
  canceled: 'danger',
  Cancelled: 'danger',
  refunded: 'danger',
  Refunded: 'danger',
  expired: 'danger',
  Expired: 'danger',
  Overdue: 'danger',
  quarantined: 'danger',
  Lost: 'danger',

  // Admin / Purple
  test_order: 'admin',
  repair_function_executed: 'admin',
  system_tool: 'admin',
  admin: 'admin',
};

// ── Class sets per bucket ────────────────────────────────────────────────────

const BUCKET_CLASSES = {
  success: 'bg-status-success-bg text-status-success border border-status-success-border',
  info:    'bg-status-info-bg text-status-info border border-status-info-border',
  warning: 'bg-status-warning-bg text-status-warning border border-status-warning-border',
  danger:  'bg-status-danger-bg text-status-danger border border-status-danger-border',
  admin:   'bg-status-admin-bg text-status-admin border border-status-admin-border',
  neutral: 'bg-muted text-muted-foreground border border-border',
};

const BUCKET_DOT = {
  success: 'bg-status-success',
  info:    'bg-status-info',
  warning: 'bg-status-warning',
  danger:  'bg-status-danger',
  admin:   'bg-status-admin',
  neutral: 'bg-muted-foreground',
};

// ── Public helpers ───────────────────────────────────────────────────────────

/**
 * Returns Tailwind badge classes for a given status string.
 * @param {string} status
 * @returns {string} Tailwind class string
 */
export function getStatusClasses(status) {
  const bucket = STATUS_MAP[status] || 'neutral';
  return BUCKET_CLASSES[bucket];
}

/**
 * Returns the dot color class for status indicators.
 * @param {string} status
 * @returns {string} Tailwind bg class
 */
export function getStatusDot(status) {
  const bucket = STATUS_MAP[status] || 'neutral';
  return BUCKET_DOT[bucket];
}

/**
 * Returns just the text color class for a status.
 * @param {string} status
 * @returns {string}
 */
export function getStatusTextClass(status) {
  const bucket = STATUS_MAP[status] || 'neutral';
  return {
    success: 'text-status-success',
    info:    'text-status-info',
    warning: 'text-status-warning',
    danger:  'text-status-danger',
    admin:   'text-status-admin',
    neutral: 'text-muted-foreground',
  }[bucket];
}

export { BUCKET_CLASSES, STATUS_MAP };