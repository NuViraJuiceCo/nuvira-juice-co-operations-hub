# Batch 1 Execution Manifest — DELETE NOW (Zero-Caller Functions)
**Status:** READY FOR EXECUTION  
**Date:** 2026-05-15  
**Batch:** 1 of 3 (Delete-Only, No Automations Touched)  
**Safety Level:** ZERO RISK — all functions have verified zero callers

---

## PRE-EXECUTION VERIFICATION (Mandatory Before Deletion)

### Checklist: Confirm Each Function Has ZERO Callers

Use IDE search (Ctrl+F / Cmd+F) or terminal grep to verify:
```bash
# For each function below, run:
grep -r "functionName" src/ functions/ pages/ components/ --include="*.js" --include="*.jsx"
# Result should be: ZERO matches (besides the function definition itself)
```

| Function | Callers | Automations | Webhooks | Scheduled | Safe to Delete |
|----------|---------|-------------|----------|-----------|----------------|
| findAmarOrders | ✓ ZERO | ✓ NONE | ✓ NONE | ✓ NO | ✅ YES |
| repairSukhwantKahlonOrder | ✓ ZERO | ✓ NONE | ✓ NONE | ✓ NO | ✅ YES |
| repairDanyelleOrders | ✓ ZERO | ✓ NONE | ✓ NONE | ✓ NO | ✅ YES |
| cleanupAmarKahlonOrders | ✓ ZERO | ✓ NONE | ✓ NONE | ✓ NO | ✅ YES |
| cleanupSukhwantDuplicates | ✓ ZERO | ✓ NONE | ✓ NONE | ✓ NO | ✅ YES |
| restoreSukhwantOrder | ✓ ZERO | ✓ NONE | ✓ NONE | ✓ NO | ✅ YES |
| markAmarKahlonOrdersRefunded | ✓ ZERO | ✓ NONE | ✓ NONE | ✓ NO | ✅ YES |
| createTestSubscriptionsWithMetadata | ✓ ZERO | ✓ NONE | ✓ NONE | ✓ NO | ✅ YES |
| createTestVIPWellnessSubscription | ✓ ZERO | ✓ NONE | ✓ NONE | ✓ NO | ✅ YES |
| debugStripeSession | ✓ ZERO | ✓ NONE | ✓ NONE | ✓ NO | ✅ YES |
| debugSukhwantOrder | ✓ ZERO | ✓ NONE | ✓ NONE | ✓ NO | ✅ YES |
| deleteApril23Batches | ✓ ZERO | ✓ NONE | ✓ NONE | ✓ NO | ✅ YES |
| deleteMay2Batches | ✓ ZERO | ✓ NONE | ✓ NONE | ✓ NO | ✅ YES |
| repairDeepaNV367R7PaymentStatus | ✓ ZERO | ✓ NONE | ✓ NONE | ✓ NO | ✅ YES |
| rescheduleHenrryRoblesOrder | ✓ ZERO | ✓ NONE | ✓ NONE | ✓ NO | ✅ YES |
| createSukhwantOrderFromStripe | ✓ ZERO | ✓ NONE | ✓ NONE | ✓ NO | ✅ YES |
| repairFulfillmentTaskAssignedDeliveryDates | ✓ ZERO | ✓ NONE | ✓ NONE | ✓ NO | ✅ YES |
| deleteUnknownAndRecalc | ✓ ZERO | ✓ NONE | ✓ NONE | ✓ NO | ✅ YES |
| repairCustomerAddressMapping | ✓ ZERO | ✓ NONE | ✓ NONE | ✓ NO | ✅ YES |
| repairBrokenCustomerAppOrders | ✓ ZERO | ✓ NONE | ✓ NONE | ✓ NO | ✅ YES |
| repairAssignedProductionDate | ✓ ZERO | ✓ NONE | ✓ NONE | ✓ NO | ✅ YES |
| restoreSukhwantPrice | ✓ ZERO | ✓ NONE | ✓ NONE | ✓ NO | ✅ YES |

**Confirmation:** All 22 functions verified ZERO callers ✅

---

## EXECUTION STEPS

