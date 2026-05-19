# NuVira Unified Platform — Hub Architecture Map
**Date:** 2026-05-19  
**Status:** Read-only audit. No production code modified.  
**Purpose:** Prepare Hub for eventual migration into a single NuVira Platform with one source of truth.

---

## 1. ENTITY INVENTORY & RELATIONSHIPS

### Core Operational Entities (Source of Truth Candidates)

| Entity | Role | Relationships | Migration Classification |
|---|---|---|---|
| **ShopifyOrder** | Master order record. ALL order writes route through `safeSyncOrderUpdate` gateway | → FulfillmentTask (order_id) → ProductionBatch (related_orders) → OrderSyncLog (order_id) → UserPoints (order_id) → LoyaltyMember | **KEEP_CORE** — canonical, survives migration |
| **FulfillmentTask** | Driver-facing delivery unit, one per delivery window per order | → ShopifyOrder (order_id) → User (assigned_driver) | **KEEP_CORE** — operational truth for driver portal |
| **ProductionBatch** | Production scheduling unit per product per date | → ShopifyOrder (related_orders[]) → ManualProductionBatch | **KEEP_CORE** — physical production record |
| **ManualProductionBatch** | Internal-only production for non-order events (influencers, events) | → ProductionBatch (linked_production_batch_ids[]) | **KEEP_CORE** |
| **Bundle** | Subscription plan decomposition map (plan_name → per-fulfillment products) | → ShopifyOrder (via line_items matching) | **KEEP_CORE** — critical for subscription logic |
| **Recipe** | Ingredient formula per product | → ProductionBatch (formula_or_recipe_used) | **KEEP_CORE** |
| **InventoryItem** | Ingredient stock levels | → Supplier (implied) → PurchaseOrder | **KEEP_CORE** |
| **Supplier** | Vendor records | → PurchaseOrder → InventoryItem | **KEEP_CORE** |
| **PurchaseOrder** | Ingredient purchase tracking | → Supplier → InventoryItem | **KEEP_CORE** |

### Compliance Entities (All KEEP_CORE)

| Entity | Role |
|---|---|
| **TemperatureLog** | Cold storage HACCP monitoring |
| **SanitationLog** | Sanitizer/area clean records |
| **DailyChecklist** | Shift-level operational compliance |
| **BatchComplianceLog** | Per-batch production compliance |
| **CCPLog** | Critical Control Point monitoring |
| **CorrectiveActionLog** | Non-conformance correction records |
| **HACCPPlanReview** | HACCP plan version control |
| **LabelAllergenReview** | Label compliance review |
| **pHLog** | pH test records |
| **ComplianceDoc** | Uploaded compliance documents |
| **ComplianceAlert** | Triggered compliance alerts |
| **ComplianceLog** | General compliance log wrapper |

### Customer/Loyalty Entities

| Entity | Role | Migration Classification |
|---|---|---|
| **LoyaltyMember** | Hub-side loyalty ledger (total_points, lifetime_points) | **MERGE** — Customer App has its own loyalty state; unify into one entity |
| **UserPoints** | Individual point transaction ledger | **MERGE** — duplicated across apps |
| **Rewards** | Redeemable reward catalog | **MERGE** |
| **NuViraCredit** | Store credit records | **MERGE** |
| **BagReturn** | Reusable bag return tracking | **KEEP_CORE** |

### Queue / Audit / Monitoring Entities

| Entity | Role | Migration Classification |
|---|---|---|
| **OrderReviewQueue** | Quarantine queue for rejected/problematic orders | **KEEP_CORE** (simplify post-migration) |
| **OrderSyncLog** | Per-sync audit trail | **REMOVE_AFTER_MIGRATION** — only exists because of dual-app sync |
| **HubAlert** | Admin operational alert feed | **KEEP_CORE** |
| **IntegrationUsageLog** | Credit consumption tracking | **REMOVE_AFTER_MIGRATION** — monitoring artifact |
| **StripeEventLog** | Stripe webhook idempotency | **KEEP_CORE** |
| **RepairAuditLog** | History of manual repair executions | **REMOVE_AFTER_MIGRATION** — cleanup artifact |
| **DataQualityAlert** | Data quality flags | **MERGE** into HubAlert |

