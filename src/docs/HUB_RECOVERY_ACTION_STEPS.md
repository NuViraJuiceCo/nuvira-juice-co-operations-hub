# Hub Recovery Action Steps — NV-MONI2Z3R & Future Orders

**Date**: 2026-05-01  
**Target Order**: NV-MONI2Z3R (Amar Kahlon, $43.99, PAID)  
**Expected Duration**: < 5 minutes once endpoint is live

---

## Pre-Recovery Checklist

Before beginning recovery, confirm:

- [ ] Hub ingestion endpoint is live and responding to requests
- [ ] Endpoint is POST `/safeSyncOrderUpdate` or `/ingestCustomerAppOrder`
- [ ] Authentication works (Bearer token + `CUSTOMER_APP_SYNC_SECRET`)
- [ ] Sample test request returns 200/201 success response
- [ ] safeSyncOrderUpdate is running and accessible
- [ ] OrderSyncLog entity exists and is writable
- [ ] OrderReviewQueue entity exists and is writable
- [ ] ShopifyOrder entity exists and is writable

---

## Step 1: Verify Endpoint Is Live

**Action**: Test the endpoint with a sample request

```bash
curl -X POST {HUB_ENDPOINT_URL} \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {CUSTOMER_APP_SYNC_SECRET}" \
  -d '{"test": true}'
```

**Expected Response**: 200 or 400 (not 405, 503, or error)

**If 405**: Endpoint is not configured. Contact Hub DevOps to enable POST method.

**If 401**: Auth token mismatch. Verify `CUSTOMER_APP_SYNC_SECRET` is identical in Hub and Customer App.

**If 200 with validation error**: ✅ Endpoint is live and responding correctly.

---

## Step 2: Ingest NV-MONI2Z3R from Customer App

**Action**: Customer App sends the paid order to Hub via the ingestion endpoint

**Payload**:
```json
{
  "order_number": "NV-MONI2Z3R",
  "order_intent_id": "nv_moni2z3r_intent_2026_05_01_2244",
  "customer_name": "Amar Kahlon",
  "customer_email": "amar.kahlon23@yahoo.com",
  "customer_phone": "+1-6366976028",
  "address_line1": "206 West Pine Creek Ct",
  "address_city": "O'Fallon",
  "address_state": "MO",
  "address_postal_code": "63366",
  "address_country": "US",
  "line_items": [
    {
      "title": "The NuVira Trio",
      "quantity": 1,
      "price": 36.00
    }
  ],
  "total_price": 43.99,
  "subtotal": 36.00,
  "delivery_fee": 7.99,
  "stripe_checkout_session_id": "cs_live_b1J7GRe1E8Un8SbXKhMsXGRMceMOhvjVOubNfqkeg9o6ZgAYngK8TgU3xK",
  "stripe_payment_intent_id": "pi_1234567890abcdef",
  "stripe_customer_id": "cus_123456789",
  "payment_status": "paid",
  "fulfillment_method": "delivery",
  "requested_delivery_date": "2026-05-02"
}
```

**Expected Response**:
```json
{
  "status": "success",
  "action": "created",
  "order_id": "NEW_HUB_ORDER_ID",
  "order_number": "NV-MONI2Z3R"
}
```

**If Success (201/200)**:
- ✅ Order created in Hub ShopifyOrder
- ✅ OrderSyncLog entry created
- ✅ Order is now visible to Production, Fulfillment, Driver Portal
- Proceed to Step 3

**If Rejected (400/422)**:
- Check rejection reason in response
- Verify address is complete (required for delivery orders)
- Retry with corrected payload
- If still rejected, inspect OrderReviewQueue for details

**If Error (500)**:
- Contact Hub support
- Check safeSyncOrderUpdate logs
- Order is safe in Customer App — will retry automatically

---

## Step 3: Verify Order in Hub (ShopifyOrder)

**Action**: Query Hub database to confirm order exists

```javascript
const order = await base44.entities.ShopifyOrder.filter({
  shopify_order_number: 'NV-MONI2Z3R'
});
```

**Expected Result**: Single order record with:
- ✅ `shopify_order_number`: "NV-MONI2Z3R"
- ✅ `customer_email`: "amar.kahlon23@yahoo.com"
- ✅ `customer_name`: "Amar Kahlon"
- ✅ `payment_status`: "paid"
- ✅ `total_price`: 43.99
- ✅ `line_items`: [{ title: "The NuVira Trio", quantity: 1, price: 36.00 }]
- ✅ `address_line1`: "206 West Pine Creek Ct"
- ✅ `address_city`: "O'Fallon"
- ✅ `address_state`: "MO"
- ✅ `address_postal_code`: "63366"
- ✅ `production_status`: "new" or "awaiting_production"
- ✅ `order_lock_status`: "unlocked"
- ✅ `stripe_checkout_session_id`: "cs_live_b1J7GRe1E8Un8SbXKhMsXGRMceMOhvjVOubNfqkeg9o6ZgAYngK8TgU3xK"
- ✅ `stripe_payment_intent_id`: "pi_1234567890abcdef"
- ✅ `data_quality_status`: "complete"

