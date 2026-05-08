# NuVira Subscription Cancellation & Pause Policy
**Version:** 1.0 — 2026-05-08  
**Status:** Production

---

## Core Rule

> **Once a monthly subscription payment is processed, the current billing cycle is locked. It cannot be cancelled or refunded by the customer through self-service.**

---

## Status Model

| Status | Meaning | Hub Order State | FulfillmentTask | ProductionBatch | Loyalty |
|---|---|---|---|---|---|
| `active_current_cycle` | Payment processed, deliveries active | `payment_status: paid`, no cancel tags | Scheduled — UNTOUCHED | Included — UNTOUCHED | Earned — INTACT |
| `cancel_at_period_end` | Customer cancelled future renewal | Same as above + `tags: ['cancel_at_period_end']` | **UNTOUCHED** | **UNTOUCHED** | **INTACT** |
| `pause_at_period_end` | Customer paused next cycle | Same as above + `tags: ['pause_at_period_end']` | **UNTOUCHED** | **UNTOUCHED** | **INTACT** |
| `cancelled_after_period_end` | Period ended, Stripe cancelled | `production_status: canceled`, excluded | Completed naturally | No new batches | INTACT (not reversed) |
| `admin_refunded_cancelled` | Admin override — refund issued | `payment_status: refunded`, `production_status: canceled` | Cancelled | Removed | Reversed (if applicable) |
| `internal_test_owner_override` | Owner test — not real customer behavior | Same as admin_refunded_cancelled | Cancelled | Removed | N/A |

---

## Event Flow

### Customer Self-Service Cancel (future renewal)

```
Customer clicks "Cancel Renewal"
  → Customer App confirms: "This stops your subscription after your current paid month. You still receive this month's deliveries."
  → Customer App sends POST /receiveCustomerAppEvent OR /handleSubscriptionFutureCancel
      event: customer.subscription_future_cancel
      cancel_type: future_cancel
  → Hub: sets cancel_at_period_end=true tag on ShopifyOrder
  → Hub: updates Stripe subscription with cancel_at_period_end=true (NOT immediate)
  → Hub: FulfillmentTasks — NOT TOUCHED
  → Hub: ProductionBatch — NOT TOUCHED
  → Hub: Loyalty — NOT REVERSED
  → When Stripe period ends: subscription becomes canceled, no new fulfillments created
```

### Customer Self-Service Pause (next cycle)

```
Customer clicks "Pause Next Month"
  → Customer App confirms: "Your current month remains active. Your next month will be paused."
  → Customer App sends POST /handleSubscriptionFutureCancel
      cancel_type: future_pause
  → Hub: sets pause_at_period_end=true tag on ShopifyOrder
  → Hub: updates Stripe subscription with cancel_at_period_end=true (pause = skip next cycle)
  → Hub: FulfillmentTasks — NOT TOUCHED
  → Hub: ProductionBatch — NOT TOUCHED
  → Hub: Loyalty — NOT REVERSED
```

### Admin Override Refund (current cycle)

```
Admin issues refund in Stripe dashboard OR triggers via Hub admin tools
  → Stripe fires charge.refunded webhook
  → stripeCheckoutWebhookHardened → processStripeRefund (cancel_type: admin_refund_cancel)
  → Hub: payment_status=refunded, production_status=canceled
  → Hub: FulfillmentTasks → Cancelled
  → Hub: ProductionBatch → order removed from order_sources
  → Hub: Loyalty → reverse (if applicable)
  → Internal notes: [ADMIN_REFUND] with reason
```

### Internal Test / Owner Override

```
Same as Admin Override Refund BUT:
  → internal_notes includes [INTERNAL_TEST_OWNER_OVERRIDE]
  → Does NOT represent customer-facing behavior
  → Not available as customer self-service
```

---

## Hub Function Reference

