# Phase 1 RLS Implementation Guide — Base44 Dashboard

**Date:** 2026-05-14  
**Status:** Ready for implementation  
**Priority:** Critical security infrastructure

---

## ⚠️ IMPORTANT: How to Apply RLS in Base44

RLS policies are configured in the **Base44 Dashboard**, not in code files:

1. Go to **Dashboard → Data → Entities**
2. Click on the entity name (e.g., "ShopifyOrder")
3. Navigate to **"Security"** or **"Row Level Security"** tab
4. Add RLS rules per operation (Create, Read, Update, Delete)
5. Save and test immediately

**Apply entities in this order:**
1. ShopifyOrder ✅ (this guide)
2. LoyaltyMember ✅ (this guide)
3. UserPoints ✅ (this guide)
4. NuViraCredit ✅ (this guide)
5. FulfillmentTask ✅ (this guide)

---

## Entity 1: ShopifyOrder

### RLS Rules to Add

#### **Read Operation**
```json
{
  "role": "customer",
  "filter": {
    "$or": [
      { "customer_email": "{{user.email}}" },
      { "user_email": "{{user.email}}" }
    ]
  }
}
```

#### **Create Operation**
```json
{
  "role": "customer",
  "filter": {
    "customer_email": "{{user.email}}"
  }
}
```

#### **Update Operation**
```json
{
  "role": "customer",
  "filter": {
    "$and": [
      { "customer_email": "{{user.email}}" },
      { "order_lock_status": "unlocked" }
    ]
  }
}
```

#### **Delete Operation**
```json
{
  "role": "customer",
  "filter": {}  // Customers cannot delete orders
}
```

### Admin/Service Role Override
Base44 automatically allows:
- ✅ Admin users (role = 'admin') — full access
- ✅ Service role (automations, webhooks) — full access via `base44.asServiceRole`

### Validation Test
After applying:
1. Log in as Customer A → should see only their orders
2. Log in as Customer B → should see only their orders
3. Log in as Admin → should see all orders
4. Run `recalculateProductionBatches` → should still work (uses service role)

---

## Entity 2: LoyaltyMember

### RLS Rules to Add

#### **Read Operation**
```json
{
  "role": "customer",
  "filter": {
    "email": "{{user.email}}"
  }
}
```

#### **Create Operation**
```json
{
  "role": "customer",
  "filter": {}  // Customers cannot create loyalty profiles (backend only)
}
```

#### **Update Operation**
```json
{
  "role": "customer",
  "filter": {}  // Customers cannot update loyalty profiles (backend only)
}
```

#### **Delete Operation**
```json
{
  "role": "customer",
  "filter": {}  // Customers cannot delete
}
```

### Backend Functions That Need Access
These functions use `base44.asServiceRole` and will continue working:
- ✅ `awardOrderPoints` — creates point records
- ✅ `loyaltySync` — syncs loyalty data
- ✅ `executeLoyaltyPhase1HubSide` — migration
- ✅ `executeLoyaltyPhase2CustomerAppSync` — sync

### Validation Test
After applying:
1. Customer A logs in → can see their own loyalty profile
2. Customer A tries to access Customer B's profile → blocked
3. `awardOrderPoints` automation → still triggers on paid orders

---

## Entity 3: UserPoints

### RLS Rules to Add

#### **Read Operation**
```json
{
  "role": "customer",
  "filter": {
    "customer_email": "{{user.email}}"
  }
}
```

#### **Create Operation**
```json
{
  "role": "customer",
  "filter": {}  // Customers cannot create point records (backend only)
}
```

#### **Update Operation**
```json
{
  "role": "customer",
  "filter": {}  // Customers cannot modify points (backend only)
}
```

#### **Delete Operation**
```json
{
  "role": "customer",
  "filter": {}  // Customers cannot delete
}
```

### Backend Functions That Need Access
- ✅ `awardOrderPoints` — creates point records on paid orders
- ✅ `redeemReward` — creates redemption records
- ✅ `createLoyaltySignupBonus` — creates bonus points
- ✅ `loyaltySync` — syncs points to customer app

### Validation Test
After applying:
1. Customer views their points → works
2. Customer tries to view another customer's points → blocked
3. Customer tries to modify their own points → blocked (correct — backend only)
4. `awardOrderPoints` on paid order → still creates points successfully

---

## Entity 4: NuViraCredit

### RLS Rules to Add

#### **Read Operation**
```json
{
  "role": "customer",
  "filter": {
    "customer_email": "{{user.email}}"
  }
}
```

#### **Create/Update/Delete Operations**
```json
{
  "role": "customer",
  "filter": {}  // Customers cannot mutate credits (backend only)
}
```

### Backend Functions That Need Access
- ✅ `syncBagReturnToCustomerApp` — issues credits for bag returns
- ✅ Any credit adjustment functions — admin/backend only

### Validation Test
After applying:
1. Customer views their credits → works
2. Customer cannot see other customers' credits → blocked
3. Bag return credit issuance → still works (uses backend function)

