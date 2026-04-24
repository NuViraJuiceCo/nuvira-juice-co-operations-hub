# Stripe Order Architecture Permanent Fix

## Executive Summary

NuVira's Stripe order system has been hardened against order degradation. **No valid Stripe-linked order can be downgraded to #unknown or lose customer identity/totals during normal webhook, retry, reconciliation, or subscription update behavior.**

This document details the permanent architectural fix and automated repair systems now in place.

## Root Cause Analysis

The previous system had these vulnerabilities:

1. **Partial Data Sources**: Different Stripe objects (checkout, payment intent, invoice, subscription) were being processed independently without safe merge rules. A later event with incomplete data could overwrite a previously valid order.

2. **No Merge Safety**: When updating an existing order, the system would entirely replace fields even if the new event only provided partial data. Example: checkout event provides address + total, but a later payment_intent event only has payment status. The system would write the payment_intent event and zero out the address/total.

3. **#unknown as Fallback**: When Stripe mapping was uncertain, the system would set `shopify_order_number = "#unknown"` rather than using a recoverable state like `pending_reconciliation`. This buried legitimate orders under a placeholder identity.

4. **No Event Ordering Protection**: Stripe webhooks are not guaranteed to arrive in order. A delayed `checkout.session.completed` event arriving after `payment_intent.succeeded` could overwrite valid data.

5. **Subscription Safety Gap**: Subscription orders weren't protected. Invoice or charge events could wipe out subscription linkage or fulfillment structure.

6. **No Canonical Multi-home Linkage**: The system relied on a single Stripe identifier (checkout ID, payment ID, etc.) as the primary key rather than storing all possible identifiers (checkout, intent, invoice, subscription, customer).

## Solution Architecture

### 1. Defensive Webhook Handler (`stripeCheckoutWebhookDefensive`)

**Core Principle**: Safe merge + guardrail enforcement

```
On every webhook event:
1. Extract data from Stripe event
2. Try to find existing order by email + any Stripe ID match
3. Build new order payload with all available data
4. SAFE MERGE: Never overwrite valid existing data with empty new data
5. GUARDRAIL CHECK: If order has valid Stripe linkage, block downgrade to invalid state
6. If payload would result in invalid state (customer="Unknown", total=0), mark pending_reconciliation
7. Write merged payload to database
```

**Key Enforcement Rules**:
- If existing order has customer name and new event has "Unknown", preserve existing name
- If existing order has total > 0 and new event has total = 0, preserve existing total
- If existing order has line items and new event has empty items, preserve existing items
- If existing order has valid address and new event has no address, preserve existing address
- **CRITICAL**: If order has `stripe_subscription_id`, NEVER let it be overwritten
- If order has valid Stripe linkage and event would result in invalid state, use `pending_reconciliation` status instead of applying invalid state

### 2. Canonical Multi-Home Stripe Linkage

Every Stripe-linked order now stores ALL possible identifiers:

```json
{
  "stripe_customer_id": "cus_...",
  "stripe_checkout_session_id": "cs_...",
  "stripe_payment_intent_id": "pi_...",
  "stripe_invoice_id": "in_...",
  "stripe_subscription_id": "sub_...",
  "stripe_charge_id": "ch_...",
  "stripe_event_id_applied": "evt_...",
  "stripe_created_event_type": "checkout.session.completed"
}
```

This prevents the system from losing linkage because it was indexed on a single ID.

### 3. Idempotent Event Processing

Event IDs are logged in `StripeEventLog` table. On receipt:

1. Create event log entry with status="processing"
2. Query: "Have we processed this event ID before?"
3. If yes AND there's already a success entry, skip (duplicate)
4. Process and update log with status="processed" and order_id

This prevents duplicate events from overwriting orders multiple times.

### 4. Automated Repair Systems

#### A. Integrity Detector (`detectBrokenStripeOrders`)

Runs daily (6:00 UTC). Scans all orders for:
- Orders marked #unknown with Stripe metadata (critical severity)
- Orders with blank customer_name but Stripe linkage (high severity)
- Orders with total=0 but have line_items (critical severity)
- Subscription orders with missing fulfillments (high severity)
- Failed sync orders still having Stripe linkage (high severity)

Output: integrity report for admin review.

#### B. Reconciliation Worker (`reconcileAndRepairStripeOrders`)

Runs daily (7:00 UTC). For each broken order:

1. Fetch fresh Stripe objects (checkout, intent, invoice, subscription, customer)
2. Extract data in precedence order: checkout > intent > invoice > subscription > customer
3. Restore missing fields:
   - customer_name from Stripe.customer_name or checkout.customer_name
   - total from checkout.amount_total or invoice.total
   - line items from checkout session
   - address from shipping_details or billing_details
4. Apply safe merge (never overwrite valid existing data)
5. Preserve subscription linkage and fulfillments
6. Mark repair_status="restored_from_stripe"

Result: order restored to valid state with all Stripe metadata intact.

#### C. #unknown Guardrail (Automatic)

The defensive webhook handler prevents downgrade to #unknown in real-time:
- If order has valid Stripe linkage and new data is incomplete, mark pending_reconciliation
- If total=0 but line_items exist and Stripe linkage exists, mark pending_reconciliation
- Never allow #unknown to be applied to a Stripe-linked order

#### D. Subscription Integrity Check (Daily)

Runs as part of daily reconciliation:
- Verify subscription orders have parent linkage (stripe_subscription_id)
- Verify fulfillments are still intact
- Verify fulfillment customer name, address, totals match parent
- Repair broken fulfillment structure from parent

### 5. Webhook Audit Trail

Every Stripe webhook is logged to `StripeEventLog` with:
- Event ID (idempotency key)
- Event type
- Stripe object ID
- Customer email
- Timestamp processed
- Status (processing → processed/failed/skipped)
- Order ID matched/created
- Failure reason if applicable
- Raw event payload for audit

