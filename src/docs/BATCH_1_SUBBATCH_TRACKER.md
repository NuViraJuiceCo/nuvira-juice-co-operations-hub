# Batch 1 Sub-Batch Execution Tracker
**Approach:** Conservative 4-group execution with validation gates  
**Total Functions:** 22 across 4 sub-batches  
**Timeline:** ~2-3 hours (30-60 min wait between each sub-batch)

---

## SUB-BATCH 1A: TEST FUNCTIONS (5 deletions)
**Execution Status:** PENDING  
**Started:** [Enter time]  
**Completed:** [Enter time]  

| # | Function | File | Callers | Backup | Deleted | Status |
|---|----------|------|---------|--------|---------|--------|
| 1 | createTestSubscriptionsWithMetadata | functions/createTestSubscriptionsWithMetadata.js | ✅ ZERO | ✅ YES | [ ] | PENDING |
| 2 | createTestVIPWellnessSubscription | functions/createTestVIPWellnessSubscription.js | ✅ ZERO | ✅ YES | [ ] | PENDING |
| 3 | markAmarKahlonOrdersRefunded | functions/markAmarKahlonOrdersRefunded.js | ✅ ZERO | ✅ YES | [ ] | PENDING |
| 4 | debugStripeSession | functions/debugStripeSession.js | ✅ ZERO | ✅ YES | [ ] | PENDING |
| 5 | debugSukhwantOrder | functions/debugSukhwantOrder.js | ✅ ZERO | ✅ YES | [ ] | PENDING |

### Pre-Deletion
```
[ ] All 5 functions verified in backup archive
[ ] All 5 confirmed ZERO callers
[ ] All 5 confirmed no automations/webhooks
[ ] Baseline metrics recorded (dashboard load time, etc.)
```

### Deletion Log
```
Time: __________ — Starting deletions
Time: __________ — createTestSubscriptionsWithMetadata deleted
Time: __________ — createTestVIPWellnessSubscription deleted
Time: __________ — markAmarKahlonOrdersRefunded deleted
Time: __________ — debugStripeSession deleted
Time: __________ — debugSukhwantOrder deleted
Time: __________ — All 5 deleted
```

### Smoke Test (5 min)
```
[ ] Dashboard loads (desktop): ✓ / ✗ — Time: _______ sec
[ ] Orders page loads: ✓ / ✗ — Time: _______ sec
[ ] Production Planning loads: ✓ / ✗ — Time: _______ sec
[ ] Fulfillment page loads: ✓ / ✗ — Time: _______ sec
[ ] Console errors (F12): 0 / [COUNT]
[ ] Logs checked: ✓ CLEAN / ✗ ERRORS
```

### Validation Result
```
PASS / FAIL

If FAIL → Function that failed: ________________
         Error message: ________________
         Action taken: ________________

If PASS → Proceed to 30-min wait, then Sub-Batch 1B
```

### 30-Minute Wait
```
Start time: ________
End time: ________
Backend stability: ✓ STABLE / ✗ ISSUES
New errors appeared: YES / NO
```

---

## SUB-BATCH 1B: CUSTOMER REPAIRS (6 deletions)
**Execution Status:** PENDING  
**Started:** [Enter time]  
**Completed:** [Enter time]  

| # | Function | File | Callers | Backup | Deleted | Status |
|---|----------|------|---------|--------|---------|--------|
| 1 | repairSukhwantKahlonOrder | functions/repairSukhwantKahlonOrder.js | ✅ ZERO | ✅ YES | [ ] | PENDING |
| 2 | repairDanyelleOrders | functions/repairDanyelleOrders.js | ✅ ZERO | ✅ YES | [ ] | PENDING |
| 3 | repairDeepaNV367R7PaymentStatus | functions/repairDeepaNV367R7PaymentStatus.js | ✅ ZERO | ✅ YES | [ ] | PENDING |
| 4 | rescheduleHenrryRoblesOrder | functions/rescheduleHenrryRoblesOrder.js | ✅ ZERO | ✅ YES | [ ] | PENDING |
| 5 | createSukhwantOrderFromStripe | functions/createSukhwantOrderFromStripe.js | ✅ ZERO | ✅ YES | [ ] | PENDING |
| 6 | restoreSukhwantPrice | functions/restoreSukhwantPrice.js | ✅ ZERO | ✅ YES | [ ] | PENDING |

