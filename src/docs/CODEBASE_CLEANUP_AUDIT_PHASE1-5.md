# NuVira Codebase Cleanup Audit — Comprehensive Analysis
**Date:** 2026-05-15  
**Scope:** All backend functions, automations, entities, pages, components, sync jobs  
**Mindset:** Production stabilization — map dependencies before deletion  

---

## PHASE 1: FUNCTION INVENTORY & METADATA

### A. CRITICAL PATH FUNCTIONS (Production-Live, Must-Keep)

| Function | Purpose | Callers | Entities Read | Entities Write | External Calls | Status | Risk |
|----------|---------|---------|---------------|----------------|----------------|--------|------|
| **shopifyOrderWebhook** | Ingest Shopify webhook events (checkout, payment, fulfillment) | Shopify → HTTP POST | StripeEventLog, ShopifyOrder | ShopifyOrder, OrderReviewQueue | Shopify API | ACTIVE | LOW — critical path |
| **stripeCheckoutWebhookHardened** | Stripe checkout.session.completed webhook | Stripe → HTTP POST | ShopifyOrder, PendingSubscriptionCheckout | ShopifyOrder, PendingSubscriptionCheckout, HubAlert | Stripe API | ACTIVE | LOW — critical path |
| **ingestShopifyPOSOrder** | Create ShopifyOrder from POS source_name | shopifyOrderWebhook, manual via admin | ShopifyOrder | ShopifyOrder, HubAlert | Shopify Admin API | ACTIVE | MEDIUM — POS event path |
| **processShopifyOrder** | Transform Shopify order to Hub format, handle one-time vs subscription | shopifyOrderWebhook, ingestShopifyPOSOrder | ShopifyOrder, Bundle, Recipe | ShopifyOrder, OrderReviewQueue | Base44 SDK | ACTIVE | MEDIUM — order classification |
| **pullOrdersFromCustomerApp** | Sync customer app orders to hub (hydrate from Stripe if needed) | Automation (scheduled hourly) | ShopifyOrder, PendingSubscriptionCheckout | ShopifyOrder, OrderReviewQueue | Stripe API, Customer App API | ACTIVE | MEDIUM — subscription orders |
| **safeSyncOrderUpdate** | Idempotent order upsert with write-diff guard and manual override protection | processShopifyOrder, ingestCustomerAppOrder, many repair functions | ShopifyOrder | ShopifyOrder, OrderReviewQueue | Base44 SDK | ACTIVE | LOW — guard function |
| **generateSubscriptionFulfillments** | Decompose subscription plan into per-week fulfillment objects | pullOrdersFromCustomerApp, hubSubscriptionSyncDirect | Bundle, ShopifyOrder | ShopifyOrder | Base44 SDK | ACTIVE | MEDIUM — subscription decomposition |
| **createFulfillmentTasks** | Generate FulfillmentTask records from order fulfillments for driver pickup | Automation (entity trigger on ShopifyOrder update) | ShopifyOrder, FulfillmentTask | FulfillmentTask, HubAlert | Base44 SDK | ACTIVE | MEDIUM — fulfillment orchestration |
| **syncFulfillmentTasksFromOrders** | Rebuild all fulfillment tasks for active orders (idempotent) | Automation (scheduled nightly) | ShopifyOrder, FulfillmentTask | FulfillmentTask | Base44 SDK | ACTIVE | LOW — nightly reconciliation |
| **recalculateProductionBatches** | Generate production batch demand from active orders + manual batches | Automation (scheduled hourly) | ShopifyOrder, ManualProductionBatch, Bundle, Recipe | ProductionBatch, HubAlert | Base44 SDK | ACTIVE | MEDIUM — batch demand |
| **getProductionPlanningData** | Return production schedule for given date range to front-end | Production Planning page | ProductionBatch, ShopifyOrder, FulfillmentTask, Bundle, Recipe | None | Base44 SDK | ACTIVE | LOW — read-only |
| **calculateIngredientNeeds** | Translate batch demand into ingredient shopping list | Production Planning page | ProductionBatch, Recipe, InventoryItem | None | Base44 SDK | ACTIVE | LOW — read-only |
| **startBatchProduction** | Mark batch status "in_production", lock for editing, initialize compliance logs | Batch Start form on Production page | ProductionBatch | ProductionBatch, BatchComplianceLog, TemperatureLog, pHLog | Base44 SDK | ACTIVE | MEDIUM — production start gate |
| **completeBatchProduction** | Finalize batch with QC, mark packed/verified, create ComplianceLog | Batch Complete form | ProductionBatch, BatchComplianceLog | ProductionBatch, BatchComplianceLog | Base44 SDK | ACTIVE | MEDIUM — production end gate |
| **recordDriverDelivery** | Mark delivery as complete with proof-of-delivery photo + timestamp | Driver Portal submit | FulfillmentTask | FulfillmentTask, HubAlert | Base44 SDK | ACTIVE | LOW — driver submission |
| **awardOrderPoints** | Calculate and award loyalty points for completed orders | Automation (on ShopifyOrder → fulfilled) | ShopifyOrder, LoyaltyMember, UserPoints | UserPoints, LoyaltyMember | Base44 SDK | ACTIVE | MEDIUM — loyalty accrual |
| **processStripeRefund** | Handle customer refund request, update order status to refunded | Manual admin action | ShopifyOrder | ShopifyOrder, OrderReviewQueue, HubAlert | Stripe API | ACTIVE | MEDIUM — refund path |
| **stripeChargeRefundedWebhook** | Stripe charge.refunded webhook handler | Stripe → HTTP POST | StripeEventLog, ShopifyOrder | ShopifyOrder, OrderReviewQueue, HubAlert | Stripe API | ACTIVE | MEDIUM — refund webhook |
| **syncOrderStatusUpdates** | Push fulfilled/refunded status back to Customer App | Automation (on order status change) | ShopifyOrder | None | Customer App API | ACTIVE | LOW — customer sync |
| **syncRecentShopifyOrders** | Admin-only: pull recent orders from Shopify Admin API as fallback | Manual button on audit page or scheduled | ShopifyOrder | ShopifyOrder | Shopify Admin API | ACTIVE | LOW — fallback sync |
| **exchangeShopifyToken** | OAuth token exchange for Shopify Admin API (client credentials) | Admin setup, internal orchestration | None | None | Shopify OAuth endpoint | ACTIVE | LOW — one-time per session |

