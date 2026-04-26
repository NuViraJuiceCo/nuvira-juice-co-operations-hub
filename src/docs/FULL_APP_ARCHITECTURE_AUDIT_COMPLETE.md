# FULL APP ARCHITECTURE CLEANUP — COMPLETE AUDIT & REMEDIATION PLAN

**Date:** April 26, 2026  
**Status:** AUDIT COMPLETE — EXECUTION IN PROGRESS  
**Goal:** Stabilize order ecosystem, eliminate overlaps, enforce source-of-truth, prepare for production

---

## EXECUTIVE SUMMARY

**Audit Result:** 40+ functions and 17+ automations creating catastrophic overlap and redundancy in order processing. Multiple unsafe direct-write paths bypass safeSyncOrderUpdate. Stripe is not consistently treated as anchor.

**Critical Issues Found:**
- ❌ 3 Stripe webhook handlers (v1, v2, hardened) — only 1 needed
- ❌ 7+ repair/reconciliation workers — overlapping logic, conflicting updates
- ❌ Direct writes to ShopifyOrder bypassing safeSyncOrderUpdate
- ❌ Stripe subscription rebuild without lock protection
- ❌ Customer App webhook with direct writes (receiveOrderFromCustomerApp)
- ❌ No consistent identity mapping between systems
- ❌ Production Planning and Driver Portal reading unverified/duplicate records
- ❌ No order lock enforcement on syncs

**Cleanup Plan:** 
1. Delete 7 legacy/duplicate functions
2. Disable 3 unsafe/overlapping automations
3. Consolidate 5 repair workers into 1 unified master
4. Route all writes through 3 safe gateways
5. Implement strict source-of-truth enforcement
6. Lock production/driver records from overwrites
7. Move dangerous repairs to manual admin tools
8. Test end-to-end

---

## PART 1: FULL FUNCTION & AUTOMATION INVENTORY

### ACTIVE AUTOMATIONS (17 total)

| # | Name | Frequency | Trigger | Purpose | Reads | Writes | Safe Gateway | Status | Action |
|---|------|-----------|---------|---------|-------|--------|--------------|--------|--------|
| 1 | stripeCheckoutWebhookHardened | Real-time | Stripe events | Primary Stripe → Hub ingest | ShopifyOrder | ShopifyOrder | ✅ safeSyncOrderUpdate | ✅ KEEP | ACTIVE |
| 2 | stripeCheckoutWebhookV2 | Real-time | Stripe events | Alt Stripe handler | ShopifyOrder | ShopifyOrder | ❌ Direct | 🗑️ LEGACY | DELETE |
| 3 | stripeCheckoutWebhook | Real-time | Stripe events | Original Stripe handler | ShopifyOrder | ShopifyOrder | ❌ Direct | 🗑️ LEGACY | DELETE |
| 4 | receiveOrderFromCustomerApp | Webhook | Customer App | Customer app order webhook | ShopifyOrder | ShopifyOrder | ❌ Direct | ❌ UNSAFE | DISABLE |
| 5 | pullOrdersFromCustomerApp | Manual/Scheduled | Function call | Customer app sync | ShopifyOrder | ShopifyOrder | ✅ safeSyncOrderUpdate | ✅ KEEP | ACTIVE |
| 6 | reconcileAndRepairStripeOrders | Daily 12pm | Automation | Repair Stripe-linked orders | ShopifyOrder, Stripe | ShopifyOrder | ⚠️ Direct | ⚠️ OVERLAP | ARCHIVE |
| 7 | unifiedOrderRepairWorker | Daily 9am | Automation | Master repair worker | ShopifyOrder, Stripe | ShopifyOrder | ✅ safeSyncOrderUpdate | ✅ KEEP | ACTIVE |
| 8 | detectBrokenStripeOrders | Daily 11am | Automation | Detect broken orders | ShopifyOrder | None | N/A (monitor) | 🗑️ DUPLICATE | DELETE |
| 9 | rebuildAllSubscriptionOrders | Weekly Mon 2am | Automation | Rebuild all subscriptions | ShopifyOrder, Stripe | ShopifyOrder | ❌ Direct | 🔴 DANGEROUS | CONVERT TO MANUAL |
| 10 | checkSubscriptionFulfillmentIntegrity | Daily 8am | Automation | Validate subscription structure | ShopifyOrder | ShopifyOrder | ⚠️ Direct | ⚠️ UNSAFE | FIX TO ROUTE SAFE |
| 11 | systemHealthCheck | Every 30min | Automation | Monitor gateway health | ShopifyOrder, StripeEventLog | None | N/A (monitor) | ✅ SAFE | KEEP |
| 12 | detectDirectOrderWrite | Every 30min | Automation | Regression guard | OrderSyncLog | None | N/A (monitor) | ✅ SAFE | KEEP |
| 13 | checkQueueBacklog | Every 6h | Automation | Monitor review queue | OrderReviewQueue | None | N/A (monitor) | ✅ SAFE | KEEP |
| 14 | orderReviewQueueAlert | On create | Automation | Alert on quarantine | OrderReviewQueue | None | N/A (alert) | ✅ SAFE | KEEP |
| 15 | syncLoyaltyToHub | Schedule | Automation | Loyalty sync | LoyaltyMember | LoyaltyMember | ✅ SDK | ✅ SAFE | KEEP |
| 16 | syncEventData | Schedule | Automation | Event sync | Event | Event | ✅ SDK | ✅ SAFE | KEEP |
| 17 | syncProductData | Schedule | Automation | Product sync | Product | Product | ✅ SDK | ✅ SAFE | KEEP |

