# RLS Troubleshooting Guide — Phase 1

**Common issues and solutions when applying RLS policies.**

---

## Issue 1: Customer Cannot See Their Own Orders

### Symptoms
- Customer logs in
- Orders page shows "No orders found"
- Admin can see the customer's orders

### Likely Causes
1. **Email mismatch** — `customer_email` field doesn't match authenticated user email
2. **RLS filter syntax error** — incorrect variable name or operator
3. **Case sensitivity** — email stored with different casing

### Debug Steps
```javascript
// Run as admin to check customer email values
const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({
  customer_email: 'customer@example.com'
});
console.log('Found orders:', orders.length);
console.log('Email values:', orders.map(o => o.customer_email));
```

### Solution
- Verify `customer_email` field matches user's email exactly
- Use case-insensitive matching if needed:
  ```json
  {
    "role": "customer",
    "filter": {
      "customer_email": "{{user.email}}"
    }
  }
  ```
- Check if user email is `Customer@Example.com` but order has `customer@example.com`

---

## Issue 2: Automation Fails After RLS (awardOrderPoints)

### Symptoms
- Paid order created
- No points awarded
- Automation logs show error or no execution

### Likely Causes
1. **Automation not using service role** — `base44.entities` instead of `base44.asServiceRole.entities`
2. **RLS blocking read access** — automation can't read orders to process

### Debug Steps
Check function code:
```javascript
// ❌ WRONG — will be blocked by RLS
const orders = await base44.entities.ShopifyOrder.filter({ payment_status: 'paid' });

// ✅ CORRECT — bypasses RLS
const orders = await base44.asServiceRole.entities.ShopifyOrder.filter({ payment_status: 'paid' });
```

### Solution
- Update function to use `base44.asServiceRole.entities`
- Redeploy function
- Re-run automation manually to test

---

## Issue 3: Driver Cannot See Assigned Deliveries

### Symptoms
- Driver logs into Driver Portal
- No deliveries shown
- Admin can see deliveries assigned to that driver

### Likely Causes
1. **assigned_driver field mismatch** — field contains name instead of email (or vice versa)
2. **RLS filter uses wrong field** — checking `assigned_driver` but field is empty or uses different format
3. **Driver role not configured** — user doesn't have `driver` role

### Debug Steps
```javascript
// Check what's in assigned_driver field
const tasks = await base44.asServiceRole.entities.FulfillmentTask.filter({
  assigned_driver: { $exists: true }
});
console.log('Assigned driver values:', tasks.map(t => t.assigned_driver));
```

### Solution
- Update RLS filter to match actual field format:
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
- Verify driver has correct role assignment
- Check if `assigned_driver` field is populated

---

## Issue 4: Production Planning Breaks After RLS

### Symptoms
- `recalculateProductionBatches` fails or returns incomplete data
- Production batches not created
- Orders missing from production schedule

### Likely Causes
1. **Function reads without service role** — using `base44.entities` instead of `base44.asServiceRole.entities`
2. **Cross-entity reads blocked** — function reads multiple entities, some blocked by RLS

### Debug Steps
Check function code for all entity reads:
```javascript
// Check each entity read
const orders = await base44.asServiceRole.entities.ShopifyOrder.list(); // ✅
const tasks = await base44.asServiceRole.entities.FulfillmentTask.list(); // ✅
const batches = await base44.entities.ProductionBatch.list(); // ❌ — missing asServiceRole
```

### Solution
- Update ALL entity reads in function to use `base44.asServiceRole.entities`
- Verify function is called with admin user or internal secret
- Re-run function and check logs

---

## Issue 5: Customer App Checkout Fails

### Symptoms
- Customer completes checkout
- Order not created in Hub
- Error: "Permission denied" or "Cannot create order"

### Likely Causes
1. **Create RLS rule too restrictive** — customer cannot create orders
2. **Missing required fields** — RLS filter requires fields not provided by customer app
3. **Email not set during creation** — `customer_email` field not populated before RLS check

### Debug Steps
Check Create RLS rule:
```json
// ❌ TOO RESTRICTIVE — blocks creation
{
  "role": "customer",
  "filter": {
    "customer_email": "{{user.email}}",
    "payment_status": "paid"  // ← This field might not be set yet
  }
}

// ✅ CORRECT — allows creation with email match
{
  "role": "customer",
  "filter": {
    "customer_email": "{{user.email}}"
  }
}
```

### Solution
- Simplify Create RLS rule to only check `customer_email`
- Ensure customer app sends `customer_email` in payload
- Verify email is set before RLS filter is evaluated

---

## Issue 6: Bag Return Credit Not Issued

