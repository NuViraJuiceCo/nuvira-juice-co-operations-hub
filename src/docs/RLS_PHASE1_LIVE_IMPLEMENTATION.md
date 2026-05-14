# RLS Phase 1 — Live Implementation Companion

**Use this while actively configuring RLS in Base44 dashboard.**

---

## 🎯 Current Session Info

**Implementation Date:** _______________  
**Implementer:** _______________  
**Start Time:** _______________  

---

## ⚡ Quick Dashboard Navigation

1. **Open Base44 Dashboard** → https://app.base44.com (or your workspace URL)
2. **Navigate to:** Data → Entities
3. **Select Entity:** Click on entity name (e.g., "ShopifyOrder")
4. **Open Security Tab:** Look for "Security", "RLS", or "Row Level Security"
5. **Add Rules:** Click "Add Rule" or "Create Policy"
6. **Save:** Click "Save" or "Apply" after each rule

---

## 📋 Entity 1: ShopifyOrder — APPLY NOW

### Step 1: Open Entity Security
- [ ] Navigate to: Dashboard → Data → Entities → **ShopifyOrder** → Security tab

### Step 2: Add Read Rule
**Click "Add Rule" → Fill in:**

| Field | Value |
|-------|-------|
| **Operation** | Read |
| **Role** | customer |
| **Filter Type** | Custom/Advanced |
| **Filter** | See below |

**Filter JSON (copy-paste):**
```json
{
  "$or": [
    { "customer_email": "{{user.email}}" },
    { "user_email": "{{user.email}}" }
  ]
}
```

- [ ] Rule added and saved

### Step 3: Add Create Rule
**Click "Add Rule" → Fill in:**

| Field | Value |
|-------|-------|
| **Operation** | Create |
| **Role** | customer |
| **Filter** | `{"customer_email": "{{user.email}}"}` |

- [ ] Rule added and saved

### Step 4: Add Update Rule
**Click "Add Rule" → Fill in:**

| Field | Value |
|-------|-------|
| **Operation** | Update |
| **Role** | customer |
| **Filter** | `{"customer_email": "{{user.email}}", "order_lock_status": "unlocked"}` |

- [ ] Rule added and saved

### Step 5: Verify Admin Access
**Important:** Admin users should automatically have full access. No rule needed for admin role.

- [ ] Confirmed: No admin-specific rules added (admin bypasses RLS automatically)

### Step 6: Immediate Validation Tests

**Test 1: Customer Isolation**
```bash
# Run in Base44 dashboard → Code → Functions → rlsPhase1Validation
# Or test manually:
1. Login as Customer A (test.customer.a@example.com)
2. Go to Orders page
3. Count visible orders: _____
4. Verify: Only Customer A's orders shown
```
- [ ] PASSED: Customer A sees only their own orders

**Test 2: Admin Full Access**
```bash
1. Login as Admin
2. Go to Orders page
3. Count visible orders: _____
4. Verify: All orders visible (not filtered)
```
- [ ] PASSED: Admin sees all orders

**Test 3: Production Planning Continuity**
```bash
# Run function: recalculateProductionBatches
1. Dashboard → Code → Functions → recalculateProductionBatches
2. Click "Test" or run manually
3. Check logs for errors
4. Verify: Function completes successfully
```
- [ ] PASSED: Production planning still works

### 🛑 STOP & DECIDE

**If all 3 tests PASSED:** ✅ Continue to LoyaltyMember  
**If any test FAILED:** 🛑 Rollback ShopifyOrder RLS and troubleshoot

**Rollback Steps (if needed):**
1. Dashboard → Entities → ShopifyOrder → Security
2. Delete or disable the RLS rule you just added
3. Re-test workflow
4. Check `docs/RLS_TROUBLESHOOTING.md` for solutions

---

## 📋 Entity 2: LoyaltyMember — APPLY NOW

### Step 1: Open Entity Security
- [ ] Navigate to: Dashboard → Data → Entities → **LoyaltyMember** → Security tab

### Step 2: Add Read Rule
**Click "Add Rule" → Fill in:**

| Field | Value |
|-------|-------|
| **Operation** | Read |
| **Role** | customer |
| **Filter** | `{"email": "{{user.email}}"}` |

- [ ] Rule added and saved

### Step 3: Block Customer Mutations
**Add rules for Create/Update/Delete with EMPTY filters (blocks all customer mutations):**

| Operation | Role | Filter |
|-----------|------|--------|
| Create | customer | `{}` (empty) |
| Update | customer | `{}` (empty) |
| Delete | customer | `{}` (empty) |

- [ ] All three mutation rules added

### Step 4: Immediate Validation Tests

**Test 1: Loyalty Profile Isolation**
```bash
1. Login as Customer A
2. View loyalty profile
3. Verify: Only Customer A's profile visible
4. Try to access Customer B's profile → should be blocked
```
- [ ] PASSED: Customer sees only own profile

**Test 2: Backend Function Access**
```bash
# Run function: awardOrderPoints (simulated or trigger paid order)
1. Create a test paid order
2. Wait for automation OR run awardOrderPoints manually
3. Check if points were created
4. Verify: Points created successfully (backend bypasses RLS)
```
- [ ] PASSED: Backend automation still works

