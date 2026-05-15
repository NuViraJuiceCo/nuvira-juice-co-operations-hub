# NuVira Cleanup Regression Test Checklist
**Purpose:** Verify zero breakage after each cleanup batch  
**Frequency:** After each batch execution  
**Timeline:** 2-3 hours per batch

---

## PRE-CLEANUP BASELINE (Run Before Any Changes)
Record these metrics before cleanup to compare against post-cleanup:

### Function Performance Baseline
```
Run on: [DATE/TIME]
Integration credits used (last 24h): _____ credits
Top 5 slowest functions: _______
Function error count: _______
Failed webhook deliveries: _______
```

### Critical Path Baseline
```
Stripe → Hub order creation time: _____ seconds
Customer App → Hub order sync time: _____ seconds
Shopify → Hub order creation time: _____ seconds
Production batch calculation time: _____ seconds
Fulfillment task creation time: _____ seconds
Dashboard load time: _____ seconds
```

---

## BATCH 1: DISABLE AUTOMATIONS (24h Monitoring)

### Automated Metrics (Dashboard)
- [ ] Integration credit usage: **Should drop by ~200 credits/day**
- [ ] detectStripeOrderSyncIssues: **Function calls should go to ZERO**
- [ ] OrderReviewQueue growth: **Should be normal (not spike)**
- [ ] Function error logs: **No new errors from disabled functions**
- [ ] Dashboard KPIs: **All metrics should remain accurate**

### Manual Tests
- [ ] Dashboard page loads instantly (no timeout)
- [ ] Orders page displays all orders
- [ ] Production Planning shows accurate batch demand
- [ ] Fulfillment tasks render correctly
- [ ] Driver Portal accessible
- [ ] Compliance logs page functional

### Customer App Tests
- [ ] Checkout: Can complete one-time order
- [ ] Subscription: Can select plan and pay
- [ ] Loyalty: Points display correctly in user dashboard
- [ ] Order History: Previous orders display correctly
- [ ] Rewards: Can view available rewards

### Shopify Tests
- [ ] POS order appears in Hub Orders page within 2 minutes
- [ ] POS order marked with "shopify_pos" tag
- [ ] POS order NOT listed for production/fulfillment

### Stripe Tests
- [ ] One-time order payment → Hub order created
- [ ] Subscription order payment → Hub subscription created
- [ ] Refund flow: Process refund → Order marked refunded

### Hub Sync Tests
- [ ] Scheduler: Pull orders from Customer App runs hourly
- [ ] Scheduler: Recalculate batches runs hourly
- [ ] Scheduler: Sync fulfillment tasks runs nightly
- [ ] No new errors in scheduler logs

### Decision Gate
```
✅ All tests passed → Proceed to BATCH 2
❌ Any test failed → ROLLBACK (re-enable automations)
```

---

## BATCH 2: DELETE ONE-TIME REPAIRS (48h Monitoring)

### Critical Path Tests
#### 1. One-Time Order Flow
```
[ ] Customer App: Browse products
[ ] Customer App: Add to cart
[ ] Customer App: Proceed to checkout
[ ] Stripe: Complete payment (use test card 4242 4242 4242 4242)
[ ] Hub: Order appears in Orders page within 30 seconds
[ ] Hub: Order shows correct total, customer, items
[ ] Hub: Production batch automatically created
[ ] Hub: FulfillmentTask automatically created
[ ] Hub: Dashboard KPIs updated (new orders count)
```

#### 2. Subscription Order Flow
```
[ ] Customer App: Browse subscription plans
[ ] Customer App: Select "Monthly Ritual" plan
[ ] Customer App: Proceed to checkout
[ ] Stripe: Complete payment
[ ] Hub: Order appears in Orders page
[ ] Hub: Order marked as subscription type
[ ] Hub: 4 FulfillmentTask objects created (one per week)
[ ] Hub: Dashboard KPIs show subscription orders
```

#### 3. Shopify POS Flow
```
[ ] Shopify: Ring up transaction at POS terminal
[ ] Shopify: Mark source_name as "pos" and location_id
[ ] Shopify: Complete transaction
[ ] Hub (via webhook): Order appears in Orders page within 1 minute
[ ] Hub: Order marked with source_channel="pos"
[ ] Hub: Order does NOT appear in Production Planning
[ ] Hub: Order does NOT have FulfillmentTask
[ ] Dashboard: POS metrics show this transaction
```

#### 4. Production Planning Flow
```
[ ] Production Planning page loads within 2 seconds
[ ] Select date range: next 7 days
[ ] Page shows: demand by product, total units, ingredient needs
[ ] Click "Calculate Ingredients": ingredient list generates correctly
[ ] Verify: all active orders included in demand
[ ] Verify: POS and refunded orders excluded from demand
```

#### 5. Manual Batch Flow
```
[ ] Production page loads
[ ] Create manual batch: "Test Batch" on 2026-05-15
[ ] Add items: 1x Aura, 1x Oasis
[ ] Save batch
[ ] Start batch production
[ ] Verify: batch status = "in_production", locked from edit
[ ] Complete batch: upload compliance logs
[ ] Verify: batch status = "verified_logged"
[ ] Verify: FulfillmentTask status updated to "Packed"
```

#### 6. Fulfillment Flow
```
[ ] Driver Portal: Driver logs in
[ ] Dashboard shows: unassigned delivery tasks for today
[ ] Click delivery: can see order details, items, address
[ ] Submit delivery: upload proof photo, mark complete
[ ] Verify: FulfillmentTask status = "Delivered"
[ ] Verify: Customer receives order confirmation
```

#### 7. Loyalty Flow
```
[ ] One-time order delivered
[ ] Verify: LoyaltyMember record exists
[ ] Verify: UserPoints record created with correct amount
[ ] Customer App: Check loyalty dashboard
[ ] Verify: Points appear within 2 minutes
[ ] Verify: Can view rewards catalog
```