### Events / Business Development

| Entity | Role | Migration Classification |
|---|---|---|
| **Event** | Catering/pop-up event records | **KEEP_CORE** |
| **Lead** | Sales pipeline | **KEEP_CORE** |
| **Resource** | Equipment/asset tracking | **KEEP_CORE** |

### Delivery Zone / Approval Entities

| Entity | Role | Migration Classification |
|---|---|---|
| **DeliveryApprovalRequest** | Zone 3 manual delivery approval workflow | **KEEP_CORE** |
| **Zone3Waitlist** | Denied Zone 3 customers for future outreach | **KEEP_CORE** |

### Pending/Staging Entities

| Entity | Role | Migration Classification |
|---|---|---|
| **PendingSubscriptionCheckout** | Holds subscription intent before Stripe payment | **REWRITE** — staging table artifact; in unified platform, checkout is atomic |

---

## 2. ENTITY RELATIONSHIP DIAGRAM (Conceptual)

```
Stripe ──────────────────────────────────────────────────────────────┐
Customer App ────────────────────┐                                   │
                                 ▼                                   ▼
                        receiveCustomerAppEvent           stripeCheckoutWebhookHardened
                                 │                                   │
                                 └──────────► safeSyncOrderUpdate ◄──┘
                                                      │
                                             ShopifyOrder (canonical)
                                            /          |          \
                                           /           |           \
                             FulfillmentTask    ProductionBatch   OrderSyncLog
                                  │                   │
                              DriverPortal     recalculateProductionBatches
                                  │                   │
                             recordDriverDelivery  Recipe/Bundle/Ingredients
```

---

## 3. HUB-ONLY OPERATIONAL FLOWS (Survive Migration As-Is)

### A. Production Scheduling Flow
```
Order confirmed (paid)
  → recalculateProductionBatches (daily 6AM + 12PM CT)
  → ProductionBatch records created/updated per product per production_date
  → Production page shows batches for staff
  → startBatchProduction → completeBatchProduction → verifyAndLogBatch
  → BatchComplianceLog + CCPMonitoringLog + SanitationVerificationLog created
```
**Classification: KEEP_CORE** — pure Hub logic, no Customer App dependency.

### B. Driver Delivery Flow
```
FulfillmentTask (Scheduled) 
  → Driver Portal loads tasks for assigned_driver
  → recordDriverDelivery (marks Completed + photo + drop location)
  → ShopifyOrder updated (fulfilled, delivered_at, delivery_photo_url)
  → Customer email sent
  → pushOrderStatusToCustomerApp syncs delivery status to Customer App
```
**Classification: KEEP_CORE** — driver portal is Hub-native.

### C. Compliance Logging Flow
```
Staff logs: TemperatureLog / SanitationLog / DailyChecklist / pHLog / CCPLog
  → checkDailyCompliance (daily automation) verifies coverage
  → ComplianceAlert created if missing
  → ComplianceCenter dashboard summarizes for admin
  → MonthlyBinderExport generates printable compliance record
```
**Classification: KEEP_CORE** — regulatory requirement, no Customer App sync.

### D. POS Flow
```
Shopify POS sale 
  → shopifyOrderWebhook OR syncRecentShopifyOrders 
  → ingestShopifyPOSOrder 
  → ShopifyOrder created (order_type=pos, fulfillment_status=fulfilled, no address required)
  → POSValidation page for admin review
  → auditPOSRefundedOrders flags refunded POS sales
```
**Classification: KEEP_CORE** — POS is Hub-native (Shopify integration).

### E. Zone 3 Delivery Approval Flow
```
Customer App submits delivery request for Zone 3 address
  → DeliveryApprovalRequest created
  → HubAlert generated
  → Admin reviews: approveZone3DeliveryRequest OR denyZone3DeliveryRequest
  → Approved: Stripe payment captured → ShopifyOrder created
  → Denied: Zone3Waitlist entry created, customer notified
```
**Classification: KEEP_CORE** — business workflow, survives migration.

