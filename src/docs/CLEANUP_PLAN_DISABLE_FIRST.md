# NuVira Disable-First Cleanup Plan
**Status:** Ready for Execution  
**Date:** 2026-05-15  
**Approach:** Disable → Monitor 24h → Archive Code → Delete → Monitor 48h → Rollback Ready

---

## BATCH 1: DISABLE ONLY (Zero Deletions, Lowest Risk)
**Timeline:** 30 minutes execution + 24h monitoring  
**Rollback:** Re-enable automation in dashboard

### 1.1 Disable Automations (No Code Deletion)

| Automation | Trigger | Function | Current Status | Action | Cost Savings | Risk |
|-----------|---------|----------|----------------|--------|--------------|------|
| **Detect Stripe Issues** | Every 15 minutes | detectStripeOrderSyncIssues | ACTIVE | **DISABLE** | ~200 credits/day | LOW — keeps function code |
| **Shopify Webhook Probe** | Manual/Scheduled | shopifyWebhookProbe | UNKNOWN | **DISABLE** | ~5 credits/day | LOW |
| **Shopify Webhook Diagnostic** | Manual/Scheduled | shopifyWebhookDiagnostic | UNKNOWN | **DISABLE** | ~5 credits/day | LOW |

### 1.2 Verification Before Disabling

#### detectStripeOrderSyncIssues
- ✓ Called by: Automation only (every 15min)
- ✓ No pages call it
- ✓ No webhooks call it
- ✓ No other functions call it
- ✓ Evidence: Logs show 96 calls/day finding "1 issue" each time but never resolving
- ✓ Safe to disable: YES

#### shopifyWebhookProbe / shopifyWebhookDiagnostic
- ✓ Called by: Admin diagnostics only (manual)
- ✓ No automations
- ✓ No pages
- ✓ No webhooks
- ✓ Safe to disable: YES

### 1.3 Execution Steps
```bash
# Step 1: List current automations
base44 automations list

# Step 2: Disable automations (using manage_automation with action="toggle")
# - Detect Stripe Issues
# - Shopify Webhook Probe
# - Shopify Webhook Diagnostic

# Step 3: Monitor for 24 hours
- Check integration credit dashboard: should drop by ~200 credits/day
- Check function error logs: should no longer see detectStripeOrderSyncIssues spam
- Check OrderReviewQueue: should not grow from phantom detections
- Verify no pages or automations broke

# Step 4: If 24h clear, proceed to BATCH 2 (Delete)
```

### 1.4 Rollback
```bash
# If issues detected within 24h:
# 1. Re-enable automations via dashboard
# 2. Restart functions: functions will resume next cycle
# 3. No data was deleted, safe restore
```

---

## BATCH 2: DELETE CUSTOMER-SPECIFIC ONE-TIME REPAIRS (Archive Code First)
**Timeline:** 1 hour execution + 48h monitoring  
**Rollback:** Restore functions from CLEANUP_BATCH_FUNCTIONS_BACKUP.md

### 2.1 Functions to Delete (Zero Live Purpose)

**Verification: All have ZERO callers**

