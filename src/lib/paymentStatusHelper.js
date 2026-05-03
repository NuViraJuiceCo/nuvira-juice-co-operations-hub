/**
 * Normalize order payment status with multi-field fallback logic.
 * Prevents stale pending UI when payment was actually captured/reconciled.
 */
export function getDisplayPaymentStatus(order) {
  if (!order) return 'pending';

  // Hard stops: refunded or canceled orders are always displayed as such
  if (order.payment_status === 'refunded') return 'refunded';
  if (order.production_status === 'refunded') return 'refunded';

  // Primary field: if payment_status is explicitly paid, use it
  if (order.payment_status === 'paid') return 'paid';

  // Fallback checks: order was paid even if payment_status is stale/missing
  // Check if Stripe PaymentIntent was verified and reconciliation confirms it
  if (
    order.stripe_payment_intent_id &&
    (order.payment_reconciliation_source === 'stripe_payment_intent_verified' ||
      order.payment_reconciliation_source === 'manual_owner_confirmation')
  ) {
    return 'paid';
  }

  // Check if payment was explicitly captured
  if (order.payment_captured === true) return 'paid';

  // Check alternative paid fields
  if (order.financial_status === 'paid') return 'paid';
  if (order.display_payment_status === 'paid') return 'paid';

  // Default to pending
  return 'pending';
}