### ACTIVE FUNCTIONS (40+ total) — KEY ORDER FUNCTIONS LISTED

| # | Function | Type | Trigger | Reads | Writes | Safe Gateway | Create Orders | Update Orders | Can Overwrite | Status | Action |
|----|----------|------|---------|-------|--------|--------------|---------------|---------------|---------------|--------|--------|
| 1 | safeSyncOrderUpdate | Gateway | All inbound | ShopifyOrder | ShopifyOrder | ✅ Self (gateway) | ✅ Yes | ✅ Yes | ❌ No (enforces locks) | ✅ PRIMARY | KEEP |
| 2 | stripeCheckoutWebhookHardened | Webhook | Stripe | Stripe, ShopifyOrder | ShopifyOrder | ✅ safeSyncOrderUpdate | ✅ Yes | ✅ Yes | ❌ No (locked) | ✅ PRIMARY | KEEP |
| 3 | pullOrdersFromCustomerApp | Function | Manual | Customer App | ShopifyOrder | ✅ safeSyncOrderUpdate | ✅ Yes | ✅ Yes | ❌ No (locked) | ✅ PRIMARY | KEEP |
| 4 | receiveOrderFromCustomerApp | Webhook | Customer App | ShopifyOrder | ShopifyOrder | ❌ Direct | ✅ Yes | ✅ Yes | ✅ Yes (UNSAFE) | ❌ UNSAFE | DISABLE |
| 5 | unifiedOrderRepairWorker | Automation | Daily 9am | ShopifyOrder, Stripe | ShopifyOrder | ✅ safeSyncOrderUpdate | ❌ No | ✅ Yes (enrich only) | ❌ No (safe fields) | ✅ KEEP | KEEP |
| 6 | reconcileAndRepairStripeOrders | Automation | Daily 12pm | ShopifyOrder, Stripe | ShopifyOrder | ⚠️ Direct | ❌ No | ✅ Yes | ✅ Yes (OVERLAP) | ⚠️ REDUNDANT | ARCHIVE |
| 7 | checkSubscriptionFulfillmentIntegrity | Automation | Daily 8am | ShopifyOrder, Bundle | ShopifyOrder | ⚠️ Direct | ❌ No | ✅ Yes (fulfillments) | ✅ Yes (UNSAFE) | ⚠️ NEEDS FIX | FIX TO ROUTE SAFE |
| 8 | recalculateProductionBatches | Function | Manual | ShopifyOrder, Bundle, Recipe | ProductionBatch | ❌ Direct | ✅ Yes (batches) | ✅ Yes | ❌ No (validates) | ✅ KEEP | KEEP |
| 9 | createFulfillmentTasks | Function | Manual | ShopifyOrder | FulfillmentTask | ❌ Direct | ✅ Yes | ❌ No | ❌ No | ✅ KEEP | KEEP |
| 10 | systemHealthCheck | Function | Every 30min | ShopifyOrder, StripeEventLog | None | N/A | ❌ No | ❌ No | ❌ No | ✅ MONITOR | KEEP |
| 11 | detectDirectOrderWrite | Function | Every 30min | OrderSyncLog, ShopifyOrder | None | N/A | ❌ No | ❌ No | ❌ No | ✅ GUARD | KEEP |
| 12 | repairBrokenCustomerAppOrders | Function | Manual | ShopifyOrder, Stripe | ShopifyOrder | ✅ safeSyncOrderUpdate | ❌ No | ✅ Yes (enrich) | ❌ No (safe fields) | ✅ ADMIN TOOL | KEEP |
| 13 | stripeCheckoutWebhookV2 | Webhook | Stripe | ShopifyOrder | ShopifyOrder | ❌ Direct | ✅ Yes | ✅ Yes | ✅ Yes | 🗑️ LEGACY | DELETE |
| 14 | stripeCheckoutWebhook | Webhook | Stripe | ShopifyOrder | ShopifyOrder | ❌ Direct | ✅ Yes | ✅ Yes | ✅ Yes | 🗑️ LEGACY | DELETE |
| 15 | upsertOrderSafely | Utility | Unused | ShopifyOrder | ShopifyOrder | ❌ Direct | ✅ Yes | ✅ Yes | ✅ Yes | 🗑️ UNUSED | DELETE |
| 16 | safeSubscriptionUpsert | Utility | Unused | ShopifyOrder | ShopifyOrder | ❌ Direct | ✅ Yes | ✅ Yes | ✅ Yes | 🗑️ UNUSED | DELETE |
| 17 | stripeReconciliationWorker | Automation | Archived | ShopifyOrder, Stripe | ShopifyOrder | ⚠️ Direct | ❌ No | ✅ Yes | ✅ Yes | 🗑️ ARCHIVED | DELETE |
| 18 | detectBrokenStripeOrders | Function | Daily 11am | ShopifyOrder | None | N/A | ❌ No | ❌ No | ❌ No | 🗑️ DUPLICATE | DELETE |
| 19 | rebuildAllSubscriptionOrders | Function | Weekly | ShopifyOrder, Stripe | ShopifyOrder | ❌ Direct | ✅ Yes | ✅ Yes | ✅ Yes | 🔴 DANGEROUS | DELETE (CONVERT TO MANUAL) |
| 20+ | Various product, loyalty, event syncs | Sync | Various | Various | Various | ✅ SDK | ❌ No | ❌ No | ❌ No | ✅ SAFE | KEEP |

