# RLS Phase 1 — Quick Reference Checklist

**Print this and check off each item as you complete it.**

---

## ✅ Pre-Implementation Checklist

- [ ] Read `docs/RLS_PHASE1_IMPLEMENTATION_GUIDE.md`
- [ ] Backup current entity configurations (screenshot RLS settings)
- [ ] Notify team of RLS implementation window
- [ ] Prepare test accounts: Customer A, Customer B, Driver, Admin
- [ ] Schedule regression testing window

---

## 📋 Entity 1: ShopifyOrder — RLS Rules

**Dashboard → Entities → ShopifyOrder → Security**

### Read Rule
- [ ] Role: `customer`
- [ ] Filter: `customer_email` equals `{{user.email}}` OR `user_email` equals `{{user.email}}`

### Create Rule
- [ ] Role: `customer`
- [ ] Filter: `customer_email` equals `{{user.email}}`

### Update Rule
- [ ] Role: `customer`
- [ ] Filter: `customer_email` equals `{{user.email}}` AND `order_lock_status` equals `unlocked`

### Delete Rule
- [ ] Role: `customer`
- [ ] Filter: (empty — customers cannot delete)

### Validation
- [ ] Customer A sees only their orders
- [ ] Customer B sees only their orders
- [ ] Admin sees all orders
- [ ] Production planning still works

---

## 📋 Entity 2: LoyaltyMember — RLS Rules

**Dashboard → Entities → LoyaltyMember → Security**

### Read Rule
- [ ] Role: `customer`
- [ ] Filter: `email` equals `{{user.email}}`

### Create/Update/Delete Rules
- [ ] Role: `customer`
- [ ] Filter: (empty — backend only)

### Validation
- [ ] Customer sees own loyalty profile
- [ ] Customer cannot see other profiles
- [ ] `awardOrderPoints` automation still works

---

## 📋 Entity 3: UserPoints — RLS Rules

**Dashboard → Entities → UserPoints → Security**

### Read Rule
- [ ] Role: `customer`
- [ ] Filter: `customer_email` equals `{{user.email}}`

### Create/Update/Delete Rules
- [ ] Role: `customer`
- [ ] Filter: (empty — backend only)

### Validation
- [ ] Customer sees own points
- [ ] Customer cannot modify points
- [ ] Points awarded on paid orders (automation test)

---

## 📋 Entity 4: NuViraCredit — RLS Rules

**Dashboard → Entities → NuViraCredit → Security**

### Read Rule
- [ ] Role: `customer`
- [ ] Filter: `customer_email` equals `{{user.email}}`

### Create/Update/Delete Rules
- [ ] Role: `customer`
- [ ] Filter: (empty — backend only)

### Validation
- [ ] Customer sees own credits
- [ ] Bag return credit issuance works

---

## 📋 Entity 5: FulfillmentTask — RLS Rules

**Dashboard → Entities → FulfillmentTask → Security**

### Read Rule (Driver)
- [ ] Role: `driver`
- [ ] Filter: `assigned_driver` equals `{{user.email}}` OR `assigned_driver` equals `{{user.full_name}}`

### Update Rule (Driver)
- [ ] Role: `driver`
- [ ] Filter: Same as read rule

### Read/Update Rules (Operations)
- [ ] Role: `operations_staff` — no filter (full access)
- [ ] Role: `production_manager` — no filter (full access)

### Customer Access
- [ ] Role: `customer` — no filter (no access)

### Validation
- [ ] Driver sees only assigned tasks
- [ ] Driver can update assigned tasks
- [ ] Operations staff sees all tasks
- [ ] Customer cannot access tasks

---

## 🔍 Multi-User Validation Tests

**Test 1: Customer Isolation**
- [ ] Login as Customer A
- [ ] View orders → should see only Customer A's orders
- [ ] View loyalty profile → should see only Customer A's profile
- [ ] View points → should see only Customer A's points
- [ ] Logout

- [ ] Login as Customer B
- [ ] View orders → should see only Customer B's orders
- [ ] View loyalty profile → should see only Customer B's profile
- [ ] View points → should see only Customer B's points
- [ ] Logout

**Test 2: Admin Full Access**
- [ ] Login as Admin
- [ ] View all orders → should see all orders
- [ ] View all loyalty members → should see all members
- [ ] View all points → should see all point records
- [ ] View all credits → should see all credits
- [ ] View all fulfillment tasks → should see all tasks

**Test 3: Driver Isolation**
- [ ] Login as Driver (assigned to tasks)
- [ ] View fulfillment tasks → should see only assigned tasks
- [ ] Try to view unassigned tasks → should be blocked
- [ ] Update assigned task → should work
- [ ] Try to update another driver's task → should be blocked

**Test 4: Backend Automation Continuity**
- [ ] Trigger paid order → verify `awardOrderPoints` creates points
- [ ] Run production planning → verify `recalculateProductionBatches` works
- [ ] Process bag return → verify credit issuance works
- [ ] Create fulfillment tasks → verify tasks created successfully

---

## ⚠️ Rollback Triggers

**Stop immediately and rollback if:**

- [ ] Customer cannot see their own orders
- [ ] Points not awarded on paid orders
- [ ] Production planning fails
- [ ] Driver cannot see assigned deliveries
- [ ] Bag return credit issuance fails
- [ ] Admin reporting breaks

**Rollback Steps:**
1. Dashboard → Entities → [Entity Name] → Security
2. Disable or delete the RLS rule
3. Test broken workflow
4. Fix issue and re-apply

---

## 📊 Success Criteria

Phase 1 is complete when:

- [ ] ✅ All 5 entities have RLS rules applied
- [ ] ✅ Customer A cannot see Customer B's data
- [ ] ✅ Driver sees only assigned tasks
- [ ] ✅ Admin retains full access
- [ ] ✅ All automations still function
- [ ] ✅ Customer app checkout works
- [ ] ✅ Loyalty points awarded correctly
- [ ] ✅ Bag return credits issued correctly
- [ ] ✅ Production planning works
- [ ] ✅ Driver portal works

---

## 📝 Issues Log

| Date | Issue | Entity | Resolution | Status |
|------|-------|--------|------------|--------|
|      |       |        |            |        |
|      |       |        |            |        |
|      |       |        |            |        |

---

**Implementation Date:** _______________  
**Implemented By:** _______________  
**Validation Completed:** _______________  
**Sign-off:** _______________