### F. Inventory & Purchase Order Flow
```
InventoryItem stock levels tracked manually / via PurchaseOrder
  → inventoryAlertEmail (scheduled) notifies when low
  → Supplier records link to PurchaseOrder
  → calculateIngredientNeeds derives demand from production plan
```
**Classification: KEEP_CORE**

---

## 4. SYNC DEPENDENCIES WITH CUSTOMER APP (REMOVE_AFTER_MIGRATION)

### Inbound Sync (Customer App → Hub)

| Function | What it does | Migration Fate |
|---|---|---|
| `receiveCustomerAppEvent` | Master inbound webhook: orders, subscriptions, refunds, bag returns | **REMOVE_AFTER_MIGRATION** — in unified app, events are direct DB writes |
| `customerAppEventPublicGateway` | Public-facing auth proxy for `receiveCustomerAppEvent` | **REMOVE_AFTER_MIGRATION** |
| `pullOrdersFromCustomerApp` | Safety-net: pulls all orders every 4 hours | **REMOVE_AFTER_MIGRATION** |
| `ingestCustomerAppOrder` | Legacy ingest path (deprecated) | **REMOVE_AFTER_MIGRATION** |
| `receiveOrderFromCustomerApp` | Another legacy ingest path | **REMOVE_AFTER_MIGRATION** |
| `pullBagReturnsFromCustomerApp` | Pulls bag return records | **REMOVE_AFTER_MIGRATION** |
| `pullEventsFromCustomerApp` | Pulls event data | **REMOVE_AFTER_MIGRATION** |
| `pullLoyaltyFromCustomerApp` | Pulls loyalty state | **REMOVE_AFTER_MIGRATION** |
| `fullSyncFromCustomerApp` | Manual full resync | **REMOVE_AFTER_MIGRATION** |
| `simulateCustomerAppSync` | Test/debug sync simulation | **REMOVE_AFTER_MIGRATION** |

### Outbound Sync (Hub → Customer App)

| Function | What it does | Migration Fate |
|---|---|---|
| `pushOrderStatusToCustomerApp` | Pushes fulfillment status updates | **REMOVE_AFTER_MIGRATION** |
| `getOrderUpdatesForCustomerApp` | Customer App polls Hub for order status | **REMOVE_AFTER_MIGRATION** |
| `syncBagReturnToCustomerApp` | Syncs bag return verification | **REMOVE_AFTER_MIGRATION** |
| `pushEventToCustomerApp` | Pushes event data | **REMOVE_AFTER_MIGRATION** |
| `pushLoyaltyMemberUpdate` | Pushes loyalty point changes | **REMOVE_AFTER_MIGRATION** |
| `loyaltySync` / `syncLoyaltyToHub` | Bidirectional loyalty sync | **REMOVE_AFTER_MIGRATION** |
| `syncLoyaltyRewards` | Rewards catalog sync | **REMOVE_AFTER_MIGRATION** |
| `orderStatusEmail` | Triggers CA to send order status email | **REMOVE_AFTER_MIGRATION** |
| `pullOrderStatusUpdates` | Pulls status updates (reverse sync) | **REMOVE_AFTER_MIGRATION** |
| `pullProductsFromCustomerApp` | Pulls product catalog | **REMOVE_AFTER_MIGRATION** |
| `syncProducts` | Product catalog sync | **REMOVE_AFTER_MIGRATION** |
| `syncProductIngredients` | Ingredient data sync | **REMOVE_AFTER_MIGRATION** |
| `syncEvents` / `receiveEventSync` | Event data sync | **REMOVE_AFTER_MIGRATION** |

### Reconciliation / Recovery (REMOVE_AFTER_MIGRATION)

These exist **only** because the two-app architecture creates gaps, drift, and missed events:

```
stripeSessionReconciliation — catches orders CA webhook missed
syncRecentShopifyOrders — catches Shopify POS orders Hub missed
reconcileAllOperationalRecords — detects Hub vs CA drift
reconcileRealtimeOperationalState — real-time drift detection
reconcileStripeOrders — Stripe vs Hub drift
reconcileAndRepairStripeOrders — combined reconcile+repair
repairMissingAddresses — CA address never synced to Hub
backfillAddressesFromStripeMetadata — recover addresses from Stripe
unifiedOrderRepairWorker — catch-all repair scanner
comprehensiveDataRepair — nuclear repair option
... (all ~30 repair/recovery functions)
```