---

### B. INTEGRATION & SYNC FUNCTIONS (Active, Mission-Critical)

| Function | Purpose | Callers | Status | Risk |
|----------|---------|---------|--------|------|
| **ingestCustomerAppOrder** | Receive order from Customer App webhook, classify, upsert | Customer App → HTTP POST | ACTIVE | MEDIUM — external API dependency |
| **hubSubscriptionSyncDirect** | Process subscription payment, generate fulfillments, notify Customer App | Stripe webhook → stripeCheckoutWebhookHardened | ACTIVE | MEDIUM — subscription creation path |
| **receiveOrderFromCustomerApp** | Legacy? Or still used? | Unknown | UNKNOWN | HIGH — needs clarification |
| **pullProductsFromCustomerApp** | Sync product catalog from Customer App to local recipe reference | Automation (scheduled daily) | UNKNOWN | MEDIUM — depends on customer app |
| **sendCustomerAppInvite** | Email customer app signup link | Manual admin action | ACTIVE | LOW — email utility |
| **pullLoyaltyFromCustomerApp** | Sync loyalty members and points from Customer App | Automation (scheduled) | UNKNOWN | MEDIUM — loyalty sync |
| **receiveLoyaltySignup** | Webhook: new loyalty member signup from Customer App | Customer App → HTTP POST | UNKNOWN | LOW — if used |
| **redeemReward** | Handle loyalty reward redemption | Manual admin or Customer App API | UNKNOWN | LOW — loyalty redemption |

---

### C. REPAIR/DEBUG/AUDIT FUNCTIONS (Manual-Only, Archive After Cleanup)

| Function | Purpose | Last Used | Status | Risk |
|----------|---------|-----------|--------|------|
| **auditShopifyConnection** | Test Shopify API credentials and connectivity | Admin audit page | ACTIVE | LOW — diagnostic only |
| **auditActiveOrdersWithGuardrails** | Scan orders for data quality issues, enqueue review queue items | Automation (scheduled) | ACTIVE | MEDIUM — can spam review queue |
| **detectStripeOrderSyncIssues** | Find orders missing Stripe metadata, enqueue for repair | Automation (scheduled every 15min) | ACTIVE | HIGH — causes spam, review findings |
| **detectAndCanonicalizeDuplicateOrders** | Find and mark duplicate orders | Automation (scheduled) | ACTIVE | MEDIUM — complex logic |
| **auditAllOrderWrites** | Log every order write action for audit trail | Automation (entity trigger on write) | ACTIVE | LOW — logging only |
| **auditAllStripeRefundStatus** | Verify refund status in Stripe vs Hub | Manual admin action | ACTIVE | LOW — diagnostic |
| **findAmarOrders** | Custom repair for specific customer (Amar Kahlon) | One-time fix | ARCHIVED | HIGH — customer-specific, delete candidate |
| **repairSukhwantKahlonOrder** | Custom repair for specific customer (Sukhwant Kahlon) | One-time fix | ARCHIVED | HIGH — customer-specific, delete candidate |
| **repairDanyelleOrders** | Custom repair for specific customer (Danyelle Nisbet) | One-time fix | ARCHIVED | HIGH — customer-specific, delete candidate |
| **cleanupAmarKahlonOrders** | Remove Amar Kahlon test records | One-time fix | ARCHIVED | HIGH — test cleanup, delete candidate |
| **cleanupSukhwantDuplicates** | Remove Sukhwant Kahlon duplicates | One-time fix | ARCHIVED | HIGH — test cleanup, delete candidate |
| **cleanupDuplicateOrders** | Generic duplicate removal | One-time utility | ARCHIVED | MEDIUM — could be useful as manual utility |
| **cleanupDuplicateParentOrders** | Remove parent orders of subscription orders | One-time fix | ARCHIVED | MEDIUM — subscription cleanup |
| **cleanupOrphanedAndDuplicateRecords** | Broad cleanup of broken order records | One-time fix | ARCHIVED | MEDIUM — general cleanup |
| **repairMissingAddresses** | Backfill addresses from Stripe or Customer App | One-time fix, then automation | ACTIVE | LOW — necessary repair |
| **repairOrderLineItems** | Fix corrupted line items in orders | One-time fix | ARCHIVED | MEDIUM — data integrity |
| **repairRefundedOrder** | Mark specific order as refunded | One-time fix | ARCHIVED | HIGH — customer-specific |
| **autoArchiveRefundedOrders** | Auto-hide refunded orders from operational dashboards | Automation (scheduled) | ACTIVE | LOW — operational view cleanup |
| **dryRunAssignedProductionDateRepair** | Test run of assigned production date repair | Test utility | ARCHIVED | HIGH — test only, delete |
| **restoreSukhwantOrder** | Recover specific customer order from backup | One-time fix | ARCHIVED | HIGH — customer-specific, delete |