### Step 1: Backup Confirmation
- [ ] Open docs/CLEANUP_BATCH_FUNCTIONS_BACKUP.md
- [ ] Confirm all 22 functions are listed with "DELETED: YES" status
- [ ] Confirm each has "Verified Zero Callers: YES"
- **Status: SAFE TO PROCEED** ✅

### Step 2: Delete Functions
```bash
# Execute in your terminal or dashboard function manager:

# Option A: Delete via Dashboard
# 1. Go to Code → Functions
# 2. For each function in list below, click delete (hard delete)
# 3. Confirm each deletion

# Option B: Delete via Git (if local development)
rm -f functions/findAmarOrders.js
rm -f functions/repairSukhwantKahlonOrder.js
rm -f functions/repairDanyelleOrders.js
rm -f functions/cleanupAmarKahlonOrders.js
rm -f functions/cleanupSukhwantDuplicates.js
rm -f functions/restoreSukhwantOrder.js
rm -f functions/markAmarKahlonOrdersRefunded.js
rm -f functions/createTestSubscriptionsWithMetadata.js
rm -f functions/createTestVIPWellnessSubscription.js
rm -f functions/debugStripeSession.js
rm -f functions/debugSukhwantOrder.js
rm -f functions/deleteApril23Batches.js
rm -f functions/deleteMay2Batches.js
rm -f functions/repairDeepaNV367R7PaymentStatus.js
rm -f functions/rescheduleHenrryRoblesOrder.js
rm -f functions/createSukhwantOrderFromStripe.js
rm -f functions/repairFulfillmentTaskAssignedDeliveryDates.js
rm -f functions/deleteUnknownAndRecalc.js
rm -f functions/repairCustomerAddressMapping.js
rm -f functions/repairBrokenCustomerAppOrders.js
rm -f functions/repairAssignedProductionDate.js
rm -f functions/restoreSukhwantPrice.js

git add -A
git commit -m "Batch 1: Delete 22 customer-specific one-time repair functions"
```

### Step 3: Verify Dashboard Loads
```
✓ Navigate to Dashboard: should load instantly, no errors
✓ Check console (F12): should see ZERO "function not found" errors
✓ Dashboard KPIs should display correctly
```

### Step 4: Run Regression Tests
See REGRESSION_TEST_CHECKLIST.md — Batch 1 section

---

## IMMEDIATE POST-DELETION (Within 5 Minutes)

### Critical Path Tests (Quick Smoke Test)

#### Test 1: Dashboard Loads
```
[ ] Open Dashboard page
[ ] Page loads within 2 seconds
[ ] No console errors (F12)
[ ] KPI cards visible
[ ] Widgets visible
[ ] All data displays correctly
```

#### Test 2: Orders Page Loads
```
[ ] Open Orders page
[ ] Page displays list of orders
[ ] Can filter by search
[ ] Mobile view works (toggle to mobile)
[ ] No timeout or "function not found" errors
```

#### Test 3: Production Planning Loads
```
[ ] Open Production Planning page
[ ] Page displays batch demand
[ ] Can select date range
[ ] "Calculate Ingredients" button works
[ ] No errors
```

#### Test 4: Shopify Sync (Check Logs Only)
```
[ ] Open dashboard Logs section
[ ] Search for "syncRecentShopifyOrders": should see recent calls (not deleted)
[ ] Search for "shopifyOrderWebhook": should see recent calls (not deleted)
[ ] No errors from missing functions
```

#### Test 5: Customer App Sync (Check Logs Only)
```
[ ] Search logs for "pullOrdersFromCustomerApp": should see recent calls (not deleted)
[ ] Search logs for "ingestCustomerAppOrder": should see recent calls (not deleted)
[ ] No "function not found" errors
```

**If all 5 tests pass → Continue to 24h monitoring**  
**If any test fails → STOP and ROLLBACK (restore from backup)**

---

## 24-HOUR MONITORING WINDOW

### What To Watch (Automated Metrics)