### Pre-Deletion
```
[ ] 1A validation passed ✓
[ ] 30-min wait completed ✓
[ ] All 6 functions verified in backup archive
[ ] All 6 confirmed ZERO callers
[ ] All 6 confirmed no automations/webhooks
[ ] Dashboard still stable since 1A deletion
[ ] No new errors in logs
```

### Deletion Log
```
Time: __________ — Starting deletions
Time: __________ — repairSukhwantKahlonOrder deleted
Time: __________ — repairDanyelleOrders deleted
Time: __________ — repairDeepaNV367R7PaymentStatus deleted
Time: __________ — rescheduleHenrryRoblesOrder deleted
Time: __________ — createSukhwantOrderFromStripe deleted
Time: __________ — restoreSukhwantPrice deleted
Time: __________ — All 6 deleted
```

### Validation
```
[ ] Dashboard loads (desktop & mobile): ✓ / ✗
[ ] Orders page loads with full list: ✓ / ✗
[ ] Shopify syncRecentShopifyOrders runs (check logs): ✓ / ✗
[ ] POS orders visible in Orders: ✓ / ✗
[ ] Production Planning loads: ✓ / ✗
[ ] Fulfillment page loads: ✓ / ✗
[ ] Console errors: 0 / [COUNT]
[ ] No new function failures in logs: ✓ / ✗
```

### Validation Result
```
PASS / FAIL

If FAIL → Rollback 1B and investigate
If PASS → Proceed to 30-min wait, then Sub-Batch 1C
```

---

## SUB-BATCH 1C: DATA CLEANUP (5 deletions)
**Execution Status:** PENDING  
**Started:** [Enter time]  
**Completed:** [Enter time]  

| # | Function | File | Callers | Backup | Deleted | Status |
|---|----------|------|---------|--------|---------|--------|
| 1 | findAmarOrders | functions/findAmarOrders.js | ✅ ZERO | ✅ YES | [ ] | PENDING |
| 2 | cleanupAmarKahlonOrders | functions/cleanupAmarKahlonOrders.js | ✅ ZERO | ✅ YES | [ ] | PENDING |
| 3 | cleanupSukhwantDuplicates | functions/cleanupSukhwantDuplicates.js | ✅ ZERO | ✅ YES | [ ] | PENDING |
| 4 | restoreSukhwantOrder | functions/restoreSukhwantOrder.js | ✅ ZERO | ✅ YES | [ ] | PENDING |
| 5 | repairCustomerAddressMapping | functions/repairCustomerAddressMapping.js | ✅ ZERO | ✅ YES | [ ] | PENDING |

### Pre-Deletion
```
[ ] 1B validation passed ✓
[ ] 30-min wait completed ✓
[ ] All 5 functions verified in backup archive
[ ] All 5 confirmed ZERO callers
[ ] All 5 confirmed no automations/webhooks
[ ] Dashboard still stable since 1B deletion
[ ] No new errors in logs
```

### Deletion Log
```
Time: __________ — Starting deletions
Time: __________ — findAmarOrders deleted
Time: __________ — cleanupAmarKahlonOrders deleted
Time: __________ — cleanupSukhwantDuplicates deleted
Time: __________ — restoreSukhwantOrder deleted
Time: __________ — repairCustomerAddressMapping deleted
Time: __________ — All 5 deleted
```

### Validation
```
[ ] Dashboard loads (desktop & mobile): ✓ / ✗
[ ] Orders page loads with full order list: ✓ / ✗
[ ] Can search/filter orders: ✓ / ✗
[ ] Mobile Orders page loads: ✓ / ✗
[ ] Fulfillment page loads and displays tasks: ✓ / ✗
[ ] Production Planning loads: ✓ / ✗
[ ] Create test one-time order → appears in 1 min: ✓ / ✗
[ ] Console errors: 0 / [COUNT]
[ ] No new function failures in logs: ✓ / ✗
```

### Validation Result
```
PASS / FAIL

If FAIL → Rollback 1C and investigate
If PASS → Proceed to 30-min wait, then Sub-Batch 1D
```