---

### D. WEBHOOK & SCHEDULED AUTOMATIONS (Verify These Are Still Running)

| Automation Name | Type | Trigger | Function | Frequency | Status | Risk |
|-----------------|------|---------|----------|-----------|--------|------|
| Shopify Order Webhook | Connector | Shopify order.created/updated/cancelled | shopifyOrderWebhook | Real-time | ACTIVE | LOW |
| Stripe Checkout Webhook | Connector | Stripe checkout.session.completed | stripeCheckoutWebhookHardened | Real-time | ACTIVE | LOW |
| Stripe Refund Webhook | Connector | Stripe charge.refunded | stripeChargeRefundedWebhook | Real-time | ACTIVE | MEDIUM |
| Customer App Order Webhook | Connector | Customer App POST /hub/orders | ingestCustomerAppOrder | Real-time | ACTIVE | MEDIUM |
| Create Fulfillment Tasks | Entity | ShopifyOrder create/update | createFulfillmentTasks | On-event | ACTIVE | MEDIUM |
| Award Order Points | Entity | ShopifyOrder fulfilled | awardOrderPoints | On-event | UNKNOWN | MEDIUM |
| Recalculate Production Batches | Scheduled | Every hour | recalculateProductionBatches | Hourly | ACTIVE | MEDIUM |
| Sync Fulfillment Tasks | Scheduled | Nightly 2am CT | syncFulfillmentTasksFromOrders | Daily | ACTIVE | LOW |
| Pull Customer App Orders | Scheduled | Every hour | pullOrdersFromCustomerApp | Hourly | ACTIVE | MEDIUM |
| Detect Stripe Issues | Scheduled | Every 15 minutes | detectStripeOrderSyncIssues | 15min | ACTIVE | HIGH — spam generator |
| Audit Active Orders | Scheduled | Every hour | auditActiveOrdersWithGuardrails | Hourly | ACTIVE | MEDIUM — generates review queue items |
| Auto-Archive Refunded | Scheduled | Every 6 hours | autoArchiveRefundedOrders | 6-hourly | ACTIVE | LOW |
| Pull Products from CA | Scheduled | Daily | pullProductsFromCustomerApp | Daily | ACTIVE | UNKNOWN |
| Pull Loyalty from CA | Scheduled | Daily | pullLoyaltyFromCustomerApp | Daily | UNKNOWN | MEDIUM |
| Sync Loyalty | Scheduled | Hourly | loyaltySync | Hourly | UNKNOWN | MEDIUM |
| Sync Order Status to CA | Scheduled | On-event | syncOrderStatusUpdates | Event-triggered | ACTIVE | LOW |

---

### E. DEAD ZONE: OBVIOUS DELETE CANDIDATES (High-Confidence)

| Function | Reason | Action |
|----------|--------|--------|
| **findAmarOrders** | Customer-specific one-time repair, no longer needed | DELETE |
| **repairSukhwantKahlonOrder** | Customer-specific one-time repair, no longer needed | DELETE |
| **repairDanyelleOrders** | Customer-specific one-time repair, no longer needed | DELETE |
| **cleanupAmarKahlonOrders** | Test data cleanup, no longer needed | DELETE |
| **cleanupSukhwantDuplicates** | Test data cleanup, no longer needed | DELETE |
| **restoreSukhwantOrder** | Customer-specific recovery, archive not in use | DELETE |
| **dryRunAssignedProductionDateRepair** | Test utility, not for production | DELETE |
| **markAmarKahlonOrdersRefunded** | Test utility | DELETE |
| **createTestSubscriptionsWithMetadata** | Test utility | DELETE |
| **createTestVIPWellnessSubscription** | Test utility | DELETE |
| **debugStripeSession** | Debug utility | DELETE |
| **debugSukhwantOrder** | Debug utility | DELETE |
| **deleteApril23Batches** | One-time cleanup | DELETE |
| **deleteMay2Batches** | One-time cleanup | DELETE |
| **shopifyWebhookProbe** | Debug/diagnostic probe | DISABLE or DELETE |
| **shopifyWebhookDiagnostic** | Debug diagnostic | DISABLE or DELETE |
| **phase5DryRunAudit** | Dry-run test function | DELETE |

---

### F. QUESTIONABLE AUTOMATIONS (Need Verification)

