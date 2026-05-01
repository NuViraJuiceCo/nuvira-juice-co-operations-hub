# Repair Function Lockdown Status

**Last Updated:** 2026-05-01  
**Status:** CRITICAL FUNCTIONS LOCKED | LEGACY FUNCTIONS ARCHIVED  

---

## Summary

All repair, cleanup, recovery, rebuild, and reconciliation functions are now locked behind admin authorization. These functions can only be executed by users with `role === 'admin'` and must log all changes via `logRepairExecution`.

---

## Locked Functions (Admin-Only, Safe to Use)

### Address & Fulfillment Repair
- ✅ `repairMissingAddresses` — Admin-gated, logs changes
- ✅ `createFulfillmentTasks` — Admin-gated, generates weekly task records
- ✅ `createMissingFulfillmentTasks` — Admin-gated

### Cleanup Functions (Requires Explicit Confirmation)
- ✅ `cleanupDuplicateOrders` — Admin-gated, requires `confirm_delete=true`
- ✅ `cleanupDuplicateFulfillmentTasks` — Admin-gated
- ✅ `cleanupUnknownOrders` — Admin-gated

### Data Consistency Functions (Use Before Production)
- ✅ `syncFulfillmentTasksFromOrders` — Admin-gated, syncs orders → tasks
- ✅ `recalculateProductionBatches` — Admin-gated, recalculates from orders

---

## Legacy Functions (ARCHIVED — Not in Active Flow)

These functions were emergency repairs for specific past issues. **DO NOT USE** without explicit admin approval and business reason.

### Sukhwant-Specific Repairs (Archived)
- 🚫 `repairSukhwantKahlonOrder` — Emergency fix for one customer, archived
- 🚫 `restoreSukhwantOrder` — Emergency recovery, archived
- 🚫 `recoverSukhwantOrder` — Emergency recovery, archived
- 🚫 `createSukhwantOrderFromStripe` — Manual reconstruction, archived
- 🚫 `rebuildSukhwantFromStripe` — Full rebuild, archived
- 🚫 `recoverSukhwantAddressFromSubscription` — Address recovery, archived
- 🚫 `restoreSukhwantPrice` — Price correction, archived

### Old Stripe Recovery (Archived — Replaced by safeSyncOrderUpdate)
- 🚫 `stripeOrderRecovery` — Old Stripe sync, archived
- 🚫 `autoRemediateStripeOrders` — Automatic repair, archived (too aggressive)
- 🚫 `detectStripeOrderSyncIssues` — Diagnostic, archived
- 🚫 `reconcileStripeOrders` — Old reconciliation, archived
- 🚫 `reconcileAndRepairStripeOrders` — Combined old logic, archived

### Old Duplicate/Corruption Cleanup (Archived — Replaced by safeSyncOrderUpdate)
- 🚫 `detectAndCanonicalizeDuplicateOrders` — Old dedup logic, archived
- 🚫 `cleanupOrphanedAndDuplicateRecords` — Aggressive cleanup, archived
- 🚫 `cleanupCorruptedOrders` — Assumes corruption, archived
- 🚫 `deleteUnknownAndRecalc` — Destructive, archived
- 🚫 `detectMissingStripeOrders` — Diagnostic only, archived

### Old Bulk Recovery (Archived — Replaced by safeSyncOrderUpdate)
- 🚫 `fullOrderRecovery` — Manual recovery, archived
- 🚫 `autoFixSubscriptionOrders` — Automatic repair, archived
- 🚫 `unifiedOrderRepairWorker` — Bulk worker, archived
- 🚫 `comprehensiveDataRepair` — Aggressive repair, archived

---

## Active Order Management Path

All order writes now go through **ONE GATEWAY**:

```
┌─────────────────────────────────────────────┐
│ Incoming Order (Stripe, Customer App, etc.) │
└────────────────┬────────────────────────────┘
                 │
                 ▼
        ┌────────────────────┐
        │ safeSyncOrderUpdate │ ← SINGLE GATEWAY
        │  (All validations)  │
        └────────┬───────────┘
                 │
                 ▼
        ┌────────────────────┐
        │ ShopifyOrder saved │
        │ (Updated/Created)  │
        └────────┬───────────┘
                 │
                 ├─→ recalculateProductionBatches
                 │   (triggered by automation)
                 │
                 ├─→ createFulfillmentTasks
                 │   (for subscriptions)
                 │
                 └─→ optimizeDeliveryRoute
                     (for Driver Portal)
```

---

## When to Use Repair Functions

### ✅ Safe to Use Anytime
1. `repairMissingAddresses` — Safely fills gaps from Stripe
2. `createFulfillmentTasks` — Safe, idempotent
3. `syncFulfillmentTasksFromOrders` — Safe refresh

### ⚠️ Use Before Production Changes
1. `recalculateProductionBatches` — Recalc all batches from orders
2. `backfillOrderTypeAndMode` — Backfill missing order_type/fulfillment_mode

### 🚫 Archived (Do Not Use)
- All Sukhwant-specific functions
- All old Stripe recovery functions
- All aggressive cleanup functions

---

## Audit Logging

All repair functions **MUST** call `logRepairExecution` to create an immutable record:

```javascript
await base44.functions.invoke('logRepairExecution', {
  repair_function: 'repairMissingAddresses',
  action: 'repair',
  records_affected: 5,
  changes: { repaired: [...], flagged: [...] },
  reason: 'Weekly maintenance run'
});
```

Logs are stored in `RepairAuditLog` entity for audit trail.

---

## Future Monitoring

Dashboard alerts will track:
- ✅ Repair functions executed (who, when, what)
- ✅ Quarantined orders (data quality issues)
- ✅ Fallback logic usage (address recovery)
- ✅ Zero-quantity batches
- ✅ Missing fulfillments
- ✅ Driver Portal visibility gaps

---

## Summary

**TODAY:** All repair functions are admin-gated and now logged.  
**NEXT:** Implement dashboard alerts for data quality (Warning 4).  
**FUTURE:** Archive old repair functions after 30-day monitoring period.