**All of the above: REMOVE_AFTER_MIGRATION** — in a unified platform, there is no sync gap to reconcile.

---

## 5. FUNCTIONS CLASSIFIED BY MIGRATION FATE

### KEEP_CORE (Essential operational logic)
```
safeSyncOrderUpdate          — core write gateway (rewrite as unified DB layer)
recordDriverDelivery         — driver delivery confirmation
startBatchProduction         — production workflow
completeBatchProduction      — production workflow
verifyAndLogBatch            — compliance logging
createFulfillmentTasks       — task generation from orders
recalculateProductionBatches — production scheduling engine
processStripeRefund          — refund cascade (keep, simplify)
stripeCheckoutWebhookHardened— Stripe inbound (keep until Stripe removed)
awardOrderPoints             — loyalty earn logic
redeemReward                 — loyalty redeem logic
approveZone3DeliveryRequest  — Zone 3 approval workflow
denyZone3DeliveryRequest     — Zone 3 denial workflow
decomposeSubscriptionPlan    — subscription → per-delivery product decomposition
generateSubscriptionFulfillments — subscription fulfillment scheduling
optimizeDeliveryRoute        — route optimization
getDriverRouteForDate        — driver route data
checkDailyCompliance         — compliance monitoring
validateComplianceEntry      — compliance form validation
inventoryAlertEmail          — inventory monitoring
calculateIngredientNeeds     — production demand planning
inviteUser                   — user management
createNotification           — notification system
sendOrderReceivedNotification— customer order confirmation
generateWeeklyReport         — operational reporting
verifyPOSEventReadiness      — POS/event pre-check
capturePreOrderPayments      — Zone 3 payment capture
```

### REWRITE (Overly coupled, fragile, or needs architectural simplification)
```
receiveCustomerAppEvent      — massive multi-case router; replace with direct event handlers
safeSyncOrderUpdate          — keep logic, rewrite as unified DB transaction layer (remove source-based field ownership)
decomposeSubscriptionPlan    — functional but brittle plan-name matching; rewrite as DB-driven plan config
recalculateProductionBatches — works but runs expensive full-scan; rewrite as incremental demand tracking
pullOrdersFromCustomerApp    — 500-record full scan every 4h; unnecessary in unified architecture
handleSubscriptionFutureCancel — clean up Stripe dependency coupling
```

### REMOVE_AFTER_MIGRATION (Pure sync/reconciliation artifacts)
```
All ~30 repair/recovery/reconcile functions
All ~15 sync push/pull functions
All ~10 audit functions that exist only to detect drift
stripeSessionReconciliation
syncRecentShopifyOrders (if Shopify POS removed)
pullOrdersFromCustomerApp
receiveCustomerAppEvent
customerAppEventPublicGateway
OrderSyncLog write calls everywhere
```

---

## 6. AUTOMATIONS THAT BECOME UNNECESSARY AFTER MIGRATION

| Automation | Why it exists | Migration Fate |
|---|---|---|
| Customer App Order Pull — Every 4 Hours | Safety net for missed webhook events | **REMOVE** |
| Stripe Session Reconciliation — Every 6 Hours | Catches orders CA never synced | **REMOVE** (keep minimal Stripe reconcile) |
| System Health Check — Every 30 Min (currently disabled) | Detects drift between apps | **REMOVE** |
| Shopify POS Sync — Hourly | Polls Shopify for POS orders | **KEEP** (if Shopify POS retained) or **REMOVE** |
| Recalculate Production Batches — Daily 6AM + 12PM | Production scheduling | **KEEP** (simplify frequency) |
| Award Points on Paid Order (entity trigger) | Loyalty earn on payment | **KEEP** (simplify) |

---

## 7. DANGEROUS RECURSIVE CHAINS & COUPLED SYSTEMS