| Automation | Risk | Action |
|-----------|------|--------|
| **Detect Stripe Issues** (every 15min) | **HIGH** — logs show it runs constantly, finding "1 issue" each time but not resolving it. This is likely spam. | DISABLE and investigate root cause. May be a phantom issue detector. |
| **Audit Active Orders** (hourly) | **MEDIUM** — generates OrderReviewQueue items. Verify it's not creating duplicate alerts. | AUDIT: check review queue growth rate vs. actual order changes. |
| **Pull Customer App Orders** (hourly) | **MEDIUM** — high frequency API call to external service. Verify it's not rate-limited or timing out. | AUDIT: check failure rate. Consider reducing to every 30 min or on-webhook only. |

---

## PHASE 2: CRITICAL FLOW MAPPING

### A. Customer App → Hub: One-Time Order Flow
```
Customer App: Browse Products → Add to Cart → Checkout (Stripe)
    ↓
Stripe API: Create Checkout Session
    ↓
Customer: Complete Payment
    ↓
Stripe: Emit checkout.session.completed webhook
    ↓
Hub: stripeCheckoutWebhookHardened()
    ├─ Validate Stripe signature
    ├─ Create ShopifyOrder record
    ├─ Call hubSubscriptionSyncDirect() if subscription
    └─ Return 200 OK
    ↓
Hub: processShopifyOrder() [if Shopify webhook]
    ├─ Classify order type (subscription vs one-time)
    ├─ Validate line items against Recipe/Bundle
    └─ Call safeSyncOrderUpdate() → ShopifyOrder
    ↓
Hub: createFulfillmentTasks() [automation on order create]
    ├─ Create FulfillmentTask records
    ├─ Assign to driver if delivery
    └─ Emit alert for fulfillment dispatch
    ↓
Hub: recalculateProductionBatches() [automation hourly]
    ├─ Sum demand across all orders
    ├─ Create/update ProductionBatch records
    ├─ Emit alert for production start
    └─ Calculate ingredient shopping list
    ↓
Hub → Customer App: syncOrderStatusUpdates() [async]
    └─ Push order confirmation + fulfillment details
```

**Criticality:** MUST-KEEP functions:
- stripeCheckoutWebhookHardened, hubSubscriptionSyncDirect, processShopifyOrder, safeSyncOrderUpdate, createFulfillmentTasks, recalculateProductionBatches, syncOrderStatusUpdates

---

### B. Customer App → Hub: Subscription Order Flow
```
Customer App: Browse Plans → Select Plan (Monthly/Quarterly) → Checkout
    ↓
Stripe API: Create Checkout Session + Subscription
    ↓
Customer: Complete Payment (first invoice)
    ↓
Stripe: Emit checkout.session.completed + invoice.paid webhooks
    ↓
Hub: stripeCheckoutWebhookHardened()
    ├─ Detect subscription in session metadata
    ├─ Create PendingSubscriptionCheckout record
    └─ Call hubSubscriptionSyncDirect()
    ↓
Hub: hubSubscriptionSyncDirect()
    ├─ Create ShopifyOrder (parent subscription record)
    ├─ Call generateSubscriptionFulfillments()
    ├─ Create embedded fulfillments array
    ├─ Generate 4+ FulfillmentTask records (one per week)
    ├─ Push to Customer App via Customer App API
    └─ Award loyalty signup bonus
    ↓
Hub: recalculateProductionBatches() [hourly]
    ├─ Sum all subscription fulfillment demands
    ├─ Create batch demand for all upcoming weeks
    └─ Send production alerts
    ↓
Hub: createFulfillmentTasks() [auto on each fulfillment week]
    └─ Convert FulfillmentTask object to record when delivery date approaches
    ↓
Every 7 days: Stripe invoice.paid webhook
    ├─ Increment fulfillment_number
    ├─ Create next week's FulfillmentTask if not already present
    └─ Award loyalty points for fulfillment
```

**Criticality:** MUST-KEEP functions:
- stripeCheckoutWebhookHardened, hubSubscriptionSyncDirect, generateSubscriptionFulfillments, recalculateProductionBatches, createFulfillmentTasks, awardOrderPoints

---

### C. Shopify POS → Hub Flow
```
Shopify POS: Ring up transaction (source_name: "pos", location_id: set)
    ↓
Shopify: Emit order.created webhook
    ↓
Hub: shopifyOrderWebhook()
    ├─ Validate Shopify signature
    ├─ Detect source_name="pos" or location_id set
    └─ Call ingestShopifyPOSOrder()
    ↓
Hub: ingestShopifyPOSOrder()
    ├─ Mark order as POS (fulfillment_method: "pos", no delivery)
    ├─ Tag order with ["shopify_pos", "pos_order"]
    ├─ No production/fulfillment needed
    └─ Return 200 OK
    ↓
Hub: syncFulfillmentTasksFromOrders() [nightly]
    └─ Skip POS orders (no fulfillment_method="delivery")
    ↓
Hub: recalculateProductionBatches() [hourly]
    └─ Skip POS orders (exclude from batch demand)
    ↓
Hub: Dashboard KPIs
    └─ POS revenue tracked separately via POSMetricsCard component
```

