# BLOCKING ORDERS RESOLUTION REPORT
**Date**: 2026-05-02  
**Status**: Field-level recovery plan with before/after proof

---

## BLOCKING ORDER 1: NV-MONL4I2M

### Order Details
- **order_number**: NV-MONL4I2M
- **customer**: Amar Kahlon
- **email**: amar.kahlon23@yahoo.com
- **phone**: 6366976028
- **Hub Order ID**: 69f5439553a775a4ef2fa3ac

### Issue
Missing delivery address at all levels. Order in Hub but incomplete. Payment captured, but address never synced from Customer App.

### Missing Fields
```
- address_line1: "" (BLANK)
- address_line2: "" (blank, acceptable)
- address_city: "" (BLANK)
- address_state: "" (BLANK)
- address_postal_code: "" (BLANK)
- fulfillment.address_line1: "" (BLANK)
- fulfillment.address_city: "" (BLANK)
- fulfillment.address_state: "" (BLANK)
- fulfillment.address_postal_code: "" (BLANK)
- fulfillment.items[].price: [0, 0, 0] (all $0, auto-calculated from parent)
```

### Data Available

#### Source of Truth Available
- ✅ **Customer App**: Has order in checkout state
- ❌ **Stripe**: No payment intent saved with address (stripe_payment_intent_id: pi_3TSR8BIrzYHaHkt229kPQQpN exists but no metadata)
- ⚠️ **Hub**: Order exists but incomplete

#### Customer App Data Available
- ✅ Customer name: "Amar Kahlon"
- ✅ Email: "amar.kahlon23@yahoo.com"
- ✅ Phone: "6366976028"
- ✅ Line items: The NuVira Trio (qty 1, $36)
- ❌ Address: NOT CAPTURED during checkout

#### Stripe Data Available
- ✅ stripe_payment_intent_id: pi_3TSR8BIrzYHaHkt229kPQQpN
- ✅ stripe_checkout_session_id: cs_live_b1cn4TB2HrbIvLOyEVmNXJO9oV459PETVawgyifGbIazTwy7QYHr7nQw
- ✅ Payment status: pending (NOT yet captured)
- ❌ Stripe shipping address: NOT PRESENT (address not captured before checkout)

#### Hub Data Available
- ✅ Order record exists
- ✅ line_items present (The NuVira Trio)
- ✅ Financial data (subtotal: $36, total: $43.99)
- ✅ payment_status: pending
- ❌ address_line1-postal_code: ALL BLANK
- ✅ order_lock_status: unlocked (can be edited)
- ❌ data_quality_status: marked "complete" but isn't

### Recovery Function to Use

**Function**: `fixMissingAddress`

**Options**:
1. **Manual Address Entry** (fastest) — Admin enters address in Hub
2. **Customer Re-checkout** — Send customer link to re-enter address + payment
3. **Wait for CA Sync** — May never happen

### Admin/Manual Approval Required
**YES** — Address must come from somewhere:
- Option A: Admin uses Hub Orders UI or fixMissingAddress function with manual_address param
- Option B: Admin contacts customer for re-checkout (email: amar.kahlon23@yahoo.com, phone: 636-697-6028)
- Option C: Abandon order (not recommended)

### BEFORE STATE

```json
{
  "hub_order_id": "69f5439553a775a4ef2fa3ac",
  "order_number": "NV-MONL4I2M",
  "customer_name": "Amar Kahlon",
  "customer_email": "amar.kahlon23@yahoo.com",
  "production_status": "new",
  "payment_status": "pending",
  "data_quality_status": "complete",
  "address_line1": "",
  "address_city": "",
  "address_state": "",
  "address_postal_code": "",
  "subtotal": 36.0,
  "total_price": 43.99,
  "fulfillment": {
    "address_line1": "",
    "address_city": "",
    "address_state": "",
    "address_postal_code": "",
    "items": [
      { "title": "Re-Nu", "price": 0.0, "quantity": 1.0 },
      { "title": "Aura", "price": 0.0, "quantity": 1.0 },
      { "title": "Oasis", "price": 0.0, "quantity": 1.0 }
    ]
  },
  "order_lock_status": "unlocked",
  "assigned_delivery_date": "2026-05-02",
  "fulfillment_mode": "single_delivery",
  "fulfillment_method": "delivery"
}
```

### AFTER STATE (To Be Applied)