| Function | Purpose | Last Used | Callers | Automated | Risk | Action |
|----------|---------|-----------|---------|-----------|------|--------|
| findAmarOrders | Customer-specific order search (Amar Kahlon) | One-time | NONE | NO | ZERO | DELETE |
| repairSukhwantKahlonOrder | Customer-specific order repair | One-time | NONE | NO | ZERO | DELETE |
| repairDanyelleOrders | Customer-specific order repair | One-time | NONE | NO | ZERO | DELETE |
| cleanupAmarKahlonOrders | Test data cleanup | One-time | NONE | NO | ZERO | DELETE |
| cleanupSukhwantDuplicates | Test data cleanup | One-time | NONE | NO | ZERO | DELETE |
| restoreSukhwantOrder | Customer-specific recovery | One-time | NONE | NO | ZERO | DELETE |
| markAmarKahlonOrdersRefunded | Test utility | One-time | NONE | NO | ZERO | DELETE |
| createTestSubscriptionsWithMetadata | Test fixture | One-time | NONE | NO | ZERO | DELETE |
| createTestVIPWellnessSubscription | Test fixture | One-time | NONE | NO | ZERO | DELETE |
| debugStripeSession | Debug utility | One-time | NONE | NO | ZERO | DELETE |
| debugSukhwantOrder | Debug utility | One-time | NONE | NO | ZERO | DELETE |
| deleteApril23Batches | One-time cleanup | One-time | NONE | NO | ZERO | DELETE |
| deleteMay2Batches | One-time cleanup | One-time | NONE | NO | ZERO | DELETE |
| repairDeepaNV367R7PaymentStatus | Customer-specific one-time | One-time | NONE | NO | ZERO | DELETE |
| rescheduleHenrryRoblesOrder | Customer-specific one-time | One-time | NONE | NO | ZERO | DELETE |
| createSukhwantOrderFromStripe | One-time recovery | One-time | NONE | NO | ZERO | DELETE |
| repairFulfillmentTaskAssignedDeliveryDates | One-time fix | One-time | NONE | NO | ZERO | DELETE |
| deleteUnknownAndRecalc | One-time cleanup | One-time | NONE | NO | ZERO | DELETE |
| repairCustomerAddressMapping | One-time fix | One-time | NONE | NO | ZERO | DELETE |
| repairBrokenCustomerAppOrders | One-time fix | One-time | NONE | NO | ZERO | DELETE |
| repairAssignedProductionDate | One-time fix | One-time | NONE | NO | ZERO | DELETE |
| restoreSukhwantPrice | One-time recovery | One-time | NONE | NO | ZERO | DELETE |

**Total: 22 functions to delete**

### 2.2 Pre-Delete Checklist

For EACH function in list above:
- [ ] Search codebase for function name: **ZERO results in pages, components, other functions**
- [ ] Check automations: **ZERO automations call this function**
- [ ] Check webhooks: **No webhooks route to this**
- [ ] Check scheduled jobs: **Not scheduled**
- [ ] Check entity triggers: **Not triggered on entity events**
- [ ] Verify last invocation: **>30 days ago or never**
- [ ] Check logs: **Function not called in last 24h**

### 2.3 Execution Steps
```bash
# Step 1: Archive function code to CLEANUP_BATCH_FUNCTIONS_BACKUP.md
# (already done in backup document)

# Step 2: Delete functions from functions/ directory
# One at a time, batch-delete:
rm -f functions/findAmarOrders.js
rm -f functions/repairSukhwantKahlonOrder.js
... (repeat for all 22)

# Step 3: Verify dashboard still loads (no import errors)
# - Navigate to Dashboard
# - Navigate to Orders
# - Navigate to Production Planning
# - No "function not found" errors

# Step 4: Monitor for 48 hours
- Check function error logs: should not see deleted functions
- Check OrderReviewQueue growth: should be normal (not spike)
- Check dashboard refresh: should be instant (no timeout)
- Verify all orders display correctly
- Verify production batches calculate correctly
- Verify fulfillment tasks render

# Step 5: If 48h clear, proceed to BATCH 3 (Harden)
```

### 2.4 Rollback
```bash
# If issues detected within 48h:
# 1. Restore all deleted functions from backup (CLEANUP_BATCH_FUNCTIONS_BACKUP.md)
# 2. Re-create files in functions/ directory
# 3. Restart backend: functions auto-redeploy
# 4. All functions restored within 2-5 minutes
```

---

## BATCH 3: HARDEN CRITICAL FUNCTIONS (Refactor, Don't Delete)
**Timeline:** 8-12 hours execution + 24h testing  
**Rollback:** Revert code changes via git

### 3.1 Functions Needing Hardening (KEEP, but improve reliability)

| Function | Issue | Fix Required | Complexity | Timeline |
|----------|-------|--------------|-----------|----------|
| **pullOrdersFromCustomerApp** | Auth errors in logs every minute | Add exponential backoff, verify API endpoint, improve error handling | MEDIUM | 2-3 hours |
| **detectAndCanonicalizeDuplicateOrders** | Complex logic, no unit tests | Add unit tests, simplify detection logic | MEDIUM | 2-3 hours |
| **auditActiveOrdersWithGuardrails** | May create duplicate alerts | Add idempotency key to OrderReviewQueue deduplication | LOW | 1 hour |