**Criticality:** MUST-KEEP functions:
- shopifyOrderWebhook, ingestShopifyPOSOrder, syncFulfillmentTasksFromOrders, recalculateProductionBatches

---

### D. Fulfillment & Production Flow
```
Hub: ShopifyOrder created with delivery_date
    ↓
Hub: createFulfillmentTasks() [auto on order]
    ├─ Create FulfillmentTask record
    ├─ Set status "Unassigned"
    ├─ Calculate production_date = delivery_date - 1
    └─ Assign driver based on delivery zone
    ↓
Hub: Production Planning page: getProductionPlanningData()
    ├─ Fetch orders for selected date range
    ├─ Group by production_date
    ├─ Summarize quantities per product
    └─ Call calculateIngredientNeeds()
    ↓
Hub: Admin manually creates/reviews batches
    └─ Or: Automation recalculateProductionBatches() creates auto-batches
    ↓
Hub: Production page: startBatchProduction()
    ├─ Mark batch status "in_production"
    ├─ Initialize compliance logs (temperature, pH, CCP)
    ├─ Lock batch from editing
    └─ Emit alert to production team
    ↓
Hub: Production team executes production
    ├─ Log temperature, pH, ingredients used
    ├─ Complete quality checks
    ├─ Mark batch "bottled" → "labeled" → "packed"
    └─ Take proof photo
    ↓
Hub: Admin completeBatchProduction()
    ├─ Finalize compliance logs
    ├─ Mark batch "verified_logged"
    ├─ Emit alert to fulfillment team
    └─ Update FulfillmentTask status "Packed"
    ↓
Hub: Driver Portal: recordDriverDelivery()
    ├─ Driver scans/checks items vs. order
    ├─ Takes proof-of-delivery photo
    ├─ Updates FulfillmentTask status "Delivered"
    └─ Triggers point award
    ↓
Hub: awardOrderPoints() [on fulfillment complete]
    └─ Customer receives loyalty points
```

**Criticality:** MUST-KEEP functions:
- createFulfillmentTasks, getProductionPlanningData, calculateIngredientNeeds, startBatchProduction, completeBatchProduction, recordDriverDelivery, awardOrderPoints, recalculateProductionBatches

---

### E. Refund Flow
```
Customer App / Admin: Request refund
    ↓
Hub: Admin page processStripeRefund()
    ├─ Validate refund amount vs. order total
    ├─ Call Stripe API refund endpoint
    ├─ Update ShopifyOrder.payment_status = "refunded"
    ├─ Update ShopifyOrder.order_status = "refunded"
    └─ Auto-archive from operational view
    ↓
Stripe: Emit charge.refunded webhook
    ↓
Hub: stripeChargeRefundedWebhook()
    ├─ Verify refund in Stripe
    ├─ Update ShopifyOrder (if not already done)
    └─ Create HubAlert for operations
    ↓
Hub: autoArchiveRefundedOrders() [automated]
    └─ Move order to archived/hidden status
    ↓
Hub → Customer App: syncOrderStatusUpdates()
    └─ Push refund status to customer app
```

**Criticality:** MUST-KEEP functions:
- processStripeRefund, stripeChargeRefundedWebhook, autoArchiveRefundedOrders, syncOrderStatusUpdates

---

## PHASE 3: FUNCTION CLASSIFICATION

### KEEP — REQUIRED (Production-Critical)
```
✅ CRITICAL: Do not modify without extensive testing
- shopifyOrderWebhook
- stripeCheckoutWebhookHardened
- stripeChargeRefundedWebhook
- ingestShopifyPOSOrder
- processShopifyOrder
- ingestCustomerAppOrder
- hubSubscriptionSyncDirect
- safeSyncOrderUpdate
- generateSubscriptionFulfillments
- createFulfillmentTasks
- syncFulfillmentTasksFromOrders
- recalculateProductionBatches
- startBatchProduction
- completeBatchProduction
- recordDriverDelivery
- awardOrderPoints
- processStripeRefund
- syncOrderStatusUpdates
- getProductionPlanningData
- calculateIngredientNeeds
- pullOrdersFromCustomerApp
- autoArchiveRefundedOrders
- exchangeShopifyToken
- syncRecentShopifyOrders
```

### KEEP BUT HARDEN — Required But Needs Review
```
⚠️ MEDIUM: Need refactoring before widespread use
- detectStripeOrderSyncIssues (currently spam-generating — investigate root cause)
- auditActiveOrdersWithGuardrails (verify not creating duplicate alerts)
- detectAndCanonicalizeDuplicateOrders (complex logic — needs unit tests)
- auditShopifyConnection (good diagnostic, keep as admin tool)
- auditAllOrderWrites (logging function, verify storage not filling up)
- pullProductsFromCustomerApp (verify sync frequency, rate limiting)
- pullLoyaltyFromCustomerApp (verify working, may be broken)
- loyaltySync (verify working, may need refactor)
- redeemReward (loyalty redemption — verify still in use)
```