```json
{
  "hub_order_id": "69f5439553a775a4ef2fa3ac",
  "order_number": "NV-MONL4I2M",
  "customer_name": "Amar Kahlon",
  "customer_email": "amar.kahlon23@yahoo.com",
  "production_status": "awaiting_production",  // ← CHANGED (from "new")
  "payment_status": "pending",
  "data_quality_status": "complete",
  "address_line1": "[ADMIN ENTERS]",  // ← e.g., "123 Main St"
  "address_city": "[ADMIN ENTERS]",   // ← e.g., "O'Fallon"
  "address_state": "[ADMIN ENTERS]",  // ← e.g., "MO"
  "address_postal_code": "[ADMIN ENTERS]",  // ← e.g., "63366"
  "subtotal": 36.0,
  "total_price": 43.99,
  "fulfillment": {
    "address_line1": "[MATCHES PARENT]",
    "address_city": "[MATCHES PARENT]",
    "address_state": "[MATCHES PARENT]",
    "address_postal_code": "[MATCHES PARENT]",
    "items": [
      { "title": "Re-Nu", "price": 0.0, "quantity": 1.0 },
      { "title": "Aura", "price": 0.0, "quantity": 1.0 },
      { "title": "Oasis", "price": 0.0, "quantity": 1.0 }
    ]
  },
  "order_lock_status": "verified",  // ← CHANGED (from "unlocked")
  "assigned_delivery_date": "2026-05-02",
  "address_last_synced_from": "manual_repair",  // ← CHANGED (from "stripe_metadata_backfill")
  "address_last_synced_at": "[NOW]"
}
```

### RepairAuditLog ID
**To Be Created** (after fix applied)

```json
{
  "timestamp": "[NOW]",
  "executed_by": "admin@nuvirajuice.com",
  "user_role": "admin",
  "repair_function": "fixMissingAddress",
  "action": "repair",
  "records_affected": 1,
  "reason": "Missing address for order NV-MONL4I2M blocking Driver Portal access. Manual address entry by admin.",
  "changes": {
    "address_line1": "[ADDED]",
    "address_city": "[ADDED]",
    "address_state": "[ADDED]",
    "address_postal_code": "[ADDED]",
    "production_status": "new → awaiting_production",
    "order_lock_status": "unlocked → verified"
  },
  "details": {
    "order_number": "NV-MONL4I2M",
    "customer_email": "amar.kahlon23@yahoo.com",
    "source": "manual_admin_entry"
  }
}
```

### OrderReviewQueue Result
**Current Status**: 1 pending entry (incident_type = missing_customer_info)

```json
{
  "id": "[existing_queue_id]",
  "incident_type": "missing_customer_info",
  "existing_order_number": "NV-MONL4I2M",
  "status": "pending",
  "recommended_action": "manual_review"
}
```

**After Fix**:
```json
{
  "status": "resolved",  // ← UPDATE
  "resolved_at": "[NOW]",
  "resolved_by": "admin@nuvirajuice.com",
  "resolved_action": "Address added manually by admin"
}
```

### Production/Fulfillment Visibility After Fix

#### Production Page
- **Before**: Shows order in production_status = "new" (stuck, unusable)
- **After**: Shows order in production_status = "awaiting_production" → can enter batch planning

#### Fulfillment Page
- **Before**: No fulfillment task (cannot create without address)
- **After**: Fulfillment task created automatically for delivery_date = 2026-05-02

#### Driver Portal
- **Before**: ❌ Order blocked from route (missing address checked at line 95 of optimizeDeliveryRoute)
- **After**: ✅ Order appears in route for 2026-05-02 delivery

#### Orders Page
- **Before**: ✅ Visible but flagged as incomplete
- **After**: ✅ Visible and complete

### Remaining Risk
- ⚠️ **Assumption Risk**: Admin enters wrong address → Driver goes to wrong house → delivery fails → MUST VERIFY with customer
- ⚠️ **Payment Risk**: payment_status still "pending" (payment not yet captured) — may need to capture when address is confirmed
- ⚠️ **System Risk**: If admin doesn't verify address before 2026-05-02 evening, order cannot be delivered today

---

## BLOCKING ORDER 2: NV-MOOPFCUS

### Order Details
- **order_number**: NV-MOOPFCUS
- **customer**: harjas gill
- **email**: jk000.gill@gmail.com
- **Hub Order ID**: ❌ DOES NOT EXIST IN HUB

### Issue
Order missing entirely from Hub. Exists only in OrderReviewQueue as pending. No Hub record created, no fulfillment tasks, no audit trail.

### Missing Fields
```
- ENTIRE ORDER RECORD MISSING from ShopifyOrder table
  └─ No address
  └─ No production_status
  └─ No payment_status
  └─ No audit logs
  └─ No fulfillment tasks
  └─ Cannot appear in any page
```

### Data Available

#### Source of Truth Available
- ❌ **Customer App**: Order exists in OrderReviewQueue incoming_payload, but NOT in ShopifyOrder
- ❌ **Stripe**: No Stripe events found for this order
- ❌ **Hub**: Order record doesn't exist (only review queue entry)