---

## SUB-BATCH 1D: DATABASE MIGRATIONS (6 deletions)
**Execution Status:** PENDING  
**Started:** [Enter time]  
**Completed:** [Enter time]  

| # | Function | File | Callers | Backup | Deleted | Status |
|---|----------|------|---------|--------|---------|--------|
| 1 | repairFulfillmentTaskAssignedDeliveryDates | functions/repairFulfillmentTaskAssignedDeliveryDates.js | ✅ ZERO | ✅ YES | [ ] | PENDING |
| 2 | deleteApril23Batches | functions/deleteApril23Batches.js | ✅ ZERO | ✅ YES | [ ] | PENDING |
| 3 | deleteMay2Batches | functions/deleteMay2Batches.js | ✅ ZERO | ✅ YES | [ ] | PENDING |
| 4 | deleteUnknownAndRecalc | functions/deleteUnknownAndRecalc.js | ✅ ZERO | ✅ YES | [ ] | PENDING |
| 5 | repairBrokenCustomerAppOrders | functions/repairBrokenCustomerAppOrders.js | ✅ ZERO | ✅ YES | [ ] | PENDING |
| 6 | repairAssignedProductionDate | functions/repairAssignedProductionDate.js | ✅ ZERO | ✅ YES | [ ] | PENDING |

### Pre-Deletion
```
[ ] 1C validation passed ✓
[ ] 30-min wait completed ✓
[ ] All 6 functions verified in backup archive
[ ] All 6 confirmed ZERO callers
[ ] All 6 confirmed no automations/webhooks
[ ] Dashboard still stable since 1C deletion
[ ] No new errors in logs
```

### Deletion Log
```
Time: __________ — Starting deletions
Time: __________ — repairFulfillmentTaskAssignedDeliveryDates deleted
Time: __________ — deleteApril23Batches deleted
Time: __________ — deleteMay2Batches deleted
Time: __________ — deleteUnknownAndRecalc deleted
Time: __________ — repairBrokenCustomerAppOrders deleted
Time: __________ — repairAssignedProductionDate deleted
Time: __________ — All 6 deleted
```

### Validation
```
[ ] Dashboard loads (desktop & mobile): ✓ / ✗
[ ] Orders page loads and displays all orders: ✓ / ✗
[ ] Fulfillment page loads and displays tasks: ✓ / ✗
[ ] Production Planning page loads: ✓ / ✗
[ ] Create new Stripe test order → order syncs in 1 min: ✓ / ✗
[ ] FulfillmentTask automatically created: ✓ / ✗
[ ] ProductionBatch automatically created: ✓ / ✗
[ ] Console errors: 0 / [COUNT]
[ ] No new function failures in logs: ✓ / ✗
```

### Validation Result
```
PASS / FAIL

If FAIL → Rollback 1D and investigate
If PASS → **BATCH 1 COMPLETE** ✓ — Enter 24h monitoring window
```

---

## BATCH 1 SUMMARY

| Sub-Batch | Functions | Status | Deleted | Validation | Notes |
|-----------|-----------|--------|---------|-----------|-------|
| 1A | 5 | PENDING | 0/5 | PENDING | Test functions |
| 1B | 6 | PENDING | 0/6 | PENDING | Customer repairs |
| 1C | 5 | PENDING | 0/5 | PENDING | Data cleanup |
| 1D | 6 | PENDING | 0/6 | PENDING | Migrations |
| **TOTAL** | **22** | **PENDING** | **0/22** | **PENDING** | --- |

---

## EMERGENCY CONTACTS

**If sub-batch fails:**
1. Note which sub-batch (1A, 1B, 1C, or 1D)
2. Check BATCH_1_CONSERVATIVE_SUBGROUPS.md → Emergency Rollback section
3. Restore only the failed sub-batch's functions
4. Re-run validation
5. Document failure reason

**If ALL sub-batches fail or 24h monitoring shows critical issues:**
1. Restore all 22 functions from CLEANUP_BATCH_FUNCTIONS_BACKUP.md
2. Wait 24 hours
3. Schedule post-mortem
4. Plan re-attempt with more investigation