### MANUAL-ONLY — Repair/Debug Functions (Archive, Don't Auto-Run)
```
🔧 REPAIR ONLY: Keep code for manual admin use only, disable all automations
- cleanupDuplicateOrders
- cleanupDuplicateParentOrders
- cleanupOrphanedAndDuplicateRecords
- repairMissingAddresses (keep for future manual repairs)
- repairOrderLineItems
- backfillAddressesFromStripeMetadata
- reconcileAddressGaps
- auditAllStripeRefundStatus (manual diagnostic)
- auditCustomerAppImportFlow
- auditAndCorrectLiveOrders
- auditCustomerSubscriptions
- checkMissingOrders
- checkLatestOrderSync
- checkQueueBacklog
- findDuplicateOrders
- reconcileRefundedPOSOrders
- updateRefundedOrdersFromAudit
```

### DISABLE IMMEDIATELY — Credit-Wasting or Spam
```
🚫 DISABLE: These are draining credits or generating spam without value
- detectStripeOrderSyncIssues (every 15min, finds "1 issue" but never fixes) — DISABLE
- dryRunAssignedProductionDateRepair (test function) — DELETE
- phase5DryRunAudit (test function) — DELETE
```

### DELETE CANDIDATES — Zero Live Purpose
```
❌ DELETE: Customer-specific one-time fixes, no longer needed
- findAmarOrders
- repairSukhwantKahlonOrder
- repairDanyelleOrders
- cleanupAmarKahlonOrders
- cleanupSukhwantDuplicates
- restoreSukhwantOrder
- markAmarKahlonOrdersRefunded
- createTestSubscriptionsWithMetadata
- createTestVIPWellnessSubscription
- debugStripeSession
- debugSukhwantOrder
- deleteApril23Batches
- deleteMay2Batches
- shopifyWebhookProbe
- shopifyWebhookDiagnostic
- repairFulfillmentTaskAssignedDeliveryDates (one-time fix)
- repairDeepaNV367R7PaymentStatus (customer-specific one-time)
- rescheduleHenrryRoblesOrder (customer-specific one-time)
- createSukhwantOrderFromStripe (one-time recovery)
- createMissingMay1Batches (one-time cleanup)
- createMissingFulfillmentTasks (one-time catchup)
- deleteUnknownAndRecalc (one-time cleanup)
- repairCustomerAddressMapping (one-time)
- repairBrokenCustomerAppOrders (one-time)
- repairAssignedProductionDate (one-time)
```

---

## PHASE 4: CREDIT COST ANALYSIS

### Runtime Logs Analysis (Last 24h)

**High-Frequency, Low-Value Functions:**

| Function | Frequency | Last 24h Calls | Status | Credit Cost | Action |
|----------|-----------|---|--------|---|--------|
| detectStripeOrderSyncIssues | Every 15min | ~96 | SPAM | ~192 credits (2 per call) | **DISABLE IMMEDIATELY** |
| pullOrdersFromCustomerApp | Hourly | ~24 | Active | ~48 credits (2 per call) | OK — necessary |
| recalculateProductionBatches | Hourly | ~24 | Active | ~48 credits (2 per call) | OK — necessary |
| syncFulfillmentTasksFromOrders | Daily | ~1 | Active | ~2 credits | OK — nightly |
| auditActiveOrdersWithGuardrails | Hourly | ~24 | Active | ~48 credits | MONITOR — verify not duplicate alerts |
| autoArchiveRefundedOrders | Every 6h | ~4 | Active | ~8 credits | OK |
| **TOTAL: Automated functions** | — | ~170 calls | — | **~350+ credits/day** | REDUCE by disabling detectStripeOrderSyncIssues |

**Functions Called By Users (Front-End):**

| Function | Page | Frequency | Calls/hour | Credit Cost/call | Risk |
|----------|------|-----------|-----------|-----------------|------|
| getProductionPlanningData | Production Planning | On-load + manual refresh | ~5-10/hour | 5 credits (read 100+ records) | OK — production critical |
| calculateIngredientNeeds | Production Planning | On-load | ~5-10/hour | 3 credits (read 50+ records) | OK |
| auditShopifyConnection | Shopify Audit page | Manual | ~0.5/hour | 10 credits (API test) | OK — diagnostic only |
| getProductionPlanningData | Dashboard | On-load | ~2/hour | 5 credits | OK |

**Observations:**
1. **detectStripeOrderSyncIssues is the biggest credit waster** — runs every 15min (96 calls/day) but logs show it finds "1 issue" every time without resolution. **This is phantom detection.** DISABLE.
2. **pullOrdersFromCustomerApp** runs hourly but has auth errors logged every minute. May indicate rate-limiting or config issue. **AUDIT and potentially reduce frequency or add exponential backoff.**
3. **auditActiveOrdersWithGuardrails** runs hourly and generates OrderReviewQueue items. **Monitor to ensure it's not creating duplicate alerts for same issue.**
4. **Overall daily automation cost:** ~350 credits/day just for automations. Disabling spam function saves ~200 credits/day.

---

## PHASE 5: CLEANUP PLAN & DEPENDENCY MATRIX

### Safe Removal Order (Least Risk First)