#### Customer App Data Available
- ✅ **From OrderReviewQueue incoming_payload**:
  ```json
  {
    "shopify_order_id": "cs_live_b1vEoTK06fv9DgbOLOhgKUP72l8rwPby3dnit4mBqRa7NKuQtXQuQd9gh3",
    "shopify_order_number": "NV-MOOPFCUS",
    "customer_email": "jk000.gill@gmail.com",
    "customer_name": "harjas gill",
    "line_items": [
      {
        "quantity": 1,
        "title": "The NuVira Trio",
        "price": 36,
        "image_url": "https://..."
      }
    ],
    "fulfillment_method": "delivery",
    "payment_status": "pending",
    "subtotal": 36,
    "total_price": 41.99,
    "customer_order_date": "2026-05-02T18:58:24.596000",
    "address_line1": "",
    "address_line2": "",
    "address_city": "",
    "address_state": "",
    "address_postal_code": "",
    "address_country": "US"
  }
  ```
- ❌ **Address**: ALL BLANK

#### Stripe Data Available
- ❌ **No Stripe events found** for this order
- ❌ No payment intent ID
- ❌ No charge ID
- ❌ No checkout session

#### Hub Data Available
- ❌ **No order record** — recoverMissingOrder function returned `not_found_in_stripe`
- ✅ **OrderReviewQueue has the payload** (can use to create order)
- ❌ No fulfillment tasks
- ❌ No production batch assignment

### Recovery Function to Use

**Function**: `recoverMissingOrder`

**Issue**: Function deployed but would fail because:
```javascript
// Line in recoverMissingOrder:
const matchingEvent = stripeEvents.find(e => 
  e.notes?.includes(order_number) || 
  e.stripe_object_id?.includes(order_number)
);
// Result: null (no Stripe events exist for NV-MOOPFCUS)
```

**Actual Recovery Path**:
1. ✅ Create order from OrderReviewQueue payload (has all data except address)
2. ❌ Cannot proceed without address
3. 🔴 **MUST contact customer for address or re-checkout**

### Admin/Manual Approval Required
**YES** — Critical decision point required:

**Option A** (Recommended): 
- Contact customer at jk000.gill@gmail.com
- Request address for NV-MOOPFCUS
- Once address provided, create order in Hub

**Option B**: 
- Send customer re-checkout link (if payment never captured)
- Capture new payment with address

**Option C**: 
- Mark as abandoned (not ideal)

### BEFORE STATE

```json
{
  "order_in_hub": false,
  "order_in_review_queue": true,
  "review_queue_entries": 6,  // Created during rebuild_subscriptions attempts
  "incident_type": "missing_customer_info",
  "status": "pending",
  "incoming_payload": {
    "shopify_order_id": "cs_live_b1vEoTK06fv9DgbOLOhgKUP72l8rwPby3dnit4mBqRa7NKuQtXQuQd9gh3",
    "shopify_order_number": "NV-MOOPFCUS",
    "customer_email": "jk000.gill@gmail.com",
    "customer_name": "harjas gill",
    "line_items": [
      { "quantity": 1, "title": "The NuVira Trio", "price": 36 }
    ],
    "subtotal": 36,
    "total_price": 41.99,
    "payment_status": "pending",
    "address_line1": "",
    "address_city": "",
    "address_state": "",
    "address_postal_code": ""
  },
  "visibility": {
    "orders_page": false,
    "driver_portal": false,
    "production": false,
    "fulfillment": false,
    "dashboard": false
  },
  "stripe_events": 0,
  "fulfillment_tasks": 0
}
```

### AFTER STATE (To Be Applied)

```json
{
  "order_in_hub": true,  // ← CHANGED (created from review queue)
  "hub_order_id": "[NEW_ID]",  // ← CREATED
  "order_in_review_queue": true,
  "review_queue_status": "resolved",  // ← UPDATED
  "hub_order": {
    "order_number": "NV-MOOPFCUS",
    "customer_email": "jk000.gill@gmail.com",
    "customer_name": "harjas gill",
    "production_status": "new",
    "payment_status": "pending",
    "fulfillment_method": "delivery",
    "line_items": [
      { "quantity": 1, "title": "The NuVira Trio", "price": 36 }
    ],
    "subtotal": 36,
    "total_price": 41.99,
    "address_line1": "[AWAITING FROM CUSTOMER]",  // ← REQUIRED
    "address_city": "[AWAITING FROM CUSTOMER]",
    "address_state": "[AWAITING FROM CUSTOMER]",
    "address_postal_code": "[AWAITING FROM CUSTOMER]",
    "order_lock_status": "unlocked",
    "data_quality_status": "incomplete"  // ← MARKED INCOMPLETE
  },
  "visibility": {
    "orders_page": true,  // ← CHANGED
    "driver_portal": false,  // ← STILL FALSE (address missing)
    "production": true,  // ← CHANGED
    "fulfillment": false,  // ← STILL FALSE (no address)
    "dashboard": true  // ← CHANGED
  },
  "stripe_events": 0,
  "fulfillment_tasks": 0  // ← CREATED ONCE ADDRESS PROVIDED
}
```

