# Batch 1 Conservative Execution — 4 Sub-Batches
**Approach:** Delete 5-7 functions at a time, validate after each group  
**Total Functions:** 22 (grouped into 4 sub-batches)  
**Safety Level:** CONSERVATIVE — validation gates between each sub-batch  
**Timeline:** ~2-3 hours total (30-60 min between groups)

---

## GROUPING STRATEGY

### Sub-Batch 1A: Test-Only Functions (5 functions)
**Purpose:** Remove test fixtures and debug utilities (ZERO operational role)  
**Risk Level:** VERY LOW (no production impact)

```
1. createTestSubscriptionsWithMetadata
2. createTestVIPWellnessSubscription
3. markAmarKahlonOrdersRefunded
4. debugStripeSession
5. debugSukhwantOrder
```

**Why Safe:** These are explicitly test/debug functions, never used in production workflows.

---

### Sub-Batch 1B: Customer-Specific One-Time Repairs (6 functions)
**Purpose:** Remove one-time fixes for individual customer orders (Sukhwant, Danyelle, Deepa, Henrry)  
**Risk Level:** LOW (no ongoing production dependency)

```
1. repairSukhwantKahlonOrder
2. repairDanyelleOrders
3. repairDeepaNV367R7PaymentStatus
4. rescheduleHenrryRoblesOrder
5. createSukhwantOrderFromStripe
6. restoreSukhwantPrice
```

**Why Safe:** Customer-specific repairs, already executed and archived. No ongoing workflow needs them.

---

### Sub-Batch 1C: Customer Data Cleanup (5 functions)
**Purpose:** Remove search/cleanup utilities for test customer data (Amar Kahlon, Sukhwant test records)  
**Risk Level:** LOW (no operational workflow dependency)

```
1. findAmarOrders
2. cleanupAmarKahlonOrders
3. cleanupSukhwantDuplicates
4. restoreSukhwantOrder
5. repairCustomerAddressMapping
```

**Why Safe:** Legacy customer-specific utilities, no production sync or order creation path uses them.

---

### Sub-Batch 1D: One-Time Database Migrations (6 functions)
**Purpose:** Remove date-specific batch cleanup and order migration utilities  
**Risk Level:** LOW (one-time migrations, already completed)

```
1. repairFulfillmentTaskAssignedDeliveryDates
2. deleteApril23Batches
3. deleteMay2Batches
4. deleteUnknownAndRecalc
5. repairBrokenCustomerAppOrders
6. repairAssignedProductionDate
```

**Why Safe:** All are date-specific or migration utilities, no ongoing scheduled workflows depend on them.

---

## EXECUTION TIMELINE

```
Time: 08:00 AM (Chicago)
┌─────────────────────────────────────────────────────────────┐
│ SUB-BATCH 1A: Test Functions (5 deletions)                  │
│ ✓ Delete 5 functions                                        │
│ ✓ Smoke test (5 min)                                        │
│ ✓ Validation checklist (5 min)                              │
└─────────────────────────────────────────────────────────────┘
       ↓ PASS (10 min)

       Wait 30 minutes (allow backend to stabilize)

Time: 08:40 AM
┌─────────────────────────────────────────────────────────────┐
│ SUB-BATCH 1B: Customer Repairs (6 deletions)                │
│ ✓ Delete 6 functions                                        │
│ ✓ Smoke test (5 min)                                        │
│ ✓ Validation checklist (5 min)                              │
└─────────────────────────────────────────────────────────────┘
       ↓ PASS (10 min)

       Wait 30 minutes

Time: 09:20 AM
┌─────────────────────────────────────────────────────────────┐
│ SUB-BATCH 1C: Data Cleanup (5 deletions)                    │
│ ✓ Delete 5 functions                                        │
│ ✓ Smoke test (5 min)                                        │
│ ✓ Validation checklist (5 min)                              │
└─────────────────────────────────────────────────────────────┘
       ↓ PASS (10 min)

       Wait 30 minutes

Time: 10:00 AM
┌─────────────────────────────────────────────────────────────┐
│ SUB-BATCH 1D: Migrations (6 deletions)                      │
│ ✓ Delete 6 functions                                        │
│ ✓ Smoke test (5 min)                                        │
│ ✓ Validation checklist (5 min)                              │
└─────────────────────────────────────────────────────────────┘
       ↓ PASS (10 min)

Time: 10:50 AM — BATCH 1 COMPLETE
All 22 functions deleted successfully ✓
Enter 24h monitoring window
```

---