| Function | Purpose | Cascade? |
|---|---|---|
| `handleSubscriptionFutureCancel` | Customer future cancel/pause | ❌ No cascade — metadata only |
| `processStripeRefund` | Admin/Stripe refund (current cycle) | ✅ Full cascade |
| `receiveCustomerAppEvent` (event: `customer.subscription_future_cancel`) | Routes to handleSubscriptionFutureCancel | ❌ No cascade |
| `receiveCustomerAppEvent` (event: `customer.subscription_cancelled`) | Admin/Stripe-triggered full cancel | ✅ Full cascade |

---

## Customer App UI Requirements

### My Subscriptions Page

**After payment succeeds:**
- ✅ Show: `"Your current month is already confirmed. Changes apply to your next billing cycle."`
- ✅ Show button: `"Cancel Renewal"` (replaces any "Cancel" button)
- ✅ Show button: `"Pause Next Month"`
- ❌ Do NOT show: `"Cancel Current Order"` or `"Refund"`

**Cancel Renewal confirmation dialog:**
> "This will stop your subscription after your current paid month ends. You will still receive all deliveries scheduled for this month."

**Pause Next Month confirmation dialog:**
> "Your current month remains active. Your next billing month will be paused. You can reactivate anytime before your next payment date."

---

## Stripe Behavior Summary

| Action | Stripe API Call | Immediate Effect |
|---|---|---|
| Customer future cancel | `cancel_at_period_end=true` | No immediate change. Cancels at period end. |
| Customer future pause | `cancel_at_period_end=true` | No immediate change. Stops at period end. |
| Admin override refund | Stripe Dashboard refund | `charge.refunded` webhook fires → full Hub cascade |

---

## Do Not Do

- ❌ Do NOT call Stripe `subscription.cancel()` immediately for customer self-service
- ❌ Do NOT issue a refund on customer self-service cancel
- ❌ Do NOT cancel FulfillmentTasks when customer clicks "Cancel Renewal"
- ❌ Do NOT remove order from ProductionBatch on customer future cancel
- ❌ Do NOT reverse loyalty on future cancellation without a refund
- ❌ Do NOT treat owner test refunds as customer-facing behavior

---

## Hub API Contract for Customer App

### Future Cancel / Pause Endpoint

```
POST /handleSubscriptionFutureCancel
Authorization: Bearer <CUSTOMER_APP_SYNC_SECRET>
Content-Type: application/json

{
  "stripe_subscription_id": "sub_xxxxx",        // OR customer_app_subscription_id
  "customer_app_subscription_id": "ca_sub_xxx", // optional
  "customer_email": "customer@example.com",
  "cancel_type": "future_cancel",               // OR "future_pause"
  "effective_date": "2026-06-08",               // optional, derived from Stripe if not provided
  "reason": "Moving out of area"                // optional
}
```

**Response (200):**
```json
{
  "status": "success",
  "cancel_type": "future_cancel",
  "hub_order_id": "...",
  "effective_date": "2026-06-08",
  "stripe_cancel_at_period_end": true,
  "current_cycle": "PRESERVED — fulfillment tasks and production batches are UNAFFECTED",
  "customer_message": "Your current month is confirmed. Your subscription will not renew after this billing period. You will still receive all deliveries scheduled for this month."
}
```

---

## Testing Checklist

- [ ] Customer clicks "Cancel Renewal" → Hub order gets `cancel_at_period_end` tag, FulfillmentTask status unchanged, ProductionBatch unchanged
- [ ] Customer clicks "Pause Next Month" → Hub order gets `pause_at_period_end` tag, nothing else changes
- [ ] Stripe `cancel_at_period_end=true` confirmed via Stripe Dashboard
- [ ] No loyalty reversal on future cancel
- [ ] Admin override refund → full cascade (FulfillmentTask cancelled, batch updated, loyalty reversed)
- [ ] Admin refund logged with `[ADMIN_REFUND]` in internal_notes
- [ ] Internal test/owner override logged with `[INTERNAL_TEST_OWNER_OVERRIDE]`
- [ ] `monitorNewOrderChain` passes all 5 checks for a newly paid subscription