---

## PART 2: DIRECT WRITE VIOLATIONS

**Found 12+ functions writing directly to ShopifyOrder without safeSyncOrderUpdate:**

1. ❌ receiveOrderFromCustomerApp — direct ShopifyOrder.create/update
2. ❌ reconcileAndRepairStripeOrders — direct ShopifyOrder.update
3. ❌ checkSubscriptionFulfillmentIntegrity — direct ShopifyOrder.update (fulfillments)
4. ❌ stripeCheckoutWebhookV2 — direct ShopifyOrder.create
5. ❌ stripeCheckoutWebhook — direct ShopifyOrder.create
6. ❌ upsertOrderSafely — direct ShopifyOrder.create/update
7. ❌ safeSubscriptionUpsert — direct ShopifyOrder.create/update
8. ❌ stripeReconciliationWorker — direct ShopifyOrder.update
9. ❌ rebuildAllSubscriptionOrders — direct ShopifyOrder.create (rebuild)

**Required Fix:** All 9 must either be deleted or route through safeSyncOrderUpdate.

---

## PART 3: SOURCE OF TRUTH DEFINED

### **Stripe Owns:**
- payment_status
- stripe_payment_intent_id
- stripe_customer_id
- stripe_subscription_id
- stripe_invoice_id
- stripe_checkout_session_id
- stripe_charge_id
- subscription lifecycle
- recurring billing

### **Customer App Owns:**
- customer_name
- customer_email
- customer_phone
- delivery address (requested)
- customer_notes
- app user ID
- internal customer ID

### **Shopify Owns:**
- shopify_order_id
- shopify_order_number
- POS order records
- commerce reference
- product catalog

### **Hub App Owns:**
- production_status
- fulfillment_status
- delivery_status
- order_lock_status
- production_scheduled
- driver assignment
- delivery completion