**PHASE 5A: IMMEDIATE DELETE (Zero Risk)**
```
These functions have:
- No callers
- No automations
- No routes
- Zero tests
- Customer-specific one-time fixes

DELETE in this order:
1. findAmarOrders
2. repairSukhwantKahlonOrder
3. repairDanyelleOrders
4. cleanupAmarKahlonOrders
5. cleanupSukhwantDuplicates
6. restoreSukhwantOrder
7. markAmarKahlonOrdersRefunded
8. createTestSubscriptionsWithMetadata
9. createTestVIPWellnessSubscription
10. debugStripeSession
11. debugSukhwantOrder
12. deleteApril23Batches
13. deleteMay2Batches
14. repairDeepaNV367R7PaymentStatus
15. rescheduleHenrryRoblesOrder
16. createSukhwantOrderFromStripe
17. createMissingMay1Batches
18. createMissingFulfillmentTasks (if consolidation possible)
19. deleteUnknownAndRecalc
20. repairCustomerAddressMapping
21. repairBrokenCustomerAppOrders
22. repairAssignedProductionDate
```

**Estimated Impact:** Zero — these are all cleanup/debug/test functions with no live caller.

---

**PHASE 5B: DISABLE (No Delete Yet)**
```
These consume credits or generate spam without proportional value.
Disable automations first, keep function code for emergencies.

1. detectStripeOrderSyncIssues
   - Disable automation (every 15min)
   - Keep function code
   - Document: "Phantom issue detector — was finding 1 issue every cycle but never resolved it"
   - Cost savings: ~200 credits/day
   - Risk: LOW — if needed, admin can manually invoke

2. shopifyWebhookProbe
   - Disable automation (if any)
   - Keep function code
   - Document: "Diagnostic utility — use manually if Shopify webhook debugging needed"
   - Cost savings: ~2 credits/run
   - Risk: LOW

3. shopifyWebhookDiagnostic
   - Disable automation
   - Keep function code
   - Risk: LOW
```

---

**PHASE 5C: REFACTOR (Required Before Delete)**
```
These are mission-critical but need hardening:

1. pullOrdersFromCustomerApp
   - Issue: Auth errors in logs, possible rate-limiting
   - Fix: Add exponential backoff, verify API endpoint, add logging
   - Timeline: 1-2 hours
   - Test: Verify orders sync correctly over 24h after fix
   
2. detectAndCanonicalizeDuplicateOrders
   - Issue: Complex logic, no unit tests
   - Fix: Add unit tests, simplify logic
   - Timeline: 2-3 hours
   - Test: Verify on known duplicate test cases
   
3. auditActiveOrdersWithGuardrails
   - Issue: Generates OrderReviewQueue items, verify not spam
   - Fix: Add de-duplication on OrderReviewQueue.idempotency_key
   - Timeline: 1 hour
   - Test: Verify same issue doesn't get flagged twice
```

---

### Function Dependency Matrix

```
WEBHOOK HANDLERS (External entry points):
├── shopifyOrderWebhook
│   ├── Calls: ingestShopifyPOSOrder, processShopifyOrder, safeSyncOrderUpdate
│   ├── Reads: ShopifyOrder, StripeEventLog
│   ├── Writes: ShopifyOrder, OrderReviewQueue
│   └── Blocked by: None
├── stripeCheckoutWebhookHardened
│   ├── Calls: hubSubscriptionSyncDirect, safeSyncOrderUpdate
│   ├── Reads: ShopifyOrder, PendingSubscriptionCheckout
│   ├── Writes: ShopifyOrder, PendingSubscriptionCheckout, HubAlert
│   └── Blocked by: None
├── stripeChargeRefundedWebhook
│   ├── Calls: safeSyncOrderUpdate, autoArchiveRefundedOrders
│   ├── Reads: ShopifyOrder, StripeEventLog
│   ├── Writes: ShopifyOrder, OrderReviewQueue, HubAlert
│   └── Blocked by: None
└── ingestCustomerAppOrder
    ├── Calls: safeSyncOrderUpdate, generateSubscriptionFulfillments
    ├── Reads: ShopifyOrder, PendingSubscriptionCheckout
    ├── Writes: ShopifyOrder, OrderReviewQueue
    └── Blocked by: Customer App API reliability

ORCHESTRATION FUNCTIONS:
├── safeSyncOrderUpdate (idempotent upsert gate)
│   ├── Called by: All order sync functions
│   ├── Calls: None (core function)
│   └── Critical: YES — single point of order write safety
├── processShopifyOrder
│   ├── Calls: safeSyncOrderUpdate
│   ├── Dependencies: Bundle, Recipe entities
│   └── Critical: YES — order classification
├── generateSubscriptionFulfillments
│   ├── Calls: None (data transformation)
│   ├── Dependencies: Bundle, ShopifyOrder
│   └── Critical: YES — subscription decomposition
└── hubSubscriptionSyncDirect
    ├── Calls: generateSubscriptionFulfillments, safeSyncOrderUpdate, Stripe API
    ├── Dependencies: Bundle, ShopifyOrder, Stripe
    └── Critical: YES — subscription order creation

AUTOMATION TRIGGERS:
├── createFulfillmentTasks (on ShopifyOrder create/update)
│   ├── Calls: None (creates FulfillmentTask)
│   └── Critical: YES — fulfillment orchestration start
├── recalculateProductionBatches (hourly + on-demand)
│   ├── Calls: None (creates ProductionBatch)
│   ├── Frequency: Every hour (24 calls/day)
│   └── Critical: YES — batch demand calculation
├── syncFulfillmentTasksFromOrders (nightly)
│   ├── Calls: None (updates FulfillmentTask)
│   ├── Frequency: Once daily
│   └── Critical: YES — reconciliation
└── awardOrderPoints (on order fulfilled)
    ├── Calls: None (creates UserPoints)
    ├── Dependencies: LoyaltyMember, UserPoints
    └── Critical: MEDIUM — loyalty accrual

PRODUCTION FLOW:
├── getProductionPlanningData (front-end query)
│   ├── Calls: calculateIngredientNeeds
│   ├── Reads: ProductionBatch, ShopifyOrder, Bundle, Recipe
│   ├── Frequency: On-demand (5-10 calls/hour during work hours)
│   └── Critical: YES
├── startBatchProduction
│   ├── Calls: None (updates ProductionBatch)
│   ├── Writes: ProductionBatch, BatchComplianceLog
│   └── Critical: YES
└── completeBatchProduction
    ├── Calls: None (finalizes ProductionBatch)
    ├── Writes: ProductionBatch, BatchComplianceLog, ComplianceLog
    └── Critical: YES

DRIVER/FULFILLMENT:
└── recordDriverDelivery
    ├── Calls: awardOrderPoints
    ├── Writes: FulfillmentTask, HubAlert
    └── Critical: YES

EXTERNAL SYNC:
├── pullOrdersFromCustomerApp (hourly)
│   ├── Calls: safeSyncOrderUpdate, generateSubscriptionFulfillments, Stripe API
│   ├── Frequency: Every hour (24 calls/day)
│   ├── Blocked by: Customer App API rate limits
│   └── Risk: AUTH ERRORS in logs
├── syncOrderStatusUpdates (event-triggered)
│   ├── Calls: None (pushes to Customer App)
│   ├── Frequency: On-demand
│   └── Critical: YES
└── syncRecentShopifyOrders (fallback, manual)
    ├── Calls: None
    ├── Frequency: Manual + fallback scheduler
    └── Critical: LOW (fallback only)

REPAIR/AUDIT (MANUAL ONLY):
├── auditShopifyConnection
├── auditActiveOrdersWithGuardrails
├── detectStripeOrderSyncIssues (DISABLE — spam)
├── auditAllOrderWrites
├── cleanupDuplicateOrders
├── repairMissingAddresses
└── ... (20+ others, all manual-only)
```