**If Found**: ✅ Order successfully created. Proceed to Step 4.

**If Not Found**: ❌ Order ingestion failed. Check OrderSyncLog for sync_status = "failed" or OrderReviewQueue for quarantine entry.

---

## Step 4: Verify Order in OrderSyncLog (Audit Trail)

**Action**: Query audit log to confirm sync was tracked

```javascript
const syncLog = await base44.entities.OrderSyncLog.filter({
  order_number: 'NV-MONI2Z3R'
});
```

**Expected Result**: One or more entries with:
- ✅ `sync_source`: "customer_app"
- ✅ `action`: "created"
- ✅ `success`: true
- ✅ `sync_timestamp`: ISO datetime
- ✅ `customer_email`: "amar.kahlon23@yahoo.com"
- ✅ `stripe_event_id`: "cs_live_b1J7GRe..." or "pi_1234..." (idempotency key)

**If Found**: ✅ Sync is auditable. Proceed to Step 5.

**If Not Found**: ⚠ Sync may have succeeded but wasn't logged. Check ShopifyOrder directly (Step 3). If order exists, logging is non-critical.

---

## Step 5: Verify Order in OrderReviewQueue (No False Quarantines)

**Action**: Query quarantine queue to confirm NO false quarantine

```javascript
const queue = await base44.entities.OrderReviewQueue.filter({
  customer_email: 'amar.kahlon23@yahoo.com'
});
```

**Expected Result**: Either:
1. No entries for this order (preferred)
2. If entries exist, they should NOT be for `incident_type: "duplicate_event"` or `"unknown_order_attempt"`

**If True Quarantine Found** (not expected):
- May be legitimate (e.g., address missing, incomplete data)
- Check `issue_description` and `recommended_action`
- Follow admin review process if needed

**If False Duplicate Quarantine Found** (BUG INDICATOR):
- ❌ This indicates a deduping issue (same-email false collision)
- Do NOT proceed to Driver Portal until resolved
- Report to engineering immediately

**If No Quarantine** (expected): ✅ Order passed quality gates. Proceed to Step 6.

---

## Step 6: Verify Order in Production Planning

**Action**: Check if order triggered production batch creation

**Criteria**:
- Order has `production_status`: "awaiting_production" or higher
- Order has `line_items`: non-empty
- Order has complete delivery address

**Manual Check**:
```javascript
const batch = await base44.entities.ProductionBatch.filter({
  order_sources: { $elemMatch: { order_number: 'NV-MONI2Z3R' } }
});
```

**Expected Result**: 
- If delivery date is May 2 or later: ✅ Batch created for "The NuVira Trio"
- If delivery date is in past: Order may not batch (expected)

**If Batch Not Found**:
- May be expected if recalculateProductionBatches hasn't run yet
- Run `recalculateProductionBatches` to force batch creation
- Check `production_status` and `data_quality_status`

**If Batch Found**: ✅ Order is in production queue. Proceed to Step 7.

---

## Step 7: Verify Order in Fulfillment Tasks

**Action**: Check if fulfillment task was created for delivery

**Manual Check**:
```javascript
const tasks = await base44.entities.FulfillmentTask.filter({
  order_id: 'NV-MONI2Z3R_HUB_ORDER_ID'
});
```

**Expected Result**:
- One task for delivery on 2026-05-02 (or requested_delivery_date)
- `status`: "Unassigned" (waiting for driver assignment)
- `customer_name`: "Amar Kahlon"
- `address`: "206 West Pine Creek Ct, O'Fallon, MO 63366"

**If Not Found**:
- May not be created until order is locked for production
- Run `createFulfillmentTasks` manually to generate task
- Expected once production batch is assigned

**If Found**: ✅ Fulfillment is ready. Proceed to Step 8.

---

## Step 8: Verify Order in Driver Portal

**Action**: Check Driver Portal can see the order for delivery

**Manual Check** (as driver or admin):
1. Navigate to Driver Portal
2. Set delivery date to 2026-05-02
3. Confirm order **NV-MONI2Z3R** appears in delivery queue
4. Confirm customer name, address, items are visible
5. Confirm no delivery address warnings

**Expected State**:
- ✅ Order visible in "Queued" section
- ✅ Customer name and address readable
- ✅ Items list shows "The NuVira Trio"
- ✅ No warnings about missing address