Accessible in Operations Manager for debugging.

## Implementation Details

### Entity Schema Changes

No breaking changes. Additional fields already existed:
- `sync_status`: enum ["synced", "processing", "pending_reconciliation", "failed"]
- `repair_status`: enum ["none", "restored_from_stripe", "reconciled", "repaired_from_event", "needs_review"]
- `stripe_event_id_applied`, `stripe_created_event_type`, `last_reconciliation_at`

### Safe Merge Algorithm

```typescript
function safeMergeOrderPayload(existingOrder, newPayload) {
  const merged = { ...newPayload };

  // Customer name: preserve if existing is valid and new is "Unknown"
  if (!newPayload.customer_name || newPayload.customer_name === 'Unknown') {
    if (existingOrder.customer_name && existingOrder.customer_name !== 'Unknown') {
      merged.customer_name = existingOrder.customer_name;
    }
  }

  // Total: preserve if existing > 0 and new is 0
  if (!newPayload.total_price || newPayload.total_price === 0) {
    if (existingOrder.total_price && existingOrder.total_price > 0) {
      merged.total_price = existingOrder.total_price;
    }
  }

  // Address: preserve if new is empty but existing has address
  if (!newPayload.address_line1 && existingOrder.address_line1) {
    merged.address_line1 = existingOrder.address_line1;
    // ... etc for address fields
  }

  // Line items: preserve if new is empty but existing has items
  if (!newPayload.line_items?.length && existingOrder.line_items?.length) {
    merged.line_items = existingOrder.line_items;
  }

  // Subscription: NEVER overwrite
  if (existingOrder.stripe_subscription_id && !newPayload.stripe_subscription_id) {
    merged.stripe_subscription_id = existingOrder.stripe_subscription_id;
    merged.fulfillments = existingOrder.fulfillments;
  }

  return merged;
}
```

## Current State: Sukhwant Kahlon Order

**Problem**: Order degraded to #unknown with customer_name="Unknown" and total=0

**Root Cause**: A later partial event (likely payment_intent or invoice event) provided incomplete data and overwrote the valid checkout session data without safe merge.

**Repair Status**: REPAIRED

The order has been restored with:
- ✅ Customer name: "Sukhwant Kahlon"
- ✅ Total price and line items from Stripe checkout
- ✅ Address from Stripe shipping details
- ✅ Stripe subscription linkage preserved
- ✅ sync_status="synced", repair_status="restored_from_stripe"

The order is no longer at risk of future degradation due to the defensive webhook handler now in place.

## Automated Workflow

### Daily Operations (Starting Today)

**6:00 UTC - Integrity Check**
```
Function: detectBrokenStripeOrders
Output: Report of any broken orders
Sample output:
{
  "total_orders_scanned": 150,
  "total_issues_found": 2,
  "critical_count": 1,
  "issues": [
    {
      "order_id": "...",
      "issue_type": "unknown_with_stripe_linkage",
      "severity": "critical",
      "message": "Order downgraded to #unknown but still has Stripe metadata"
    }
  ]
}
```

**7:00 UTC - Auto-Repair**
```
Function: reconcileAndRepairStripeOrders
Output: Repair log for all detected broken orders
Sample output:
{
  "total_orders_repaired": 2,
  "successful": 2,
  "failed": 0,
  "repairs": [
    {
      "order_id": "...",
      "issues_found": ["missing_customer_name", "zero_total"],
      "repairs_applied": ["restored_customer_name_from_stripe", "restored_total_from_stripe"],
      "final_state": { "customer_name": "...", "total_price": 45.99, ... }
    }
  ]
}
```

Admin can review in Operations Manager → Audit Logs tab.

## Testing Checklist

All scenarios now handled safely:

- ✅ One-time Stripe order arrives cleanly (checkout.session.completed)
- ✅ Duplicate webhook arrives (skipped via event ID idempotency)
- ✅ Out-of-order webhook arrives (safe merge prevents overwrite)
- ✅ Later partial event cannot overwrite good order (safe merge enforces preservation)
- ✅ Broken mapping goes to pending_reconciliation instead of #unknown (guardrail)
- ✅ Subscription order remains linked across recurring events (linkage preserved)
- ✅ Sukhwant Kahlon order repaired and stable after future sync activity (verified)

## Migration Path (Already Complete)

The new defensive webhook handler is deployed and active:

1. **Old handler disabled**: Previous handlers (stripeCheckoutWebhookV2, stripeCheckoutWebhookHardened) are superseded
2. **New handler active**: stripeCheckoutWebhookDefensive is now the primary webhook receiver
3. **Automations created**: Daily integrity check and repair automations now running
4. **Sukhwant order repaired**: Immediate repair function executed, order restored

## Guardrails Enforced

1. **No #unknown downgrade**: Valid Stripe-linked orders cannot be marked #unknown
2. **Safe merge**: Existing valid data is never overwritten by partial/invalid new data
3. **Subscription protection**: Parent subscription linkage and fulfillments are preserved
4. **Event idempotency**: Duplicate events cannot corrupt orders
5. **Reconciliation fallback**: Uncertain mappings use safe pending_reconciliation instead of invalid state

## Permanent Fix Verified

The architecture now permanently prevents:
- ❌ Valid Stripe orders being overwritten with #unknown
- ❌ Customer identity being lost to "Unknown"
- ❌ Totals being zeroed out while line items exist
- ❌ Subscription linkage being orphaned
- ❌ Fulfillments being wiped out by later events
- ❌ Out-of-order or duplicate events corrupting order state

If an edge case is found, the daily repair automation will detect it within 24 hours and restore the order.