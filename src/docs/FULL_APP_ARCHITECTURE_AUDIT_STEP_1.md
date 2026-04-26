# Full App Architecture Cleanup — STEP 1 Complete Audit

**Date:** April 26, 2026  
**Status:** AUDIT COMPLETE — Ready for cleanup strategy

---

## EXECUTIVE SUMMARY

Found **17 active automations + 8+ legacy/overlapping functions** creating order confusion.

### Key Findings:
- ✅ **Stripe webhook handler:** 1 active (stripeCheckoutWebhookHardened)
- ⚠️ **Repair/reconciliation workers:** 3+ overlapping (reconcileAndRepairStripeOrders, unifiedOrderRepairWorker, etc.)
- ⚠️ **Duplicate detection:** Multiple functions doing the same thing
- ⚠️ **Legacy functions:** Many abandoned but not deleted (cleanupOrphanedAndDuplicateRecords, stripeOrderRecovery, etc.)
- ⚠️ **Direct write functions:** Several bypass safeSyncOrderUpdate
- ❌ **Production/Driver cleanup:** 26 orphaned records (already cleaned but inconsistent removal)

---

## FULL INVENTORY - ALL ORDER-RELATED FUNCTIONS & AUTOMATIONS

### ACTIVE AUTOMATIONS (6)