### 3.2 Verification Before Hardening
- ✓ All three functions are mission-critical (see PHASE 2 flow mapping)
- ✓ All have existing callers or automations
- ✓ All are safe to refactor (don't delete, just improve)
- ✓ Refactoring won't change external behavior

### 3.3 Execution Steps
```bash
# Step 1: Create feature branch: cleanup/harden-critical-functions

# Step 2: Fix pullOrdersFromCustomerApp
# - Add exponential backoff on auth failure
# - Log API endpoint being called
# - Add structured error logging
# - Test with mock auth errors

# Step 3: Fix detectAndCanonicalizeDuplicateOrders
# - Add unit tests for known duplicate cases
# - Simplify detection: only flag high-confidence duplicates
# - Test against real order data

# Step 4: Fix auditActiveOrdersWithGuardrails
# - Change OrderReviewQueue creation to use idempotency_key
# - Deduplicate before inserting: if idempotency_key exists, skip
# - Test: run function twice, verify only 1 queue item created

# Step 5: Deploy to staging
# - Run regression tests (see REGRESSION_TEST_CHECKLIST.md)
# - Test with 24h of production orders
# - Verify no new errors in logs

# Step 6: Deploy to production
# - Merge to main branch
# - Monitor for 24h
# - Check credit usage: should be same or lower
# - Check error logs: fewer auth errors expected
```

### 3.4 Rollback
```bash
# If issues detected:
# 1. git revert <commit-hash>
# 2. Restart functions
# 3. Original behavior restored within 2-5 minutes
```

---

## SUMMARY: EXECUTION TIMELINE

```
Week 1, Day 1:  BATCH 1 (Disable) - 24h monitoring
                ✓ Disable detectStripeOrderSyncIssues automation
                ✓ Disable probe/diagnostic automations
                
Week 1, Day 2:  Monitor batch 1 - watch credit usage drop
                
Week 1, Day 3:  BATCH 2 (Delete) - 48h monitoring
                ✓ Backup 22 customer-specific functions
                ✓ Delete all 22 functions
                ✓ Verify dashboard loads without errors
                
Week 1, Day 5:  Monitor batch 2 - watch for missing function errors
                
Week 1, Day 6:  BATCH 3 (Harden) - refactor critical functions
                ✓ Fix pullOrdersFromCustomerApp
                ✓ Fix detectAndCanonicalizeDuplicateOrders
                ✓ Fix auditActiveOrdersWithGuardrails
                ✓ Run regression tests
                
Week 2, Day 1:  Monitor batch 3 - watch for improved reliability
                
Week 2, Day 2:  CLEANUP COMPLETE
                - Estimated credit savings: 200+ credits/day
                - Estimated code reduction: 3,000+ LOC
                - Zero critical flow breakage
                - Full rollback documentation in place
```

---

## CRITICAL: DO NOT SKIP THESE STEPS

### Before Any Batch
- [ ] Read CLEANUP_BATCH_FUNCTIONS_BACKUP.md to see what you're deleting
- [ ] Search codebase for function callers (grep, IDE, dashboard)
- [ ] Check automation triggers in dashboard
- [ ] Verify no dependencies in entity triggers

### After Any Batch
- [ ] Dashboard loads without errors
- [ ] Orders page displays data
- [ ] Production Planning calculates correctly
- [ ] No new function errors in logs

### Monitoring Windows (Non-Negotiable)
- Disable batch: **24 hours minimum**
- Delete batch: **48 hours minimum**
- Harden batch: **24 hours minimum**

### Rollback Paths
- All deleted functions are backed up in CLEANUP_BATCH_FUNCTIONS_BACKUP.md
- All disabled automations can be re-enabled via dashboard
- All refactored code can be reverted via git revert

---

## STOP POINTS (Abort and Rollback If...)

- ❌ Any critical page fails to load (Orders, Dashboard, Production)
- ❌ Checkout or subscription creation fails
- ❌ Orders fail to sync from Customer App
- ❌ Shopify POS orders stop appearing
- ❌ Production batch demand goes to zero unexpectedly
- ❌ Fulfillment tasks stop being created
- ❌ Driver delivery submission fails
- ❌ Loyalty points not awarded
- ❌ Refund flow breaks
- ❌ Compliance logs can't be created

If ANY of these occur during monitoring window → **STOP, ROLLBACK, INVESTIGATE**