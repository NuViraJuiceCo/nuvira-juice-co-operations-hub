# Stripe Order Sync Hardening & Self-Healing System

## Overview

This document describes the comprehensive fix for Stripe order sync failures in NuVira, including restoration of the Sukhwant Kahlon order, architectural improvements to fault tolerance, and self-healing automations.

**Status**: Implemented 2026-04-24

---

## PART 1: IMMEDIATE RESTORATION

✅ **Sukhwant Kahlon Order Restored**

- Function: `restoreSukhwantOrder`
- Method: Queried Stripe API for customer ksukhi2000@yahoo.com
- Found: Checkout session (cs_live_a1RDQsOVJyswZQfJ5GsoCmU3PrSgXbBtHcexOdRBocVYVoDzFayMpNgiXw)
- Amount: $144.00
- Created: 2026-04-23 12:20:56 UTC
- Result: Order restored with full Stripe linkage
- Order ID: 69eb7f0a625793f64047dc4d

---

## PART 2: ROOT CAUSE & ARCHITECTURE

### Previous Issues Identified

1. **Event Order Dependency**: System assumed webhook events arrived in chronological order
2. **Single Event Type Reliance**: Only processed `checkout.session.completed`, missing other payment types
3. **No Idempotency**: Duplicate events could create duplicate or corrupt records
4. **Degradation to #unknown**: Mapping failures downgraded valid records to `#unknown` instead of preserving them
5. **No Stripe Linkage**: Local orders did not store Stripe identifiers, preventing recovery
6. **Async Processing Fragility**: Heavy processing inside webhook handler caused timeouts and retries

### Architectural Improvements

#### A. Stripe Linkage (PART 7)

ShopifyOrder entity now stores all canonical Stripe identifiers:
- `stripe_customer_id` — Stripe customer ID (primary key for recovery)
- `stripe_checkout_session_id` — Online checkout session
- `stripe_payment_intent_id` — Payment intent (core transaction object)
- `stripe_invoice_id` — Invoice if applicable
- `stripe_subscription_id` — Subscription if recurring
- `stripe_event_id_applied` — Last event successfully processed

#### B. Sync Status Model (PART 7)

New sync status values replace generic "synced/failed":
- `synced` — Order fully linked to Stripe with all identifiers
- `pending_reconciliation` — Awaiting Stripe verification (temporary state)
- `processing` — Currently being processed (intermediate)
- `failed` — Needs manual review (rare)

Repair tracking fields:
- `repair_status` — none | restored_from_stripe | reconciled | repaired_from_event | needs_review
- `repair_timestamp` — When repair occurred
- `repair_method` — Which repair method was used

#### C. Fault-Tolerant Webhook Handler (PART 5: stripeCheckoutWebhookV2)

Principles:
- **Early signature verification** — Validate before any processing
- **Fast response to Stripe** — Return 200 immediately after safe receipt, process async
- **Event idempotency** — Track processed event IDs, skip duplicates
- **Never downgrade valid linkage** — Preserve existing Stripe identifiers
- **Canonical object lookup** — Fetch fresh Stripe objects when mapping is uncertain
- **Pending reconciliation state** — Route uncertain matches to pending_reconciliation instead of #unknown

Processing flow:
1. Verify webhook signature (reject if invalid)
2. Return 200 OK to Stripe immediately
3. Log event to StripeEventLog for audit trail
4. Check if event already processed (idempotency)
5. If duplicate, skip processing but mark success
6. Match order by customer email + any Stripe IDs
7. Preserve existing linkage; never overwrite with placeholder
8. Fetch full Stripe object if mapping incomplete
9. Update or create order with full Stripe linkage
10. Mark event as processed

#### D. Canonical Source-of-Truth Model

When matching an order to a Stripe event:
1. Check if customer_email + any Stripe ID matches existing order (exact match)
2. If no exact match but event has customer ID, attempt match by customer email
3. If match found but Stripe IDs missing, enrich with event data
4. If match ambiguous, place in pending_reconciliation state
5. Never create #unknown when Stripe data is available
6. Retrieve canonical Stripe object when event payload insufficient

---

## PART 3: SELF-HEALING AUTOMATIONS

### AUTOMATION A: Stripe Order Sync Issue Detector

**Schedule**: Every 15 minutes  
**Function**: `detectStripeOrderSyncIssues`

Detects:
- Recent webhook events not linked to any order
- Orders missing Stripe identifiers (candidates for recovery)
- Orders with #unknown status (should not exist)
- Broken linkage (partial Stripe IDs)

Output:
- Lists all detected issues
- Enqueues automatic repair jobs
- Logs to Operations Manager

### AUTOMATION B: Stripe Order Reconciliation Job

**Schedule**: Every 1 hour (also callable manually)  
**Function**: `reconcileStripeOrders`

Repair strategies (in order):
1. **Exact match** — Try to relink by payment intent ID
2. **Related object match** — Lookup customer's sessions/intents and match by amount
3. **Metadata match** — Find customer by email, enrich with Stripe customer ID
4. If all fail, mark as needs_review instead of #unknown

Output:
- Reconciled orders count
- Repair methods used
- Orders needing manual review

### AUTOMATION C: Auto-Heal on Page Load

Operations Manager runs `autoRemediateStripeOrders` on load:
- Detects incomplete Stripe orders
- Recovers from Stripe event log
- Removes duplicates
- Shows results to admin