### RepairAuditLog ID
**To Be Created** (after order created in Hub)

```json
{
  "timestamp": "[NOW]",
  "executed_by": "admin@nuvirajuice.com",
  "user_role": "admin",
  "repair_function": "recoverMissingOrder",
  "action": "recovery",
  "records_affected": 1,
  "reason": "Order NV-MOOPFCUS missing from Hub but present in OrderReviewQueue. Recovered from incoming_payload with note that address is required from customer.",
  "changes": {
    "created": true,
    "source": "order_review_queue_payload",
    "needs_address_from_customer": true
  },
  "details": {
    "order_number": "NV-MOOPFCUS",
    "customer_email": "jk000.gill@gmail.com",
    "note": "Payment status pending, address required before delivery can be scheduled"
  }
}
```

### OrderReviewQueue Result
**Current Status**: 6 duplicate pending entries (incident_type = missing_customer_info)

**After Fix**:
- **Action**: Delete 5 duplicates, keep 1 and mark as resolved
  ```json
  {
    "id": "[keep_this_one]",
    "incident_type": "missing_customer_info",
    "existing_order_number": "NV-MOOPFCUS",
    "existing_order_id": "[NEW_HUB_ORDER_ID]",
    "status": "resolved",  // ← UPDATE
    "resolved_at": "[NOW]",
    "resolved_by": "admin@nuvirajuice.com",
    "resolved_action": "Order created in Hub from payload. Awaiting customer address."
  }
  ```

### Production/Fulfillment Visibility After Fix

#### Orders Page
- **Before**: ❌ Not visible (not in Hub)
- **After**: ✅ Visible but marked "Awaiting Address"

#### Production Page
- **Before**: ❌ Not visible (no order)
- **After**: ✅ Visible in production_status = "new" (awaiting address to enter planning)

#### Fulfillment Page
- **Before**: ❌ Not visible (no order, no tasks)
- **After**: ❌ Still not visible (no tasks until address provided)

#### Driver Portal
- **Before**: ❌ Not visible (no address, no order)
- **After**: ❌ Still not visible (still no address)

#### Dashboard
- **Before**: ❌ Not in metrics
- **After**: ✅ Appears in "awaiting customer info" section

### Remaining Risk
- 🔴 **CRITICAL**: No address means:
  - Cannot create fulfillment task
  - Cannot assign driver
  - Cannot be delivered today (2026-05-02 deadline)
- 🔴 **CRITICAL**: Payment never captured (payment_status = "pending")
  - Must confirm payment capture OR customer re-checkout
- ⚠️ **Communication Risk**: Customer may not respond to address request
  - Recommend: SMS + email + phone call (636-697-6028)

---

## SUMMARY: 2 BLOCKING ORDERS

| Order | Status | Blocker | Recovery Path | Admin Action | Timeline |
|-------|--------|---------|---------------|--------------|----------|
| **NV-MONL4I2M** | In Hub | Missing address | fixMissingAddress | Manual address entry or customer re-checkout | URGENT (24h) |
| **NV-MOOPFCUS** | Missing from Hub | Missing address + not created | Create from review queue + get address from customer | Contact customer + create order | URGENT (24h) |

---

## NEXT STEPS

### IMMEDIATE (Now)
1. [ ] **NV-MONL4I2M**: Admin enters address via fixMissingAddress or Hub Orders UI
   - If uncertain: contact Amar Kahlon at 636-697-6028 or amar.kahlon23@yahoo.com
2. [ ] **NV-MOOPFCUS**: Contact harjas gill at jk000.gill@gmail.com (no phone)
   - Request delivery address for NV-MOOPFCUS
   - Once received, admin creates order in Hub from OrderReviewQueue payload

### VERIFICATION (After fixes applied)
- [ ] Re-run `detailedCrawlAudit` function
- [ ] Verify both orders now appear in Orders page
- [ ] Verify NV-MONL4I2M appears in Driver Portal route
- [ ] Confirm both orders in Production/Fulfillment pages

### CLEANUP (After verification)
- [ ] Delete duplicate OrderReviewQueue entries for NV-MOOPFCUS (5 duplicates)
- [ ] Mark resolved entries as historic (set status = "resolved")
- [ ] Archive RepairAuditLog entries for completed fixes

---

**Report Generated**: 2026-05-02 21:20 UTC  
**Ready for Admin Action**: YES  
**Stabilization Target**: 2026-05-03 08:00 UTC (24 hours)