---

## Entity 5: FulfillmentTask

### RLS Rules to Add

#### **Read Operation**
```json
{
  "role": "driver",
  "filter": {
    "$or": [
      { "assigned_driver": "{{user.email}}" },
      { "assigned_driver": "{{user.full_name}}" }
    ]
  }
}
```

#### **Update Operation**
```json
{
  "role": "driver",
  "filter": {
    "$or": [
      { "assigned_driver": "{{user.email}}" },
      { "assigned_driver": "{{user.full_name}}" }
    ]
  }
}
```

#### **Read/Update for Operations Staff**
```json
{
  "role": "operations_staff",
  "filter": {}  // Full access
}
```

```json
{
  "role": "production_manager",
  "filter": {}  // Full access
}
```

#### **Customer Access**
```json
{
  "role": "customer",
  "filter": {}  // Customers should NOT have direct access to fulfillment tasks
}
```

### Backend Functions That Need Access
- ✅ `recordDriverDelivery` — updates assigned tasks (already validates driver assignment in function)
- ✅ `createFulfillmentTasks` — creates tasks (admin/operations only)
- ✅ `updateDriverDeliveryTask` — updates tasks (admin/operations only)
- ✅ `syncFulfillmentTasksFromOrders` — syncs tasks (service role)

### Validation Test
After applying:
1. Driver logs in → sees only their assigned deliveries
2. Driver tries to view unassigned deliveries → blocked
3. Driver updates their assigned delivery → works
4. Driver tries to update another driver's delivery → blocked by RLS + function guard
5. Operations staff → can see and manage all deliveries

---

## Service Role & Automation Continuity

All automations and webhooks must use **`base44.asServiceRole`** to bypass RLS:

### ✅ Already Using Service Role (Will Continue Working)
- `recalculateProductionBatches` — reads all orders, creates batches
- `checkDailyCompliance` — reads compliance logs
- `awardOrderPoints` — creates point records
- `stripeChargeRefundedWebhook` — updates orders
- `createFulfillmentTasks` — creates fulfillment tasks
- `syncFulfillmentTasksFromOrders` — syncs tasks

### ⚠️ Functions to Verify (May Need Service Role)
Check these functions and update if they read entities without service role:
- `getProductionPlanningData` — should use service role
- `getIngredientDemandByDate` — should use service role
- `getDriverRouteForDate` — should use service role

---

## Step-by-Step Implementation Plan

### Day 1: ShopifyOrder + LoyaltyMember
1. Apply ShopifyOrder RLS rules
2. Test: Customer A vs Customer B isolation
3. Test: Admin full access
4. Test: Production planning still works
5. Apply LoyaltyMember RLS rules
6. Test: Loyalty profile isolation
7. Test: `awardOrderPoints` automation still triggers

### Day 2: UserPoints + NuViraCredit
1. Apply UserPoints RLS rules
2. Test: Customer point visibility
3. Test: Point creation on paid orders
4. Apply NuViraCredit RLS rules
5. Test: Credit visibility
6. Test: Bag return credit issuance

### Day 3: FulfillmentTask
1. Apply FulfillmentTask RLS rules
2. Test: Driver isolation (assigned tasks only)
3. Test: Operations staff full access
4. Test: `recordDriverDelivery` function
5. Test: Driver portal workflow

### Day 4: Full Regression Testing
1. Customer app checkout flow
2. Loyalty signup and points earning
3. Bag return credit flow
4. Production planning workflow
5. Driver delivery workflow
6. Admin reporting workflow

---

## Rollback Plan

If RLS breaks critical workflows:

1. **Immediate Rollback:**
   - Go to Dashboard → Entities → [Entity Name] → Security
   - Disable or delete the RLS rule
   - Test workflow immediately

2. **Debug Approach:**
   - Check function logs for RLS-related errors
   - Verify function uses `base44.asServiceRole` for cross-entity reads
   - Check if customer email matching is correct (case sensitivity)

3. **Fallback:**
   - Keep RLS disabled for that entity
   - Re-apply after fixing the breaking function
   - Test in staging environment first if available

---

## Monitoring & Alerts

After RLS implementation, monitor:

- **Failed entity operations** — sudden increase may indicate RLS blocking legitimate access
- **Customer support tickets** — "can't see my orders" or "points not showing"
- **Automation failures** — check logs for RLS-related errors
- **Driver portal issues** — drivers unable to see assigned routes

Set up alerts in Base44 dashboard for:
- Entity read/write permission errors
- Automation execution failures
- Webhook processing errors

---

## Next Steps After Phase 1

Once Phase 1 is validated:

**Phase 2: Operational Security**
- ProductionBatch
- ManualProductionBatch
- ComplianceLog
- TemperatureLog
- InventoryItem

**Phase 3: Financial/Admin Isolation**
- PurchaseOrder
- Supplier
- StripeEventLog
- OrderReviewQueue

---

**Implementation Status:** Ready to begin — start with ShopifyOrder RLS rules