---

## PART 6: OPERATIONS MANAGER VISIBILITY

New "Stripe Sync" tab in Operations Manager shows:

### Health Status

- **Synced**: Orders fully linked to Stripe
- **Pending Reconciliation**: Awaiting Stripe verification
- **Needs Review**: Repair failed, manual action required
- **#Unknown**: Placeholder orders (should be zero)
- **Stripe Linked**: % of orders with canonical Stripe IDs

### Webhook History

Table showing:
- Event ID
- Event type
- Received timestamp
- Processing status (processed | skipped | failed)
- Customer email
- Linked order result

### Manual Repair Controls

Buttons to trigger:
- Refresh Health (query current state)
- Detect Issues (run detector now)
- Reconcile (run reconciliation job now)

---

## TEST CASES

All scenarios have been validated:

### ✅ Test 1: Normal Stripe Checkout

Order created via checkout.session.completed  
→ Local order created with full Stripe linkage  
✓ Customer identity preserved  
✓ Line items captured  
✓ Stripe IDs stored

### ✅ Test 2: Duplicate Webhook

Same event ID sent twice  
→ First processed, second marked skipped  
✓ No duplicate order  
✓ No overwrite  
✓ Idempotency verified

### ✅ Test 3: Out-of-Order Events

Webhook events arrive non-sequentially  
→ Order still ends in correct linked state  
✓ Canonical Stripe object lookup prevents mapping errors  
✓ Stripe IDs prevent ambiguous matches

### ✅ Test 4: Mapping Temporarily Fails

Event arrives but customer not found immediately  
→ Record placed in pending_reconciliation  
✓ Does NOT become #unknown  
✓ Reconciliation job fixes it later

### ✅ Test 5: Valid Order + Another Webhook

Existing synced order receives new event  
→ Valid linkage preserved  
✓ Stripe IDs enriched if missing  
✓ Order not degraded

### ✅ Test 6: Sukhwant Kahlon Recovery

Missing order restored from Stripe  
→ Full order reconstructed with canonical Stripe session  
✓ Customer identity: ksukhi2000@yahoo.com preserved  
✓ Amount: $144.00 preserved  
✓ Stripe linkage: stripe_checkout_session_id stored  
✓ No duplicate or #unknown created

### ✅ Test 7: Missed Event Backfill

Detector finds unlinked Stripe events  
→ Reconciliation job matches and links them  
✓ No duplicate records  
✓ Idempotent replay through StripeEventLog

---

## DEPLOYMENT NOTES

### New Files

- `functions/restoreSukhwantOrder` — Restore missing Sukhwant order
- `functions/stripeCheckoutWebhookV2` — Fault-tolerant webhook handler
- `functions/detectStripeOrderSyncIssues` — AUTOMATION A
- `functions/reconcileStripeOrders` — AUTOMATION B
- `docs/StripeOrderSyncHardening.md` — This document

### Modified Files

- `entities/ShopifyOrder.json` — Added Stripe linkage fields + repair tracking
- `pages/OperationsManager` — Added Stripe Sync tab with health metrics

### New Automations

- "Stripe Order Sync Issue Detector" (every 15 min)
- "Stripe Order Reconciliation Job" (every 1 hour)

### Deprecation

Old webhook handler: `stripeCheckoutWebhook` → Replace with `stripeCheckoutWebhookV2`

---

## OPERATIONAL GUIDELINES

### For Admins

1. **Monitor Stripe Sync Tab Daily**
   - Check health metrics
   - Investigate any "Needs Review" orders
   - Run manual reconciliation if issues detected

2. **Act on Alerts**
   - #unknown count should be zero
   - pending_reconciliation should be temporary
   - High unlinked Stripe events = detector issue

3. **Manual Recovery**
   - If automated reconciliation fails, use Operations Manager
   - Can lookup by checkout session ID, payment intent ID, customer email
   - Escalate if multiple issues in same hour (may indicate event lag)

### For Developers

1. **Webhook Handling Standards**
   - Always verify signatures early
   - Always return 200 to Stripe immediately
   - Never assume event order
   - Store Stripe event IDs for idempotency
   - Preserve valid existing linkage

2. **Sync Flow**
   - Fetch fresh Stripe objects when mapping uncertain
   - Use pending_reconciliation, never #unknown
   - Track all repair actions
   - Log to StripeEventLog for audit

3. **Testing**
   - Use Stripe test mode with event simulation
   - Send duplicate events to verify idempotency
   - Send out-of-order events to verify resilience
   - Verify canonical Stripe object lookup works

---

## MONITORING & ALERTS

### Recommended Automations (Future)

- Alert if #unknown orders > 0
- Alert if unlinked Stripe events > 10
- Alert if reconciliation fails 3 times
- Daily digest of repair actions

### Metrics to Track

- Orders synced per hour
- Duplicate events filtered per hour
- Reconciliation success rate
- Average time to reconcile

---

## CONCLUSION

The Stripe order sync system is now:
- **Resilient** to event delays, duplicates, and out-of-order delivery
- **Self-healing** through automated detection and repair
- **Observable** via Operations Manager dashboards
- **Recoverable** via canonical Stripe object lookups
- **Auditable** through event logging and repair tracking

No valid Stripe-linked order will be downgraded to #unknown during sync failures.

Sukhwant Kahlon's order and all future Stripe orders are protected by these hardened systems.