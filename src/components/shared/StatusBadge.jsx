import { getStatusClasses } from '@/lib/statusColors';

// Extended label map — maps raw status values to display labels
const LABELS = {
  new: 'New',
  New: 'New',
  paid: 'Paid',
  Paid: 'Paid',
  authorized: 'Authorized',
  pending: 'Pending',
  Pending: 'Pending',
  refunded: 'Refunded',
  Refunded: 'Refunded',
  canceled: 'Canceled',
  Cancelled: 'Cancelled',
  completed: 'Completed',
  Completed: 'Completed',
  completed_pending_verification: 'Needs Verification',
  verified_logged: 'Verified',
  planned: 'Planned',
  ready_for_production: 'Ready',
  in_production: 'In Production',
  production_scheduled: 'Scheduled',
  bottled: 'Bottled',
  labeled: 'Labeled',
  qc_checked: 'QC Checked',
  packed: 'Packed',
  in_cold_storage: 'Cold Storage',
  assigned_for_pickup: 'For Pickup',
  assigned_for_delivery: 'For Delivery',
  fulfilled: 'Fulfilled',
  delivered: 'Delivered',
  passed: 'Passed',
  failed: 'Failed',
  scheduled: 'Scheduled',
  in_transit: 'In Transit',
  'In Transit': 'In Transit',
  Scheduled: 'Scheduled',
  Packed: 'Packed',
  Confirmed: 'Confirmed',
  Unassigned: 'Unassigned',
};

export default function StatusBadge({ status, className = '' }) {
  const label = LABELS[status] || status;
  const colorClasses = getStatusClasses(status);

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${colorClasses} ${className}`}>
      {label}
    </span>
  );
}