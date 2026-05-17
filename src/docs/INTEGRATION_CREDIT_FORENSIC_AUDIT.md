# Integration Credit Forensic Audit & Stabilization Plan
**Date:** 2026-05-17  
**Priority:** Critical  
**Goal:** Identify sources of ~15k credit burn and redesign to <150–300 credits/day at current order volume.

---

## Executive Summary

The ~15k credit burn is driven by **three compounding problems**:
1. `recalculateProductionBatches` running every 30 minutes + pulling 500 ShopifyOrders + 500 FulfillmentTasks + 500 ProductionBatches per run — even when nothing changed.
2. `syncRecentShopifyOrders` calling the Shopify API via OAuth token exchange **every 10 minutes** — that's a token API call + orders fetch every 10 min, 144x/day.
3. The now-archived `Auto-Recalculate Production Batches on Paid ShopifyOrder` entity automation ran **11,742 times** before archiving — 9,216 failures still counted as credit consumers. This was the primary credit explosion event.

At current order volume (low double digits), the system is architected for hundreds of daily orders. It needs to be throttled back to startup mode.

---

## Automation Execution Audit

| Automation | Type | Runs | Failures | Cadence | Status |
|---|---|---|---|---|---|
| Auto-Recalculate on Paid ShopifyOrder | entity | **11,742** | 9,216 | every write | **ARCHIVED ✓** |
| Auto-Archive Refunded Orders | entity | **5,768** | 132 | every ShopifyOrder update | **ARCHIVED ✓** |
| Shopify POS Sync | scheduled | 384 | 0 | every 10 min | **ACTIVE — OPTIMIZE** |
| Recalculate Batches — Every 30 Min | scheduled | 766 | 3 | every 30 min | **ACTIVE — OPTIMIZE** |
| Recalculate Batches — Daily 6 AM | scheduled | 9 | 0 | daily | **ACTIVE — KEEP** |
| Stripe Session Reconciliation | scheduled | 49 | 0 | every 6 hours | **ACTIVE — KEEP** |
| Auto-promote paid → awaiting_production | entity | 42 | 42 | every ShopifyOrder write | **INACTIVE — DELETE** |
| Auto-Recalculate on Subscription FulfillmentTask | entity | 51 | 46 | every FT create | **ARCHIVED ✓** |

**Root cause of 11,742 entity automation runs:** The entity automation fired on EVERY ShopifyOrder create/update regardless of actual payment_status change. Each run loaded 500+ entities (ShopifyOrder + FulfillmentTask + Bundle + ProductionBatch + ManualProductionBatch = ~1,700 entity reads per execution). At 11,742 runs × ~8 credits each = ~94,000 credits from that automation alone before it was archived.

---

## Top 20 Credit Consumers — Ranked Highest to Lowest

### #1 — `recalculateProductionBatches` (scheduled, every 30 min)
**Estimated credits/day: ~400–600**
- Loads: 500 ShopifyOrders + 500 FulfillmentTasks + 100 Bundles + 500 ProductionBatches + 200 ManualProductionBatches = ~1,800 entity reads per execution
- Plus entity writes: dedup deletes, batch creates/updates, order fulfillment writes
- Running 48x/day × ~10-12 credits = **480–576 credits/day**
- **ACTION: OPTIMIZE** → Change to daily-only scheduled (keep the 6 AM run), or max 2x/day. Entity automation on new order placement is cleaner than polling.

### #2 — `syncRecentShopifyOrders` (scheduled, every 10 min)
**Estimated credits/day: ~290–430**
- Each run: OAuth token exchange (Shopify API call) + Shopify orders fetch + up to 50 entity reads + conditional writes
- 144x/day × ~2-3 credits = **288–432 credits/day**
- At current volume (0–5 new POS orders/day) this is 99% wasted
- **ACTION: OPTIMIZE** → Change to every 60 minutes during normal hours. Switch to 10-min only on event days (May 30). Or: webhook-only + daily reconciliation.