### Symptoms
- Bag return processed
- Credit not created in NuViraCredit entity
- Function returns success but no credit record

### Likely Causes
1. **Function not using service role** — `base44.entities.NuViraCredit.create()` blocked by RLS
2. **Customer email mismatch** — credit created with different email than authenticated user
3. **RLS blocking read after write** — function creates credit but can't read it back to confirm

### Debug Steps
Check function code:
```javascript
// ❌ WRONG — will be blocked by customer RLS
await base44.entities.NuViraCredit.create({ customer_email: '...' });

// ✅ CORRECT — bypasses RLS
await base44.asServiceRole.entities.NuViraCredit.create({ customer_email: '...' });
```

### Solution
- Update function to use `base44.asServiceRole.entities.NuViraCredit`
- Verify `customer_email` matches user email
- Check function logs for RLS-related errors

---

## Issue 7: Admin Reporting Shows Incomplete Data

### Symptoms
- Weekly report generated
- Missing orders or loyalty data
- Numbers don't match dashboard

### Likely Causes
1. **Report function not using service role** — reading with admin role but RLS still applies
2. **RLS applied to admin role** — admin should bypass RLS but rule is misconfigured

### Debug Steps
Check function code:
```javascript
// ❌ WRONG — RLS may filter results even for admin
const orders = await base44.entities.ShopifyOrder.list();

// ✅ CORRECT — bypasses RLS completely
const orders = await base44.asServiceRole.entities.ShopifyOrder.list();
```

### Solution
- Update ALL report/reporting functions to use `base44.asServiceRole.entities`
- Verify admin role has full access in RLS configuration
- Re-run report and compare results

---

## Issue 8: Loyalty Points Not Syncing to Customer App

### Symptoms
- Points awarded in Hub
- Customer app shows old/stale points
- Sync function returns error or no data

### Likely Causes
1. **Sync function can't read points** — RLS blocking read of UserPoints
2. **Email mismatch** — sync function uses different email than points record
3. **Service role not used** — sync function uses regular entity read

### Debug Steps
Check sync function:
```javascript
// Check what email is being used
const user = await base44.auth.me();
console.log('User email:', user.email);

const points = await base44.asServiceRole.entities.UserPoints.filter({
  customer_email: user.email
});
console.log('Found points:', points.length);
```

### Solution
- Update sync function to use `base44.asServiceRole.entities.UserPoints`
- Verify email matching logic
- Check sync logs for RLS errors

---

## General Debugging Commands

### Check Current RLS Configuration
```javascript
// Run as admin to see entity data (bypasses RLS)
const orders = await base44.asServiceRole.entities.ShopifyOrder.list();
console.log('All orders:', orders.length);
console.log('Sample emails:', orders.slice(0, 5).map(o => o.customer_email));
```

### Test RLS Filter Logic
```javascript
// Simulate RLS filter as customer
const user = await base44.auth.me();
const customerOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({
  customer_email: user.email
});
console.log('Orders for this customer:', customerOrders.length);
```

### Check Function Service Role Usage
```bash
# Search function code for service role usage
grep -n "asServiceRole" functions/*.js
```

---

## Rollback Procedure

**If RLS causes critical failures:**

1. **Immediate Rollback (Dashboard)**
   - Dashboard → Entities → [Entity Name] → Security
   - Toggle RLS rule OFF or delete it
   - Save changes
   - Test broken workflow immediately

2. **Partial Rollback (Relax Rules)**
   - Keep RLS enabled but simplify filter
   - Example: Remove complex conditions, keep only email match
   - Test and iterate

3. **Function Fix (Service Role)**
   - Update function to use `base44.asServiceRole.entities`
   - Redeploy function
   - Re-apply RLS rules
   - Test again

---

## When to Escalate

**Contact Base44 support if:**
- RLS rules won't save or apply
- Service role bypass stops working
- Automations fail with unclear RLS errors
- Multiple entities break simultaneously after RLS

**Provide:**
- RLS rule configurations (screenshots)
- Function code snippets
- Error logs from failed operations
- Entity names affected

---

## Prevention Best Practices

1. **Always use service role in backend functions:**
   ```javascript
   await base44.asServiceRole.entities.EntityName.operation()
   ```

2. **Test RLS in isolation before production:**
   - Apply to one entity at a time
   - Test immediately after each application
   - Have rollback plan ready

3. **Document all RLS rules:**
   - Keep copy of each rule before applying
   - Note which functions need service role updates
   - Track which automations are affected

4. **Monitor after deployment:**
   - Watch for permission errors in logs
   - Check automation success rates
   - Monitor customer support tickets

---

**Last Updated:** 2026-05-14  
**Version:** 1.0 (Phase 1)