## SUB-BATCH 1A: TEST FUNCTIONS ONLY
**Status:** READY FOR EXECUTION  
**Functions:** 5 (createTestSubscriptionsWithMetadata, createTestVIPWellnessSubscription, markAmarKahlonOrdersRefunded, debugStripeSession, debugSukhwantOrder)

### Pre-Deletion Checklist
```
[ ] Verified ZERO callers for all 5 functions
[ ] Verified ZERO automations reference these
[ ] Verified ZERO scheduled jobs run these
[ ] Verified ZERO webhook handlers call these
[ ] All 5 are backed up in CLEANUP_BATCH_FUNCTIONS_BACKUP.md
```

### Deletion Steps
```
rm -f functions/createTestSubscriptionsWithMetadata.js
rm -f functions/createTestVIPWellnessSubscription.js
rm -f functions/markAmarKahlonOrdersRefunded.js
rm -f functions/debugStripeSession.js
rm -f functions/debugSukhwantOrder.js
git commit -m "Batch 1A: Delete 5 test-only functions"
```

### Post-Deletion Validation (5 min)
```
[ ] Dashboard page loads (desktop)
[ ] Dashboard page loads (mobile)
[ ] Orders page loads with order list
[ ] Production Planning page loads
[ ] Fulfillment page loads
[ ] Console (F12): ZERO "function not found" errors
[ ] No new errors in logs
```

**Gate Decision:**
- ✅ ALL PASS → Proceed to 30-min wait, then Sub-Batch 1B
- ❌ ANY FAIL → STOP and investigate before continuing

---

## SUB-BATCH 1B: CUSTOMER-SPECIFIC REPAIRS
**Status:** PENDING (after 1A validation + 30 min wait)  
**Functions:** 6 (repairSukhwantKahlonOrder, repairDanyelleOrders, repairDeepaNV367R7PaymentStatus, rescheduleHenrryRoblesOrder, createSukhwantOrderFromStripe, restoreSukhwantPrice)

### Pre-Deletion Checklist
```
[ ] Verified ZERO callers for all 6 functions
[ ] Verified ZERO automations reference these
[ ] Verified ZERO scheduled jobs run these
[ ] Verified ZERO webhook handlers call these
[ ] Dashboard still stable after 1A deletion
[ ] No new errors in logs since 1A
```

### Deletion Steps
```
rm -f functions/repairSukhwantKahlonOrder.js
rm -f functions/repairDanyelleOrders.js
rm -f functions/repairDeepaNV367R7PaymentStatus.js
rm -f functions/rescheduleHenrryRoblesOrder.js
rm -f functions/createSukhwantOrderFromStripe.js
rm -f functions/restoreSukhwantPrice.js
git commit -m "Batch 1B: Delete 6 customer-specific one-time repairs"
```

### Post-Deletion Validation (5 min)
```
[ ] Dashboard page loads (desktop)
[ ] Orders page loads with full order list
[ ] Shopify syncRecentShopifyOrders runs (check logs)
[ ] POS orders visible in Orders page
[ ] Production Planning loads and calculates
[ ] Fulfillment page loads
[ ] Console (F12): ZERO "function not found" errors
[ ] No new errors in logs
```

**Gate Decision:**
- ✅ ALL PASS → Proceed to 30-min wait, then Sub-Batch 1C
- ❌ ANY FAIL → STOP and investigate before continuing

---

## SUB-BATCH 1C: DATA CLEANUP UTILITIES
**Status:** PENDING (after 1B validation + 30 min wait)  
**Functions:** 5 (findAmarOrders, cleanupAmarKahlonOrders, cleanupSukhwantDuplicates, restoreSukhwantOrder, repairCustomerAddressMapping)

### Pre-Deletion Checklist
```
[ ] Verified ZERO callers for all 5 functions
[ ] Verified ZERO automations reference these
[ ] Verified ZERO scheduled jobs run these
[ ] Verified ZERO webhook handlers call these
[ ] Dashboard still stable after 1B deletion
[ ] No new errors in logs since 1B
```

### Deletion Steps
```
rm -f functions/findAmarOrders.js
rm -f functions/cleanupAmarKahlonOrders.js
rm -f functions/cleanupSukhwantDuplicates.js
rm -f functions/restoreSukhwantOrder.js
rm -f functions/repairCustomerAddressMapping.js
git commit -m "Batch 1C: Delete 5 customer data cleanup utilities"
```

### Post-Deletion Validation (5 min)
```
[ ] Dashboard page loads (desktop)
[ ] Orders page loads with full order list
[ ] Can search/filter orders
[ ] Mobile Orders page loads
[ ] Fulfillment page loads and displays tasks
[ ] Production Planning loads
[ ] Create new one-time order (test): order appears in 1 min
[ ] Console (F12): ZERO "function not found" errors
[ ] No new errors in logs
```