### Chain 1: Order → Batch → Rebuild Loop (RESOLVED, but watch)
```
ShopifyOrder update 
  → entity trigger on ShopifyOrder (if re-enabled) 
  → recalculateProductionBatches 
  → ProductionBatch updates 
  → entity trigger on ProductionBatch (if re-enabled)
  → recalculateProductionBatches again ← INFINITE LOOP RISK
```
**Status:** Entity triggers on ShopifyOrder and ProductionBatch were disabled to stop credit burn.  
**Migration fix:** Replace with event-sourced demand updates (update batch demand when order is created/changed, not via full recalc scan).

### Chain 2: Order → Queue → Alert → Email (Active, controlled)
```
safeSyncOrderUpdate quarantines bad order
  → OrderReviewQueue.create (new incident)
  → orderReviewQueueAlert automation fires
  → Email sent to all admins
```
**Status:** Controlled. Idempotency key prevents duplicate queue entries.  
**Migration fix:** Replace queue alert with in-app notification system; remove email blast.

### Chain 3: Subscription Cancel → Refund Cascade (Active, intentional)
```
customer.subscription_cancelled
  → receiveCustomerAppEvent
  → processStripeRefund
  → ShopifyOrder status=refunded
  → FulfillmentTask cancelled
  → ProductionBatch demand removed
  → LoyaltyMember points reversed
  → Customer email sent
  → CA notified via pushOrderStatusToCustomerApp
```
**Status:** Intentional cascade, protected by idempotency.  
**Migration fix:** Keep cascade logic, remove CA notification step (same app).

### Chain 4: Order Pull → SafeSync → BatchDemand (Active, scheduled)
```
pullOrdersFromCustomerApp (every 4h)
  → safeSyncOrderUpdate (per order)
  → triggerBatchDemandForDates (per new order)
  → ProductionBatch upsert
```
**Status:** Write-diff guard prevents unnecessary writes. Batch demand only triggered on new orders.  
**Migration fix:** Entire chain disappears in unified architecture.

### Chain 5: Stripe Webhook → SafeSync → FulfillmentTask → BatchDemand (Active, real-time)
```
stripeCheckoutWebhookHardened
  → safeSyncOrderUpdate
  → receiveCustomerAppEvent order.created path
  → FulfillmentTask created
  → triggerBatchDemandForDates
```
**Status:** Primary real-time ingest path. Healthy.  
**Migration fix:** KEEP but simplify — remove double routing through receiveCustomerAppEvent.

---

## 8. HUB PAGES → ROLE-BASED SECTIONS IN UNIFIED PLATFORM

### Public / All Authenticated Users
| Current Page | Unified Platform Section | Role Gate |
|---|---|---|
| `/driver-portal` | Driver Portal | `role: driver` |

### Operations Staff
| Current Page | Unified Platform Section | Role Gate |
|---|---|---|
| `/orders` | Order Management | `role: operations, admin` |
| `/fulfillment` | Fulfillment Board | `role: operations, admin` |
| `/production` | Production Batches | `role: production, operations, admin` |
| `/production-planning` | Production Planning | `role: production, operations, admin` |
| `/prod-scheduler` | Production Scheduler | `role: production, operations, admin` |
| `/calendar` | Operations Calendar | `role: operations, admin` |
| `/compliance` | Compliance Logs | `role: production, operations, admin` |
| `/compliance-center` | Compliance Center | `role: production, operations, admin` |
| `/inventory` | Inventory | `role: operations, admin` |
| `/purchase-orders` | Purchase Orders | `role: operations, admin` |
| `/events` | Events | `role: operations, admin` |
| `/partnerships` | Partnerships | `role: sales, admin` |

### Admin Only
| Current Page | Unified Platform Section | Role Gate |
|---|---|---|
| `/dashboard` | Operations Dashboard | `role: admin` |
| `/reporting` | Reporting | `role: admin` |
| `/loyalty-admin` | Loyalty Dashboard | `role: admin` |
| `/operations-manager` | Operations Manager | `role: admin` |
| `/alerts` | Alert Feed | `role: admin` |
| `/order-review-queue` | Order Review Queue | `role: admin` |
| `/audit-logs` | Audit Logs | `role: admin` |
| `/users` | User Management | `role: admin` |
| `/settings` | Settings | `role: admin` |
| `/stripe-repair` | Stripe Recovery | `role: admin` |
| `/delivery-route-reviews` | Zone 3 Route Reviews | `role: admin` |
| `/pos-validation` | POS Validation | `role: admin` |
| `/report-scheduler` | Report Scheduler | `role: admin` |
| `/suppliers` | Suppliers | `role: admin` |
| `/resources` | Resources | `role: admin` |
| `/shopify-audit` | Shopify Audit | `role: admin` (deprecate post-migration) |
| `/live-monitor` | Live Order Monitor | `role: admin` |
| `/refund-reconciliation` | Refund Reconciliation | `role: admin` |
| `/pos-event-readiness` | POS/Event Readiness | `role: admin` |