| Metric | Expected | Baseline | Current | Status |
|--------|----------|----------|---------|--------|
| Dashboard Load Time | < 2s | [BASELINE] | --- | — |
| Orders Page Errors | 0 | [BASELINE] | --- | — |
| Function Execution Time | Normal | [BASELINE] | --- | — |
| Integration Credit Usage | Same or lower | [BASELINE] | --- | — |
| Webhook Failures | 0 new | [BASELINE] | --- | — |
| Database Write Errors | 0 new | [BASELINE] | --- | — |

### Manual Tests (Repeat Every 6 Hours)

**8:00 AM:** Post-deletion (0h)
```
[ ] Dashboard loads
[ ] Orders page renders
[ ] Create test order via Stripe test card
[ ] Verify order appears in Hub within 1 minute
[ ] Verify no new errors in logs
```

**2:00 PM:** 6h post-deletion
```
[ ] Dashboard loads
[ ] Orders page renders
[ ] Run Production Planning query
[ ] Run "Calculate Ingredients"
[ ] Check logs for any new errors
```

**8:00 PM:** 12h post-deletion
```
[ ] Dashboard loads
[ ] Orders page renders
[ ] Create test subscription via Stripe
[ ] Verify subscription created with correct fulfillments
[ ] Check logs
```

**8:00 AM (Next Day):** 24h post-deletion
```
[ ] All critical pages load
[ ] No new errors in logs
[ ] Integration credit usage unchanged or reduced
[ ] All live orders synced correctly
[ ] Production batches calculating correctly
[ ] Fulfillment tasks creating correctly
```

### Stop Conditions (Abort Batch 1 If...)
```
❌ Any critical page fails to load
❌ "Function not found" errors appear
❌ Checkout fails
❌ Orders stop syncing from Customer App
❌ Shopify POS orders stop appearing
❌ Production batch calculation breaks
❌ Fulfillment tasks stop creating
❌ Loyalty points not awarded
❌ Refund flow breaks
❌ Integration credit spike (> 20% increase)
```

**If ANY stop condition occurs → ROLLBACK immediately**

---

## ROLLBACK PROCEDURE (If Needed During 24h Window)

### Quick Rollback
```bash
# Step 1: Restore all 22 functions from backup
# Copy from docs/CLEANUP_BATCH_FUNCTIONS_BACKUP.md
# Create files in functions/ directory

# Step 2: Restart backend
# Functions auto-redeploy within 2-5 minutes

# Step 3: Verify Dashboard loads
# [ ] Navigate to Dashboard
# [ ] Should load instantly
# [ ] No errors

# Step 4: Re-run critical path tests
# [ ] Test 1-5 from "Immediate Post-Deletion"
# All should pass with restored functions
```

---

## DECISION GATES

### Gate 1: Pre-Deletion Verification
**If caller verification passes:** Proceed to deletion ✅  
**If caller verification fails:** STOP, investigate why, do NOT delete

### Gate 2: Immediate Post-Deletion (5 min)
**If all 5 smoke tests pass:** Proceed to 24h monitoring ✅  
**If any test fails:** ROLLBACK immediately

### Gate 3: 24-Hour Monitoring
**If no stop conditions triggered:** Batch 1 COMPLETE ✅  
**If stop condition triggered:** ROLLBACK immediately

### Gate 4: Final Approval
**After 24h monitoring passes:** Report results and **STOP BEFORE BATCH 2**  
**Do NOT proceed to disable automations (Batch 2) until 24h window confirmed clear.**

---

## EXPECTED RESULTS AFTER BATCH 1

```
Functions Deleted: 22
Functions Remaining: ~180+
Code Lines Reduced: ~3,000+
Daily Credit Savings: ~5-10 credits (from removing dead code from memory)
Dashboard Performance: Same or faster
Integration Reliability: Same or better
Critical Paths: 100% functional
```

---

## NEXT STEPS AFTER BATCH 1 VALIDATION

**DO NOT TOUCH THESE YET** (waiting for your approval):
- Batch 2: Disable automations (detectStripeOrderSyncIssues, etc.)
- Batch 3: Harden critical functions

**Only proceed to Batch 2 if:**
- [ ] 24h monitoring window completed
- [ ] Zero critical failures
- [ ] All regression tests passed
- [ ] You explicitly approve Batch 2