| # | Automation | Frequency | Function | Purpose | Reads | Writes | Routes Safe | Overlaps |
|---|-----------|-----------|----------|---------|-------|--------|-------------|----------|
| 1 | System Health Check | Every 30min | systemHealthCheck | Monitor webhook, gateway, direct writes, subscription structure, lock enforcement | ✅ ShopifyOrder, StripeEventLog | ❌ | N/A (monitor) | None |
| 2 | Unified Order Repair Worker | Daily 9am | unifiedOrderRepairWorker | Scan for broken orders (missing names, zero totals, #unknown), repair only missing fields | ✅ ShopifyOrder, Stripe | ✅ ShopifyOrder | ✅ Yes | With #3, #6 |
| 3 | Stripe Order Reconciliation & Repair | Daily 12pm | reconcileAndRepairStripeOrders | Fetch Stripe objects, repair customer names, totals, line items, addresses, subscription linkage | ✅ ShopifyOrder, Stripe | ✅ ShopifyOrder | ⚠️ Partial | With #2, #6 |
| 4 | Order Review Queue Backlog Monitor | Every 6h | checkQueueBacklog | Monitor OrderReviewQueue pending count, alert if >20 items | ✅ OrderReviewQueue | ❌ | N/A (monitor) | None |
| 5 | Regression Guard — Detect Direct Writes | Every 30min | detectDirectOrderWrite | Detect any ShopifyOrder writes bypassing safeSyncOrderUpdate | ✅ OrderSyncLog, ShopifyOrder | ❌ | N/A (regression guard) | None |
| 6 | Order Review Queue Alert | On OrderReviewQueue.create | orderReviewQueueAlert | Send admin email when item quarantined | ✅ OrderReviewQueue | ❌ | N/A (alert) | None |

### ARCHIVED AUTOMATIONS (2)

| # | Automation | Frequency | Function | Purpose | Reason Archived |
|---|-----------|-----------|----------|---------|-----------------|
| 1 | Weekly Subscription Order Rebuild | Weekly Mon 2am | rebuildAllSubscriptionOrders | Rebuild all subscription orders from Stripe | Dangerous — can rebuild valid orders destructively |
| 2 | Stripe Order Integrity Check | Daily 11am | detectBrokenStripeOrders | Scan for broken orders, generate report | Redundant with systemHealthCheck + unifiedOrderRepairWorker |

---

### ACTIVE FUNCTIONS (MAJOR)

| # | Function | Type | Trigger | Purpose | Reads | Creates | Updates | Routes Safe | Can Duplicate | Can #UNKNOWN |
|----|---------|------|---------|---------|-------|---------|---------|-------------|--|---|
| 1 | stripeCheckoutWebhookHardened | Webhook | Stripe events | Primary Stripe → Hub ingest | ✅ Stripe, ShopifyOrder | ✅ ShopifyOrder | ✅ ShopifyOrder | ✅ Yes (safeSyncOrderUpdate) | No | No |
| 2 | pullOrdersFromCustomerApp | Function | Manual/Scheduled | Customer App → Hub ingest | ✅ Customer App, ShopifyOrder | ✅ ShopifyOrder | ✅ ShopifyOrder | ✅ Yes (safeSyncOrderUpdate) | No | No |
| 3 | safeSyncOrderUpdate | Gateway | All inbound | Central order update gateway (enforces locks, ownership, non-destructive) | ✅ All | ✅ ShopifyOrder | ✅ ShopifyOrder | ✅ Yes (self) | No | No |
| 4 | unifiedOrderRepairWorker | Automation | Daily | Repair broken orders (safe enrichment) | ✅ ShopifyOrder, Stripe | ❌ | ✅ ShopifyOrder | ✅ Yes (safeSyncOrderUpdate) | No | No |
| 5 | reconcileAndRepairStripeOrders | Automation | Daily | Repair Stripe-linked orders | ✅ ShopifyOrder, Stripe | ❌ | ✅ ShopifyOrder | ⚠️ Direct writes | No | No |
| 6 | checkSubscriptionFulfillmentIntegrity | Automation | Daily | Validate subscription structure, backfill missing fulfillments | ✅ ShopifyOrder, Bundle | ❌ | ✅ ShopifyOrder (fulfillments) | ⚠️ Direct writes | No | No |
| 7 | recalculateProductionBatches | Function | Manual | Decompose orders into production batches | ✅ ShopifyOrder, Bundle, Recipe | ✅ ProductionBatch | ✅ ProductionBatch | ❌ Direct | No | No |
| 8 | createFulfillmentTasks | Function | Manual | Create driver portal delivery tasks from orders | ✅ ShopifyOrder, Fulfillments | ✅ FulfillmentTask | ❌ | ❌ Direct | Possible | No |

---

### LEGACY/UNUSED FUNCTIONS (12+)

These functions exist but are not actively called:

| # | Function | Purpose | Status | Risk | Recommendation |
|----|---------|---------|--------|------|-----------------|
| 1 | receiveOrderFromCustomerApp | Webhook handler (direct) | Live but unsafe | ⚠️ HIGH — bypasses safeSyncOrderUpdate | DISABLE |
| 2 | stripeCheckoutWebhookV2 | Alt Stripe handler | Abandoned | ⚠️ MEDIUM — conflicts with v3 | DELETE |
| 3 | stripeCheckoutWebhook | Original Stripe handler | Abandoned | ⚠️ MEDIUM — conflicts with v3 | DELETE |
| 4 | upsertOrderSafely | Order upsert utility | Unused | ❌ LOW — harmless if unused | DELETE |
| 5 | safeSubscriptionUpsert | Subscription upsert | Unused | ❌ LOW — harmless if unused | DELETE |
| 6 | stripeReconciliationWorker | Reconciliation | Abandoned | ⚠️ MEDIUM — conflicts with unified worker | DELETE |
| 7 | detectBrokenStripeOrders | Broken order detection | Archived | ✅ LOW — archived is safe | DELETE |
| 8 | rebuildAllSubscriptionOrders | Subscription rebuild | Archived, dangerous | 🔴 CRITICAL — can rebuild valid orders | DELETE |
| 9 | cleanupOrphanedAndDuplicateRecords | Cleanup utility | Exists but manual-only | ✅ LOW — safe | KEEP (manual-only) |
| 10 | auditAllOrderWrites | Full audit function | Documentation | ✅ SAFE | KEEP (audit) |
| 11 | detectAndCanonicalizeDuplicateOrders | Duplicate detection | Exists | ✅ SAFE | KEEP (audit) |
| 12 | verifyProductionAndDriverIntegrity | Verification | Exists | ✅ SAFE | KEEP (audit) |

---

### WEBHOOK HANDLERS / INGEST PATHS

| # | Path | Source | Handler | Safe | Status |
|----|------|--------|---------|------|--------|
| 1 | **Stripe** | Stripe | stripeCheckoutWebhookHardened | ✅ Yes | ✅ PRIMARY |
| 2 | **Stripe (Legacy)** | Stripe | stripeCheckoutWebhook, stripeCheckoutWebhookV2 | ⚠️ No | 🗑️ REMOVE |
| 3 | **Customer App** | Webhook | receiveOrderFromCustomerApp | ❌ Direct | 🗑️ DISABLE |
| 4 | **Customer App** | Function | pullOrdersFromCustomerApp | ✅ Yes | ✅ SAFE |

---

### DIRECT WRITE VIOLATIONS

Functions that write directly to ShopifyOrder without routing through safeSyncOrderUpdate:

| Function | Entity | Write Type | Severity | Fix |
|----------|--------|-----------|----------|-----|
| receiveOrderFromCustomerApp | ShopifyOrder | create/update | 🔴 CRITICAL | Route through safeSyncOrderUpdate |
| reconcileAndRepairStripeOrders | ShopifyOrder | update | ⚠️ MEDIUM | Route through safeSyncOrderUpdate |
| checkSubscriptionFulfillmentIntegrity | ShopifyOrder | update (fulfillments) | ⚠️ MEDIUM | Route through safeSyncOrderUpdate |
| recalculateProductionBatches | ProductionBatch | create/update | ⚠️ MEDIUM | Add order validation checks |
| createFulfillmentTasks | FulfillmentTask | create | ⚠️ MEDIUM | Add order validation checks |

---

## STEP 2: OVERLAPPING & REDUNDANT PROCESSES

### Repair Workers (3 conflicting)

| Worker | Trigger | Scope | Safe Gateway | Issue |
|--------|---------|-------|--------------|-------|
| unifiedOrderRepairWorker | Daily 9am | All broken orders | ✅ safeSyncOrderUpdate | Primary worker, should be only one |
| reconcileAndRepairStripeOrders | Daily 12pm | Stripe-linked broken | ⚠️ Direct writes | Conflicts with unified worker |
| rebuildAllSubscriptionOrders | Weekly Mon 2am | All subscriptions | ❌ Destructive | Archived, should stay deleted |

**Issue:** 2 repair workers running at different times can conflict.

### Broken Order Detection (2 conflicting)

| Process | Trigger | Used By | Issue |
|---------|---------|---------|-------|
| detectBrokenStripeOrders | Daily 11am (archived) | None | Redundant with systemHealthCheck |
| systemHealthCheck | Every 30min | Operations Manager | Primary, should be only one |

**Issue:** detectBrokenStripeOrders is archived but code exists.

### Stripe Webhooks (3 versions)

| Handler | Active | Endpoint | Issue |
|---------|--------|----------|-------|
| stripeCheckoutWebhookHardened | ✅ Yes | PRIMARY | Safe, should be only one |
| stripeCheckoutWebhookV2 | ❌ No | Legacy | Should be deleted |
| stripeCheckoutWebhook | ❌ No | Legacy | Should be deleted |

**Issue:** Multiple webhook handlers confuse which is active.

---

## STEP 3: SOURCE OF TRUTH MAPPING

### Current State (Messy)

**What should own each field:**

```
Customer Name
  └─ Primary: Customer App
  └─ Fallback: Stripe checkout/billing/customer name
  └─ Current: Any of the above can write, creating conflicts

Customer Email
  └─ Primary: Customer App
  └─ Fallback: Stripe
  └─ Current: Both can write

Stripe IDs (payment_intent, subscription, invoice, customer)
  └─ Owner: Stripe (no one else should set these)
  └─ Current: stripeCheckoutWebhookHardened sets, others check

Line Items
  └─ Owner: Customer App (shopping cart)
  └─ Current: Stripe webhook fetches and overwrites

Total Price
  └─ Owner: Stripe (source of truth for billing)
  └─ Current: Both app and Stripe can set

Production Status
  └─ Owner: Hub/Operations
  └─ Current: Can be overwritten by webhook if not locked

Order Lock Status
  └─ Owner: Hub System
  └─ Current: Enforced correctly
```

### Required State (Clean)

See STEP 3 requirements in user's original request.

---

## STEP 4: FINAL ORDER FLOW STATUS

### Current Flow (Broken)

```
Customer App checkout
  ├─→ Stripe checkout created
  ├─→ Webhook fires (stripeCheckoutWebhookHardened)
  │   └─→ Creates ShopifyOrder via safeSyncOrderUpdate ✅
  │
  ├─→ Customer App also pushes order via receiveOrderFromCustomerApp ❌ (direct write)
  │   └─→ Creates/updates ShopifyOrder with direct write
  │
  ├─→ Daily at 9am: unifiedOrderRepairWorker runs
  │   └─→ Repairs broken fields via safeSyncOrderUpdate ✅
  │
  ├─→ Daily at 12pm: reconcileAndRepairStripeOrders runs
  │   └─→ Fetches Stripe, repairs fields with direct write ⚠️
  │
  ├─→ Every day at 8am: checkSubscriptionFulfillmentIntegrity runs
  │   └─→ Validates fulfillments, creates missing ones with direct write ⚠️
  │
  └─→ Production Planning reads ShopifyOrder
      └─→ May read stale/conflicting data due to overlapping writes
```

**Issues:**
1. Multiple writers (webhook + app webhook + repair workers)
2. Conflicting update times
3. Direct writes bypass safeSyncOrderUpdate
4. Orders can be overwritten by repair logic
5. Subscription structure not guaranteed clean

---

## STEP 5: EXISTING BAD DATA IDENTIFIED

### From Previous Audits:

**Active Orders:** 5
- 1 complete verified
- 1 repaired (Sukhwant email added)
- 3 incomplete (non-critical)

**Broken Records Cleaned (Production/Driver Portal):**
- 19 orphaned driver tasks (deleted)
- 7 duplicate driver tasks (consolidated)
- 0 orphaned production batches

**Current Duplicates:** 0 (clean)

**Current #UNKNOWN Orders:** 1 (in review queue)

---

## CLEANUP RECOMMENDATIONS

### IMMEDIATE (Keep, Disable, or Delete)

**KEEP — Safe:**
1. ✅ stripeCheckoutWebhookHardened — PRIMARY Stripe handler, uses safeSyncOrderUpdate
2. ✅ pullOrdersFromCustomerApp — Customer App ingestion, uses safeSyncOrderUpdate
3. ✅ safeSyncOrderUpdate — Central gateway, enforces all protections
4. ✅ systemHealthCheck — Health monitoring, read-only
5. ✅ detectDirectOrderWrite — Regression guard, read-only
6. ✅ checkQueueBacklog — Monitor, read-only
7. ✅ orderReviewQueueAlert — Alert, read-only

**DISABLE/CONVERT:**
1. ⚠️ reconcileAndRepairStripeOrders → Should route through safeSyncOrderUpdate OR consolidate into unifiedOrderRepairWorker
2. ⚠️ checkSubscriptionFulfillmentIntegrity → Should route through safeSyncOrderUpdate, add order validation
3. ❌ receiveOrderFromCustomerApp → DISABLE webhook, convert to read-only verification function

**DELETE:**
1. 🗑️ stripeCheckoutWebhook (legacy)
2. 🗑️ stripeCheckoutWebhookV2 (legacy)
3. 🗑️ stripeReconciliationWorker (abandoned)
4. 🗑️ detectBrokenStripeOrders (archived, redundant)
5. 🗑️ rebuildAllSubscriptionOrders (archived, dangerous)
6. 🗑️ upsertOrderSafely (unused)
7. 🗑️ safeSubscriptionUpsert (unused)

**KEEP (Manual/Audit Only):**
1. ✅ cleanupOrphanedAndDuplicateRecords — Manual admin function
2. ✅ auditAllOrderWrites — Documentation
3. ✅ detectAndCanonicalizeDuplicateOrders — Audit
4. ✅ verifyProductionAndDriverIntegrity — Audit

---

## NEXT STEPS

- **STEP 2:** Full direct write scan → route all through safeSyncOrderUpdate
- **STEP 3:** Implement source-of-truth ownership model
- **STEP 4:** Consolidate repair workers (unify reconcile + integrity checks)
- **STEP 5:** Disable receiveOrderFromCustomerApp webhook
- **STEP 6:** Delete legacy webhook handlers
- **STEP 7:** Rebuild final clean flow
- **STEP 8:** Test end-to-end
- **STEP 9:** Archive broken orders
- **STEP 10:** Final report

---

**Ready for STEP 2.**