### Deprecate After Migration
```
/shopify-token-setup   — Shopify OAuth setup (gone when Shopify removed)
/shopify-audit         — Shopify connection health (gone when Shopify removed)
/stripe-repair         — Manual Stripe recovery (gone when unified app handles payments)
```

---

## 9. CANONICAL SOURCE OF TRUTH — UNIFIED PLATFORM

In the unified NuVira Platform, the following entities become the **single canonical truth**:

| Domain | Canonical Entity | Notes |
|---|---|---|
| Orders | **ShopifyOrder** (rename: `Order`) | No more dual-app sync; direct DB writes only |
| Deliveries | **FulfillmentTask** | Unchanged |
| Production | **ProductionBatch** | Unchanged |
| Customers | **User** (built-in) + profile extensions | Merge Customer App user records |
| Loyalty | **LoyaltyMember** + **UserPoints** | Merge CA loyalty state into Hub |
| Subscriptions | **ShopifyOrder** (type=subscription) + **Bundle** | Remove PendingSubscriptionCheckout staging table |
| Inventory | **InventoryItem** + **Supplier** + **PurchaseOrder** | Unchanged |
| Compliance | All compliance entities | Unchanged |
| Payments | Stripe (external) | Stripe remains the payment processor |

---

## 10. MIGRATION PRIORITY ORDER

### Phase 1 — Unify Data Layer
1. Merge Customer App user/order/loyalty data into Hub entities
2. Remove `shopify_order_id`/`shopify_order_number` dependency (rename `Order`)
3. Establish unified `User` entity with customer-facing profile fields
4. Retire `PendingSubscriptionCheckout` — subscription checkout becomes atomic

### Phase 2 — Kill Sync Infrastructure
1. Disable all pull/push sync automations
2. Remove `receiveCustomerAppEvent` — Customer App writes directly to entities
3. Remove `pullOrdersFromCustomerApp` — no longer needed
4. Remove all reconciliation/repair functions (20+ functions)
5. Remove `OrderSyncLog` writes from `safeSyncOrderUpdate`

### Phase 3 — Simplify Write Gateway
1. Rewrite `safeSyncOrderUpdate` → unified `writeOrder(data, actor)` with actor-based permissions
2. Remove `source`-based field ownership (no more `stripe_webhook` vs `customer_app` sources)
3. Simplify lock system — keep production locks, remove sync-coordination locks

### Phase 4 — Unify UI
1. Add role-based routing (driver sees only driver portal, staff sees ops, admin sees all)
2. Merge Customer App order tracking UI into Hub as a customer-facing role
3. Deprecate Shopify-specific pages if Shopify POS is retired

### Phase 5 — Clean Up
1. Archive `RepairAuditLog`, `IntegrationUsageLog`, `DataQualityAlert` (monitoring artifacts)
2. Retire `StripeEventLog` if Stripe webhooks are consolidated
3. Archive all diagnostic/test/audit functions (60+ functions currently in the codebase)

---

## 11. ESTIMATED FUNCTION REDUCTION AFTER MIGRATION

| Category | Current Count | After Migration |
|---|---|---|
| Sync / pull / push | ~25 | 0 |
| Reconcile / repair / recovery | ~35 | 0 |
| Audit / diagnostic / test | ~30 | ~5 (keep core health checks) |
| Core operational | ~40 | ~40 (keep all) |
| **Total** | **~130** | **~45** |

**~66% of current backend functions exist solely because of the dual-app architecture.**

---

*End of architecture map. No production code was modified in the creation of this document.*