### 🛑 STOP & DECIDE

**If both tests PASSED:** ✅ Continue to UserPoints  
**If any test FAILED:** 🛑 Rollback LoyaltyMember RLS

---

## 📋 Entity 3: UserPoints — APPLY NOW

### Step 1: Open Entity Security
- [ ] Navigate to: Dashboard → Data → Entities → **UserPoints** → Security tab

### Step 2: Add Read Rule
**Click "Add Rule" → Fill in:**

| Field | Value |
|-------|-------|
| **Operation** | Read |
| **Role** | customer |
| **Filter** | `{"customer_email": "{{user.email}}"}` |

- [ ] Rule added and saved

### Step 3: Block Customer Mutations
**Add rules for Create/Update/Delete with EMPTY filters:**

| Operation | Role | Filter |
|-----------|------|--------|
| Create | customer | `{}` (empty) |
| Update | customer | `{}` (empty) |
| Delete | customer | `{}` (empty) |

- [ ] All three mutation rules added

### Step 4: Immediate Validation Tests

**Test 1: Points Visibility**
```bash
1. Login as Customer A
2. View points/loyalty page
3. Verify: Only Customer A's points visible
4. Check points balance matches expected
```
- [ ] PASSED: Customer sees only own points

**Test 2: Points Award Automation**
```bash
# Trigger paid order or run awardOrderPoints
1. Create test paid order
2. Wait for automation OR run awardOrderPoints manually
3. Check UserPoints entity for new record
4. Verify: Points created with correct customer_email
```
- [ ] PASSED: Points awarded correctly

**Test 3: Customer Cannot Modify Points**
```bash
1. Login as Customer A
2. Try to update own points (via API or UI if available)
3. Verify: Update blocked by RLS
```
- [ ] PASSED: Customer cannot modify points

### 🛑 STOP & DECIDE

**If all 3 tests PASSED:** ✅ Continue to NuViraCredit  
**If any test FAILED:** 🛑 Rollback UserPoints RLS

---

## 📋 Entity 4: NuViraCredit — APPLY NOW

### Step 1: Open Entity Security
- [ ] Navigate to: Dashboard → Data → Entities → **NuViraCredit** → Security tab

### Step 2: Add Read Rule
**Click "Add Rule" → Fill in:**

| Field | Value |
|-------|-------|
| **Operation** | Read |
| **Role** | customer |
| **Filter** | `{"customer_email": "{{user.email}}"}` |

- [ ] Rule added and saved

### Step 3: Block Customer Mutations
**Add rules for Create/Update/Delete with EMPTY filters:**

| Operation | Role | Filter |
|-----------|------|--------|
| Create | customer | `{}` (empty) |
| Update | customer | `{}` (empty) |
| Delete | customer | `{}` (empty) |

- [ ] All three mutation rules added

### Step 4: Immediate Validation Tests

**Test 1: Credit Visibility**
```bash
1. Login as Customer A
2. View credits page (if exists in customer app)
3. Verify: Only Customer A's credits visible
```
- [ ] PASSED: Customer sees only own credits

**Test 2: Bag Return Credit Issuance**
```bash
# Run function: syncBagReturnToCustomerApp (with test data)
1. Dashboard → Code → Functions → syncBagReturnToCustomerApp
2. Run with test bag return data
3. Check NuViraCredit entity for new record
4. Verify: Credit created successfully (backend bypasses RLS)
```
- [ ] PASSED: Backend credit issuance works

### 🛑 STOP & DECIDE

**If both tests PASSED:** ✅ Continue to FulfillmentTask  
**If any test FAILED:** 🛑 Rollback NuViraCredit RLS

---

## 📋 Entity 5: FulfillmentTask — APPLY NOW

### Step 1: Open Entity Security
- [ ] Navigate to: Dashboard → Data → Entities → **FulfillmentTask** → Security tab

### Step 2: Add Driver Read Rule
**Click "Add Rule" → Fill in:**

| Field | Value |
|-------|-------|
| **Operation** | Read |
| **Role** | driver |
| **Filter** | See below |

**Filter JSON (copy-paste):**
```json
{
  "$or": [
    { "assigned_driver": "{{user.email}}" },
    { "assigned_driver": "{{user.full_name}}" }
  ]
}
```

- [ ] Driver read rule added

### Step 3: Add Driver Update Rule
**Click "Add Rule" → Fill in:**

| Field | Value |
|-------|-------|
| **Operation** | Update |
| **Role** | driver |
| **Filter** | Same as read rule (above) |

- [ ] Driver update rule added

### Step 4: Add Operations Staff Rules
**Add rules for operations_staff and production_manager with NO filters (full access):**

| Operation | Role | Filter |
|-----------|------|--------|
| Read | operations_staff | (no filter / empty) |
| Update | operations_staff | (no filter / empty) |
| Read | production_manager | (no filter / empty) |
| Update | production_manager | (no filter / empty) |

- [ ] All operations staff rules added