### **System Owns:**
- data_quality_status
- sync_status
- source_channel
- repair_status
- line_items (from order intent)
- total_price (from Stripe)
- fulfillments (subscription deliveries)

**RULE:** No system overwrites fields it does not own.

---

## PART 4: SAFE GATEWAY CONSOLIDATION

**CONSOLIDATED to 3 PRIMARY GATEWAYS:**

1. **safeSyncOrderUpdate** — All order ingest/update (Stripe, Customer App, repair)
2. **recalculateProductionBatches** — Production record generation (read-only, no overwrite)
3. **createFulfillmentTasks** — Driver task generation (read-only, no overwrite)

**REMOVED unsafe gateways:**
- Direct ShopifyOrder writes
- Direct SubscriptionOrder writes
- Direct fulfillment writes without validation

---

## PART 5: CLEANUP ACTIONS PLANNED

### DELETE (Legacy/Duplicate/Unsafe):
- ✂️ stripeCheckoutWebhook
- ✂️ stripeCheckoutWebhookV2
- ✂️ stripeReconciliationWorker
- ✂️ detectBrokenStripeOrders
- ✂️ upsertOrderSafely
- ✂️ safeSubscriptionUpsert
- ✂️ rebuildAllSubscriptionOrders (AUTO) → convert to manual admin tool

### ARCHIVE (Overlapping/Redundant):
- 📦 reconcileAndRepairStripeOrders (consolidate into unifiedOrderRepairWorker)
- 📦 Duplicate weekly rebuild automation

### FIX (Unsafe writes):
- 🔧 receiveOrderFromCustomerApp → return 410 DEPRECATED (use pullOrdersFromCustomerApp)
- 🔧 checkSubscriptionFulfillmentIntegrity → route through safeSyncOrderUpdate

### KEEP (Safe/Primary):
- ✅ stripeCheckoutWebhookHardened
- ✅ pullOrdersFromCustomerApp
- ✅ unifiedOrderRepairWorker
- ✅ safeSyncOrderUpdate
- ✅ systemHealthCheck
- ✅ detectDirectOrderWrite
- ✅ checkQueueBacklog
- ✅ recalculateProductionBatches
- ✅ createFulfillmentTasks
- ✅ All loyalty/event/product syncs

---

## PART 6: ORDER FLOW (AFTER CLEANUP)

```
Customer App Checkout
  ↓
Stripe Checkout / Subscription Created
  ↓
Stripe → stripeCheckoutWebhookHardened
  ↓
safeSyncOrderUpdate (enforces locks & ownership)
  ↓
ShopifyOrder verified + locked
  ↓
Customer App enriches (optional) → pullOrdersFromCustomerApp → safeSyncOrderUpdate
  ↓
Shopify reference (optional) → attaches shopify_order_id
  ↓
Production Planning (verified delivery records only)
  ↓
recalculateProductionBatches
  ↓
Driver Portal (verified tasks only)
  ↓
createFulfillmentTasks
```

**GUARANTEES:**
- ✅ No duplicates
- ✅ No #UNKNOWN active orders
- ✅ No overwrite of production-scheduled records
- ✅ No downgrade of subscriptions
- ✅ No corruption of line items
- ✅ All syncs logged and auditable
- ✅ Risky repairs sent to review queue

---

## PART 7: EXECUTION STATUS

### COMPLETED (Step 1-2):
- ✅ Full function and automation audit
- ✅ Direct write violation scan
- ✅ Source of truth definition
- ✅ Safe gateway identification

### IN PROGRESS (Step 3-5):
- 🔄 Delete legacy webhook handlers
- 🔄 Archive redundant repair workers
- 🔄 Fix unsafe direct writes
- 🔄 Test all changes

### REMAINING (Step 6-17):
- 📋 Stripe-centered order anchor
- 📋 Customer identity map
- 📋 Non-destructive sync rules enforcement
- 📋 Order lock system validation
- 📋 Subscription structure confirmation
- 📋 Product metadata cleanup
- 📋 Existing bad order cleanup
- 📋 Production Planning cleanup
- 📋 Driver Portal cleanup
- 📋 Health check dashboard
- 📋 Final testing
- 📋 Final report

---

**NEXT:** Execute deletion and consolidation steps, then test and finalize.