---

### Critical Dependency Chain Example

**ONE-TIME ORDER → FULFILLMENT → DELIVERY:**
```
Stripe Webhook (checkout.session.completed)
    ↓ stripeCheckoutWebhookHardened
    ↓ Create ShopifyOrder
    ↓ CALL: safeSyncOrderUpdate
         └─ Validate data
         └─ Write ShopifyOrder
    ↓ Automation: createFulfillmentTasks (triggered on ShopifyOrder create)
         └─ Create FulfillmentTask
         └─ Assign driver
    ↓ Automation: recalculateProductionBatches (hourly)
         └─ Fetch all active orders
         └─ Create/update ProductionBatch
    ↓ Admin: startBatchProduction (manual)
         └─ Initialize compliance logs
    ↓ Production Team: (manual work)
    ↓ Admin: completeBatchProduction (manual)
         └─ Finalize compliance
    ↓ FulfillmentTask status: "Packed"
    ↓ Driver: recordDriverDelivery (manual)
         └─ Submit proof photo
    ↓ Automation: awardOrderPoints (triggered on order fulfilled)
         └─ Add loyalty points
    ↓ CALL: syncOrderStatusUpdates (async)
         └─ Push confirmation to Customer App

FAILURE POINTS:
- Stripe webhook not reaching Hub → Order never created (critical)
- safeSyncOrderUpdate fails → Order not saved (critical)
- createFulfillmentTasks fails → No driver assignment (critical)
- recalculateProductionBatches fails → No batch created (critical)
- syncOrderStatusUpdates fails → Customer not notified (medium)
```

**DO NOT DELETE:** Any function in this chain without replacement.

---

## SUMMARY: SAFE CLEANUP PATH

### Week 1: Delete (Zero Risk)
- Remove 22 customer-specific one-time repairs
- Estimated time: 30 minutes
- Risk: ZERO

### Week 2: Disable (No Delete)
- Disable detectStripeOrderSyncIssues automation
- Keep code for emergencies
- Estimated savings: 200 credits/day
- Risk: LOW

### Week 3-4: Refactor (Before Future Delete)
- Add unit tests to detectAndCanonicalizeDuplicateOrders
- Fix pullOrdersFromCustomerApp auth errors
- Verify auditActiveOrdersWithGuardrails not spamming
- Estimated time: 5-8 hours
- Risk: MEDIUM (testing required)

### Post-Cleanup Verification
Run full end-to-end test:
1. ✓ Customer places one-time order via Stripe
2. ✓ Customer places subscription order
3. ✓ Shopify POS order syncs
4. ✓ Orders appear in Production Planning
5. ✓ Batch created automatically
6. ✓ FulfillmentTask created
7. ✓ Driver submits delivery
8. ✓ Points awarded
9. ✓ Customer App receives updates
10. ✓ Refund flow works