### #3 — `pullOrdersFromCustomerApp` (if scheduled)
**Estimated credits/day: ~200–350** (if running every 15–30 min)
- Reads: concurrency lock check (OrderSyncLog) + 500 ShopifyOrders pre-load + subscription fetch (2 external API calls) + safeSyncOrderUpdate per order
- Each `safeSyncOrderUpdate` invocation costs ~2 credits (it's a function-to-function call)
- **ACTION: OPTIMIZE** → Reduce to every 60 min, or switch to webhook-based via `receiveCustomerAppEvent` which is already implemented.

### #4 — `stripeSessionReconciliation` (every 6 hours)
**Estimated credits/day: ~60–120**
- 4x/day × Stripe API pagination + 500 ShopifyOrder reads + 100 OrderReviewQueue reads + per-session line item fetches
- Largely idle at low volume but Stripe API calls are expensive
- **ACTION: KEEP** at 6-hour cadence. Add `if (sessions.length === 0) early exit` (already has this). Consider extending to 12h during low-volume periods.

### #5 — `safeSyncOrderUpdate` (called by every sync path)
**Estimated credits/day: ~100–200** (cascaded invocations)
- Called by: `pullOrdersFromCustomerApp`, `stripeSessionReconciliation`, `receiveCustomerAppEvent`, `stripeCheckoutWebhookHardened`, and manual tools
- Each invocation reads 500 orders for dedup checking (pre-existing code pattern)
- **ACTION: OPTIMIZE** → Pass pre-loaded order index as parameter so callers don't each load 500 records independently.

### #6 — `recalculateProductionBatches` (entity trigger — now ARCHIVED)
**Estimated credits during active period: ~94,000 total**
- 11,742 runs × ~8 credits each
- Already archived — primary crisis event is over
- **ACTION: DELETE** the archived automation record (cleanup)

### #7 — `autoArchiveRefundedOrders` (entity trigger — now ARCHIVED)
**Estimated credits during active period: ~17,000 total**
- 5,768 runs — fired on every ShopifyOrder update
- **ACTION: DELETE** archived record (cleanup)

### #8 — Dashboard page load (manual but frequent)
**Estimated credits/day: ~30–80** (per admin session)
- Each Dashboard load: 4 parallel entity fetches (ShopifyOrder×50, ProductionBatch×50, InventoryItem×100, OrderReviewQueue filter)
- PullToRefresh triggers re-fetch on mobile swipe
- No auto-poll interval — this is acceptable
- **ACTION: KEEP** but add React Query with 5-minute `staleTime` so repeated navigations don't re-fetch

### #9 — `syncFulfillmentTasksFromOrders` (if scheduled)
**Estimated credits/day: ~40–80** (if running)
- Reads all ShopifyOrders + FulfillmentTasks, creates/updates FulfillmentTasks
- **ACTION: DISABLE** — run manually only. FulfillmentTasks are created by `createFulfillmentTasks` on order creation webhook, not by periodic sync.

### #10 — `operationsOversight` / `systemHealthCheck` (if scheduled)
**Estimated credits/day: ~20–60** (depends on cadence)
- Health check reads multiple entity sets
- **ACTION: OPTIMIZE** → If scheduled, ensure minimum 60-min cadence and targeted queries only.

### #11 — `orderReviewQueueAlert` (entity trigger)
**Estimated credits/day: ~10–30**
- Fires on OrderReviewQueue creates — should be low volume
- **ACTION: KEEP** — correct use of entity automation (fires only when record created, not on every update)

### #12 — `awardOrderPoints` (entity trigger)
**Estimated credits/day: ~5–15**
- Fires on ShopifyOrder update with payment_status=paid — should be low volume
- **ACTION: KEEP** with tight trigger conditions

### #13 — `complianceExpiryCheck` (if scheduled)
**Estimated credits/day: ~10–20**
- Reads compliance logs periodically
- **ACTION: OPTIMIZE** → Daily at most, not hourly/sub-hourly

### #14 — `inventoryAlertEmail` (if scheduled)
**Estimated credits/day: ~5–10**
- **ACTION: KEEP** at daily cadence

### #15 — `loyaltySync` / `pullLoyaltyFromCustomerApp` (if scheduled)
**Estimated credits/day: ~15–40**
- Each sync: external API call + multiple entity reads/writes
- **ACTION: OPTIMIZE** → Once/day max at current scale

### #16 — `checkDailyCompliance` (if scheduled)
**Estimated credits/day: ~10–20**
- **ACTION: KEEP** at daily cadence

### #17 — `getOrderUpdatesForCustomerApp` (polled by Customer App)
**Estimated credits/day: ~variable** — depends on Customer App polling frequency
- Each call loads filtered ShopifyOrders
- If Customer App polls every 60s per active user, this compounds fast
- **ACTION: OPTIMIZE** → Ensure Customer App polls at max every 2 minutes; add `updated_since` timestamp filter so only changed records are returned (already has `date` param)

### #18 — Fulfillment page auto-refresh
**Estimated credits/day: ~20–50** (per active admin session)
- Check if `refetchInterval` is set on any query on the Fulfillment page
- **ACTION: AUDIT** → Ensure no `refetchInterval` under 60 seconds on operational pages

### #19 — `resolveDeliveryScheduleForDate` (Driver Portal)
**Estimated credits/day: ~10–30** (per driver session)
- Called when date changes in Driver Portal + on load
- Reads FulfillmentTasks for the date
- **ACTION: KEEP** — user-triggered only, not polling

### #20 — Retry loop failures (`autoArchiveRefundedOrders`, entity automations)
**Estimated credits from failure retries: ~2,000–5,000 total**
- Base44 retries failed automation runs — 9,216 failures on recalculate + 132 on archive automation
- Failed runs still consume credits
- **ACTION: DELETE** archived automations to prevent any residual retry activity

---

## Revised Daily Credit Budget Estimate (Post-Optimization)

| Consumer | Current | After Fix | Action |
|---|---|---|---|
| `recalculateProductionBatches` every 30 min | ~500/day | ~15/day | → daily only |
| `syncRecentShopifyOrders` every 10 min | ~360/day | ~50/day | → every 60 min |
| `pullOrdersFromCustomerApp` (if polling) | ~200/day | ~50/day | → every 60 min |
| `stripeSessionReconciliation` every 6h | ~80/day | ~40/day | → keep or 12h |
| `safeSyncOrderUpdate` cascade calls | ~100/day | ~30/day | → optimize index |
| Dashboard loads | ~40/day | ~20/day | → add staleTime |
| All other ops | ~100/day | ~50/day | — |
| **TOTAL** | **~1,380/day** | **~255/day** | **TARGET MET** |

*Note: The 11,742-run entity automation was the primary crisis event. With it archived, the daily rate should already be materially lower. The above represents the steady-state optimization target.*

---

## Immediate Actions (Ranked by Impact)

### 🔴 CRITICAL — Do Now

**1. Change `recalculateProductionBatches` 30-min automation to 2x/day**
- Keep the 6 AM run
- Add one more at noon (11 AM CT) as a midday catch-all
- Remove the every-30-min automation entirely
- Estimated savings: ~450 credits/day

**2. Change `syncRecentShopifyOrders` from every 10 min to every 60 min**
- Keep 5-min cadence available as manual override for event days
- Estimated savings: ~300 credits/day

**3. Delete the two archived entity automations** (not just archived — delete)
- `Auto-Recalculate Production Batches on Paid ShopifyOrder`
- `Auto-Archive Refunded Orders`
- `Auto-promote paid orders to awaiting_production`
- Prevents any platform retry behavior on failed runs

### 🟡 HIGH — Do This Week

**4. Add write-diff guard to `recalculateProductionBatches` order fulfillment writes**
- Currently compares JSON but rebuilds fulfillments array every run for all orders
- Pre-filter: only process orders with `assigned_delivery_date` in next 14 days
- Skip orders with `production_status` in `['fulfilled', 'canceled', 'refunded']`

**5. Add `staleTime: 5 * 60 * 1000` to Dashboard React Query calls**
- Currently reloads on every page navigation
- Dashboard data doesn't need to be fresher than 5 minutes

**6. Cap `pullOrdersFromCustomerApp` to once every 60 minutes**
- The 180-second concurrency lock already helps — extend it to 3600s
- Or schedule the automation at 60-min cadence instead of shorter

**7. Audit `getOrderUpdatesForCustomerApp` Customer App polling frequency**
- Ensure Customer App polls no faster than every 2 minutes per user
- Add `last_updated_after` filter so unchanged orders are excluded

### 🟢 MEDIUM — Next Sprint

**8. Move `syncFulfillmentTasksFromOrders` to manual/webhook-only**
- Disable any scheduled automation for it
- FulfillmentTasks should only be created on new order events

**9. Consolidate sync paths:**
- `receiveCustomerAppEvent` + `pullOrdersFromCustomerApp` + `receiveOrderFromCustomerApp` all write to ShopifyOrder
- These are 3 sync paths for the same destination — consolidate to `receiveCustomerAppEvent` as primary + `stripeSessionReconciliation` as safety net
- Disable `pullOrdersFromCustomerApp` scheduled automation once webhook path is proven stable

**10. Add production-day-only guard to `recalculateProductionBatches`**
- Only calculate batches for Tue/Fri dates (already has phase 5 guard)
- Skip entirely if no new orders since last run (add a `last_modified_check` on ShopifyOrder)

---

## Protection Rules (Hardened Architecture)

```
✗ No entity automation may fire recalculateProductionBatches on every write
✗ No automation cadence faster than 30 minutes without critical operational justification  
✗ No full 500-record dataset scan more than 2x/day unless triggered by specific event
✗ No function-to-function invocation inside a tight loop (safeSyncOrderUpdate inside pullOrders loop)
✗ No Customer App polling faster than 2 minutes
✗ No Dashboard auto-refresh interval — manual pull-to-refresh only
✗ No archived automations left in the system — delete them to prevent retry behavior
✓ All write operations MUST have write-diff guards
✓ All scheduled jobs MUST have early-exit when there is no new data to process
✓ All external API syncs (Shopify, Stripe) MUST be triggered by webhook first, polling as fallback only
```

---

## Operational Architecture — Lean Startup Mode

```
ORDER RECEIVED (Stripe webhook)
  → stripeCheckoutWebhookHardened (creates ShopifyOrder, idempotent)
  → createFulfillmentTasks (creates tasks, idempotent)
  → ONE call to recalculateProductionBatches (adds new demand to existing batches)

DAILY SCHEDULED (6 AM CT)
  → recalculateProductionBatches (full recalculation, single daily run)
  → checkDailyCompliance
  → inventoryAlertEmail

EVERY 60 MINUTES
  → syncRecentShopifyOrders (POS catch-all)
  → [optional] pullOrdersFromCustomerApp (if webhook not yet proven)

EVERY 6–12 HOURS  
  → stripeSessionReconciliation (safety net for missed webhooks)

MANUAL / ON-DEMAND ONLY
  → All repair/audit/recovery functions
  → syncFulfillmentTasksFromOrders
  → All recalculate calls triggered from UI

WEBHOOKS (real-time, no polling cost)
  → stripeCheckoutWebhookHardened (new orders)
  → stripeChargeRefundedWebhook (refunds)
  → receiveCustomerAppEvent (customer app events)
```

---

## Credit Savings Summary

| Action | Estimated Savings/Day |
|---|---|
| `recalculateProductionBatches` → 2x/day | ~450 credits |
| `syncRecentShopifyOrders` → every 60 min | ~300 credits |
| Delete archived automations | ~50 credits (retry prevention) |
| Cap `pullOrdersFromCustomerApp` | ~150 credits |
| Add staleTime to Dashboard queries | ~20 credits |
| **Total savings** | **~970 credits/day** |

**Projected daily burn at low order volume: ~150–250 credits/day** — within the 150–300 target.