#### 8. Refund Flow
```
[ ] Hub: Find paid order in Orders page
[ ] Admin: Click refund button
[ ] Admin: Enter refund amount = order total
[ ] Stripe: Confirm charge was refunded
[ ] Hub: Verify order status = "refunded"
[ ] Hub: Verify order archived from operational view
[ ] Customer App: Verify refund appears in order history
```

### Dashboard Tests
```
[ ] KPI Cards load:
    [ ] New Orders (should be > 0 for test orders)
    [ ] In Production (should be accurate)
    [ ] To Fulfill (should be accurate)
    [ ] Low Stock (should be accurate)
    [ ] Net Revenue (should show test totals)
    [ ] Exceptions (should be normal)
[ ] Widgets load:
    [ ] Production Throughput chart
    [ ] Active Order Status chart
    [ ] Inventory Alerts widget
[ ] Sync Panel shows:
    [ ] Last sync time
    [ ] Sync status for each integration
```

### Negative Tests (Verify Errors Handled Correctly)
```
[ ] Try to checkout without entering delivery address → Error shown
[ ] Try to refund already-refunded order → Error shown
[ ] Try to create batch without selecting products → Error shown
[ ] Try to mark delivery complete without photo → Error shown
[ ] Network latency/timeout → UI shows loading state
```

### Performance Tests
```
[ ] Dashboard load time: < 2 seconds
[ ] Orders page load time (100 orders): < 3 seconds
[ ] Production Planning load time: < 2 seconds
[ ] Fulfillment page load time: < 2 seconds
[ ] Batch creation: < 500ms
[ ] Function execution: no timeout (> 30 seconds)
```

### Log Analysis
```
[ ] Console errors: Should be ZERO new errors
[ ] Function logs: Should show no calls to deleted functions
[ ] Webhook logs: Should show successful deliveries
[ ] Database logs: Should show normal read/write pattern
[ ] Integration credit usage: Should not spike
```

### Decision Gate
```
✅ All tests passed → Proceed to BATCH 3
❌ Any critical test failed → ROLLBACK (restore deleted functions)
❌ Any function called that was deleted → ROLLBACK immediately
```

---

## BATCH 3: HARDEN CRITICAL FUNCTIONS (24h Monitoring)

### pullOrdersFromCustomerApp Hardening Tests
```
[ ] Function runs hourly without auth errors
[ ] Logs show: successful API calls to Customer App
[ ] Logs show: no "401 Unauthorized" errors
[ ] Logs show: exponential backoff working if rate-limited
[ ] Orders sync within 2-3 minutes of Customer App creation
[ ] Subscription orders sync with correct fulfillments
[ ] No duplicate orders created
[ ] Credit usage per call: same or lower than before
```

### detectAndCanonicalizeDuplicateOrders Hardening Tests
```
[ ] Function identifies true duplicates (same email + date + amount)
[ ] Function does NOT flag legitimate similar orders (different customers)
[ ] OrderReviewQueue shows: only HIGH-CONFIDENCE duplicate candidates
[ ] No false positives in logs (flagging non-duplicates)
[ ] Function completes within 5 seconds (performance improvement)
[ ] After fix: duplicate order detection rate same or better
```

### auditActiveOrdersWithGuardrails Hardening Tests
```
[ ] Function runs hourly without duplicating queue items
[ ] OrderReviewQueue: same issue not flagged twice
[ ] Idempotency key prevents duplicate alerts
[ ] Queue items show distinct issues, not repeats
[ ] Alert notification sent only once per issue
```

### Overall Hardening Validation
```
[ ] Integration credit usage: maintained or reduced
[ ] Function execution time: same or faster
[ ] Error logs: fewer auth/rate-limit errors
[ ] Success rate: > 99%
[ ] No customer impact: all flows still work
```

### Decision Gate
```
✅ All tests passed → Cleanup complete, maintain production
❌ Any test failed → git revert hardening changes, re-test original
```

---

## POST-CLEANUP VALIDATION (Final Checklist)

### Summary Metrics
```
Function count reduction: Before [X] → After [Y]
Code lines reduced: Before [X] → After [Y]
Daily credit savings: [X] credits/day
Functions with hardening: 3 (pullOrdersFromCustomerApp, detectAndCanonicalizeDuplicateOrders, auditActiveOrdersWithGuardrails)
Functions disabled (keep code): 3 (detectStripeOrderSyncIssues, shopifyWebhookProbe, shopifyWebhookDiagnostic)
Functions deleted: 22 (all archived in backup)
```

### Sign-Off
```
Cleanup executed by: _____________
Date: _____________
All tests passed: ✅ / ❌
Rollback tested: ✅ / ❌
Production stable: ✅ / ❌
Credit savings verified: ✅ / ❌
```

---

## ROLLBACK CHECKLIST (If Needed)

### Quick Rollback (Within 24h of any batch)
```
1. [ ] Identify failed test from checklist above
2. [ ] Review CLEANUP_PLAN_DISABLE_FIRST.md section "Rollback"
3. [ ] Execute rollback steps (varies by batch)
4. [ ] Verify all tests pass again
5. [ ] Document why rollback was needed
6. [ ] Schedule post-mortem analysis
```

### Full Rollback (If critical path broken)
```
1. [ ] Stop all running jobs
2. [ ] Restore deleted functions from CLEANUP_BATCH_FUNCTIONS_BACKUP.md
3. [ ] Re-enable disabled automations
4. [ ] Revert code changes (git revert)
5. [ ] Restart backend
6. [ ] Run full regression test checklist
7. [ ] Verify all critical paths work
8. [ ] Document incident
``