**Gate Decision:**
- ✅ ALL PASS → Proceed to 30-min wait, then Sub-Batch 1D
- ❌ ANY FAIL → STOP and investigate before continuing

---

## SUB-BATCH 1D: DATABASE MIGRATION UTILITIES
**Status:** PENDING (after 1C validation + 30 min wait)  
**Functions:** 6 (repairFulfillmentTaskAssignedDeliveryDates, deleteApril23Batches, deleteMay2Batches, deleteUnknownAndRecalc, repairBrokenCustomerAppOrders, repairAssignedProductionDate)

### Pre-Deletion Checklist
```
[ ] Verified ZERO callers for all 6 functions
[ ] Verified ZERO automations reference these
[ ] Verified ZERO scheduled jobs run these
[ ] Verified ZERO webhook handlers call these
[ ] Dashboard still stable after 1C deletion
[ ] No new errors in logs since 1C
```

### Deletion Steps
```
rm -f functions/repairFulfillmentTaskAssignedDeliveryDates.js
rm -f functions/deleteApril23Batches.js
rm -f functions/deleteMay2Batches.js
rm -f functions/deleteUnknownAndRecalc.js
rm -f functions/repairBrokenCustomerAppOrders.js
rm -f functions/repairAssignedProductionDate.js
git commit -m "Batch 1D: Delete 6 one-time database migration utilities"
```

### Post-Deletion Validation (5 min)
```
[ ] Dashboard page loads (desktop & mobile)
[ ] Orders page loads and displays all orders
[ ] Fulfillment page loads and displays tasks
[ ] Production Planning page loads
[ ] Can create new order via Stripe test
[ ] Order syncs to Hub within 1 minute
[ ] FulfillmentTask automatically created
[ ] ProductionBatch automatically created
[ ] Console (F12): ZERO "function not found" errors
[ ] No new errors in logs
```

**Gate Decision:**
- ✅ ALL PASS → **BATCH 1 COMPLETE** ✓
- ❌ ANY FAIL → STOP and investigate

---

## EMERGENCY ROLLBACK (If Any Sub-Batch Fails)

### Quick Rollback Steps
```
1. Note which sub-batch failed
2. Restore deleted functions from CLEANUP_BATCH_FUNCTIONS_BACKUP.md
3. Create files in functions/ directory for failed functions
4. Restart backend (auto-redeploys in 2-5 minutes)
5. Re-run validation checklist
6. Verify system stable before attempting next sub-batch
7. Document reason for failure
```

### Decision Tree
```
Sub-Batch 1A fails?
  → Rollback only 1A (5 functions)
  → Investigate test function usage
  → Re-attempt 1A or skip to 1B if unrelated

Sub-Batch 1B fails?
  → Rollback only 1B (6 functions)
  → Check if any Sukhwant/Deepa order data is still live
  → Re-attempt 1B or consider keeping some repairs

Sub-Batch 1C fails?
  → Rollback only 1C (5 functions)
  → Check order search/filter workflows
  → Re-attempt 1C

Sub-Batch 1D fails?
  → Rollback only 1D (6 functions)
  → Check if any fulfillment tasks have missing data
  → Re-attempt 1D

CRITICAL FAILURE (Dashboard or Orders page broken)?
  → Rollback ALL 4 sub-batches immediately
  → Restore all 22 functions
  → Wait 24 hours before re-attempting
  → Root-cause analysis required
```

---

## TRACKING SPREADSHEET

| Sub-Batch | Functions | Status | Started | Completed | Validation | Decision | Notes |
|-----------|-----------|--------|---------|-----------|-----------|----------|-------|
| 1A | 5 Test | PENDING | --- | --- | --- | --- | --- |
| 1B | 6 Repairs | PENDING | --- | --- | --- | --- | --- |
| 1C | 5 Cleanup | PENDING | --- | --- | --- | --- | --- |
| 1D | 6 Migration | PENDING | --- | --- | --- | --- | --- |
| **TOTAL** | **22** | **PENDING** | --- | --- | --- | --- | --- |

---

## 24-HOUR MONITORING (After All 4 Sub-Batches Complete)

Once all 22 functions are deleted and all 4 sub-batches pass validation:

```
Hour 0: Post-deletion complete
Hour 6: Dashboard + Orders + Production Planning still working?
Hour 12: Can create new orders end-to-end? Subscriptions sync correctly?
Hour 24: Final validation (see REGRESSION_TEST_CHECKLIST.md)
```

If ANY issue appears during 24h window → Rollback entire Batch 1 and investigate.