**If Not Visible**:
- Check date filter (may be outside date range)
- Check address quality (may be gated for missing address)
- Check production_status (may not be "awaiting_production" or higher)

**If Visible**: ✅ Driver Portal is ready. Proceed to Step 9.

---

## Step 9: Test Repeat Customer Same-Email Orders

**Action**: Verify the fix for repeat customers with same email

**Test Case**:
1. Customer amar.kahlon23@yahoo.com places Order 1: **NV-MONGOVGM** (existing, created 2026-05-01)
2. Customer amar.kahlon23@yahoo.com places Order 2: **NV-MONI2Z3R** (new, created 2026-05-01)

**Expected Result**:
- ✅ Both orders exist in Hub ShopifyOrder as SEPARATE records
- ✅ Query by email returns BOTH orders
- ✅ Query by order_number returns only that order (not both)
- ✅ No OrderReviewQueue duplicate warnings
- ✅ Both appear in Production Planning separately
- ✅ Both appear in Driver Portal on delivery date

**Manual Check**:
```javascript
// Should return 2 orders, not 1
const orders = await base44.entities.ShopifyOrder.filter({
  customer_email: 'amar.kahlon23@yahoo.com'
});
console.assert(orders.length === 2, 'Should have 2 orders for this customer');

// Each order should be retrievable by its order_number
const order1 = await base44.entities.ShopifyOrder.filter({
  shopify_order_number: 'NV-MONGOVGM'
});
console.assert(order1.length === 1, 'Order 1 should exist');

const order2 = await base44.entities.ShopifyOrder.filter({
  shopify_order_number: 'NV-MONI2Z3R'
});
console.assert(order2.length === 1, 'Order 2 should exist');
```

**If Both Orders Exist Separately**: ✅ **RECOVERY SUCCESSFUL**

**If Orders Are Merged or One Is Missing**: ❌ **BUG DETECTED** — Return to Hub team with details.

---

## Final Verification Checklist

- [ ] Endpoint is live and responds to POST requests
- [ ] NV-MONI2Z3R successfully ingested (201/200 response)
- [ ] Order appears in ShopifyOrder with all data
- [ ] OrderSyncLog shows successful sync
- [ ] OrderReviewQueue has NO false quarantine
- [ ] Production batch created (or ready to create)
- [ ] Fulfillment task created (or ready to create)
- [ ] Driver Portal shows order for delivery date
- [ ] Repeat customer orders do NOT merge by email
- [ ] No warnings or data quality issues

---

## If Recovery Fails

**Failure Point 1: Endpoint Returns 405**
- Contact Hub DevOps — endpoint not created/enabled
- Confirm POST method is allowed
- Confirm correct URL is being used

**Failure Point 2: Endpoint Returns 401**
- Verify `CUSTOMER_APP_SYNC_SECRET` matches between Hub and Customer App
- Confirm Bearer token is being passed in Authorization header
- Check Hub environment variables

**Failure Point 3: Order Rejected by safeSyncOrderUpdate**
- Check OrderReviewQueue for rejection reason
- Verify address is complete (if delivery)
- Verify payment_status is "paid"
- Verify line_items is non-empty

**Failure Point 4: Order Appears Twice (Merge Issue)**
- Stop processing immediately
- This indicates a deduping bug
- Report to engineering with order IDs and timestamps
- Do NOT sync additional orders until resolved

**Failure Point 5: Repeat Customer Orders Merge**
- ❌ **CRITICAL BUG** — safeSyncOrderUpdate is deduping by email
- Check idempotency keys are unique for each order
- Verify stripe_checkout_session_id and stripe_payment_intent_id are different
- Contact engineering — this is a regression from the fix

---

## Rollback Plan

If recovery causes issues:
1. Disable the ingestion endpoint (return 503)
2. Orders remain safe in Customer App
3. No data loss — manual recovery functions are ready
4. Once issues are fixed, re-enable and resume

---

## Next Steps After Successful Recovery

1. **Monitor for 24 hours**:
   - Watch OrderSyncLog for failures
   - Monitor OrderReviewQueue for false quarantines
   - Check Production Planning for batch creation
   - Verify Driver Portal is synced

2. **Enable Automatic Sync**:
   - Stripe webhook handler will auto-sync future orders
   - Monitor webhook failure rate

3. **Customer Communication**:
   - Notify customer that order NV-MONI2Z3R is now in production
   - Provide estimated delivery date
   - Resume normal order processing

4. **Post-Mortem**:
   - Document root cause (405 endpoint issue)
   - Implement monitoring to catch future 405s
   - Review incident response timeline

---

**Estimated Time to Recovery**: < 5 minutes once endpoint is live  
**Expected Status Change**: FAIL → PASS (or PASS WITH MONITORING REQUIRED)