### Step 5: Block Customer Access
**Add rule to block customer access entirely:**

| Operation | Role | Filter |
|-----------|------|--------|
| Read | customer | `{}` (empty — blocks all) |

- [ ] Customer access blocked

### Step 6: Immediate Validation Tests

**Test 1: Driver Isolation**
```bash
1. Login as Driver (with assigned tasks)
2. Go to Driver Portal / Fulfillment page
3. Count visible tasks: _____
4. Verify: Only tasks assigned to this driver visible
5. Try to view unassigned tasks → should be blocked
```
- [ ] PASSED: Driver sees only assigned tasks

**Test 2: Driver Update Access**
```bash
1. Login as Driver
2. Try to update an assigned task (mark as delivered)
3. Verify: Update succeeds
4. Try to update another driver's task → should be blocked
```
- [ ] PASSED: Driver can update only assigned tasks

**Test 3: Operations Staff Full Access**
```bash
1. Login as Admin or Operations Staff
2. Go to Fulfillment page
3. Verify: All tasks visible (not filtered)
4. Try to update any task → should succeed
```
- [ ] PASSED: Operations staff has full access

**Test 4: recordDriverDelivery Function**
```bash
# Run function: recordDriverDelivery (with test task)
1. Dashboard → Code → Functions → recordDriverDelivery
2. Run with test task_id assigned to driver
3. Verify: Function completes successfully
4. Check task status updated to "Completed"
```
- [ ] PASSED: Driver delivery recording works

### 🛑 STOP & DECIDE

**If all 4 tests PASSED:** ✅ Phase 1 RLS implementation complete!  
**If any test FAILED:** 🛑 Rollback FulfillmentTask RLS

---

## ✅ Phase 1 Completion Checklist

**All 5 entities configured:**
- [ ] ShopifyOrder — RLS rules applied & validated
- [ ] LoyaltyMember — RLS rules applied & validated
- [ ] UserPoints — RLS rules applied & validated
- [ ] NuViraCredit — RLS rules applied & validated
- [ ] FulfillmentTask — RLS rules applied & validated

**Cross-user isolation verified:**
- [ ] Customer A cannot see Customer B's orders
- [ ] Customer A cannot see Customer B's loyalty profile
- [ ] Customer A cannot see Customer B's points
- [ ] Customer A cannot see Customer B's credits
- [ ] Driver A cannot see Driver B's assigned tasks

**Admin continuity verified:**
- [ ] Admin can see all orders
- [ ] Admin can see all loyalty members
- [ ] Admin can see all points/credits
- [ ] Admin can see all fulfillment tasks
- [ ] Admin can access all workflows

**Automation continuity verified:**
- [ ] awardOrderPoints still creates points on paid orders
- [ ] recalculateProductionBatches still reads all orders
- [ ] syncBagReturnToCustomerApp still issues credits
- [ ] recordDriverDelivery still updates tasks
- [ ] All other automations functioning

**Customer workflows verified:**
- [ ] Customer app checkout works
- [ ] Customer can view own order history
- [ ] Customer can view own loyalty profile
- [ ] Customer can view own points/credits

**Driver workflows verified:**
- [ ] Driver portal loads
- [ ] Driver sees assigned deliveries
- [ ] Driver can update delivery status
- [ ] Driver can record delivery proof

---

## 🎉 Phase 1 Sign-Off

**Implementation Date:** _______________  
**Implementation Time:** _____ hours  
**Implementer:** _______________  

**Final Status:**
- [ ] ✅ All 5 entities configured
- [ ] ✅ All validation tests passed
- [ ] ✅ No critical workflows broken
- [ ] ✅ Cross-user isolation confirmed
- [ ] ✅ Admin/automation continuity verified

**Sign-off:** _______________ (Security Lead / Operations Manager)

---

## 📊 Post-Implementation Monitoring

**Monitor for 48 hours after RLS deployment:**

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Customer support tickets (data access) | 0 | _____ | _____ |
| Automation failures | 0 | _____ | _____ |
| Driver portal errors | 0 | _____ | _____ |
| Checkout failures | 0 | _____ | _____ |
| RLS permission errors in logs | 0 | _____ | _____ |

**Daily Check (for first week):**
- [ ] Day 1: No critical errors
- [ ] Day 2: No critical errors
- [ ] Day 3: No critical errors
- [ ] Day 7: No critical errors

---

## 🚨 Emergency Rollback (If Critical Issues Discovered)

**Immediate Rollback Procedure:**

1. **Dashboard → Entities → [Entity Name] → Security**
2. **Toggle OFF** or **DELETE** the problematic RLS rule
3. **Save changes**
4. **Test broken workflow immediately**
5. **Document issue** in troubleshooting log

**Rollback Decision Tree:**
- Customer cannot see own orders → Rollback ShopifyOrder RLS
- Points not awarded → Rollback UserPoints RLS
- Driver cannot see deliveries → Rollback FulfillmentTask RLS
- Automation fails → Check function uses `base44.asServiceRole`

---

**Next Phase:** After 48-hour monitoring period with no critical issues, proceed to Phase 2 (Operational Security entities)