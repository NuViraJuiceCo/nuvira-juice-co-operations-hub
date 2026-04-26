# Customer App → Hub App Import Flow Consolidation

**Date:** April 26, 2026  
**Status:** AUDIT COMPLETE - CONSOLIDATION IN PROGRESS

---

## AUDIT RESULTS

### Current Import Paths Found (3 Main Flows)

| Path | Type | Trigger | Safe Gateway | Status | Issues |
|------|------|---------|--------------|--------|--------|
| **receiveOrderFromCustomerApp** | Webhook | Customer App webhook | ❌ Direct writes | ⚠️ UNSAFE | Creates base44_* IDs, direct ShopifyOrder.update, can overwrite fields |
| **pullOrdersFromCustomerApp** | Function | Manual/Scheduled | ✅ safeSyncOrderUpdate | ✅ SAFE | Routes through gateway, deduplicates, handles Stripe name lookup |
| **Stripe webhook + reconcileAndRepairStripeOrders** | Webhook + Automation | Stripe events | ⚠️ Partial | ⚠️ MIXED | Webhook safe, repair worker direct writes |

### Supporting Processes

| Process | Type | Purpose | Safe Gateway | Status |
|---------|------|---------|--------------|--------|
| **checkSubscriptionFulfillmentIntegrity** | Validation | Check fulfillment structure | N/A (read-only) | ✅ SAFE |
| **unifiedOrderRepairWorker** | Automation | Repair broken orders | ✅ safeSyncOrderUpdate | ✅ SAFE |
| **systemHealthCheck** | Monitoring | System health | N/A (read-only) | ✅ SAFE |

---

## EXISTING ORDER AUDIT RESULTS

```
Total orders scanned:          5
Broken (critical issues):      4
Incomplete (non-critical):     0
Verified/complete:            1

By source type:
  - online:                    4 (from Customer App one-time)
  - stripe_subscription:       1 (from Stripe subscription webhook)

Critical issues found:
  - #UNKNOWN orders:           1 (69ed72fd109de49093b43728)
  - Missing email:             2
  - Missing phone:             3
  - Missing delivery address:  2
  - Missing line items:        1
  - Missing/zero total:        1
  - Missing subscription ID:   0
  - Orphaned driver tasks:    19 (from earlier cleanup)
  - Orphaned production refs:  0
```

### Broken Orders Requiring Repair

#### Order 1: #UNKNOWN (69ed72fd109de49093b43728)
- **Issue:** Marked #UNKNOWN with empty email, missing all core fields
- **Source:** Online channel
- **Missing:** email, phone, address, line_items, total_price
- **Action:** Repair from Customer App or quarantine
- **Status:** CRITICAL

#### Order 2: Sukhwant Kahlon (69ed51368b5ca93c33a1b0b4)
- **Issue:** Subscription order missing email + phone (has Stripe sub ID: sub_...)
- **Source:** Stripe subscription webhook
- **Missing:** email, phone (but has verified status)
- **Action:** Repair from Stripe customer object or Customer App
- **Status:** CRITICAL

#### Order 3: Zach Rootz (69ebf5b9b89ae8adac08d8a3)
- **Issue:** Missing phone + delivery address
- **Source:** Customer App online
- **Missing:** phone, address
- **Action:** Repair from Customer App user profile
- **Status:** CRITICAL

#### Orders 4-5: Similar patterns
- Missing optional fields (phone, address)

---

## CONSOLIDATION PLAN

### Step 1: Disable Non-Safe Direct Writes

**Disable:** `receiveOrderFromCustomerApp`  
**Reason:** Makes direct ShopifyOrder.update calls without gateway protection  
**Impact:** Will no longer accept webhook from Customer App  
**Timeline:** Disable immediately (will move Customer App to use pullOrdersFromCustomerApp instead)

### Step 2: Consolidate All Customer App Ingest Into Single Function

**Primary path:** `pullOrdersFromCustomerApp`  
**Already uses:** safeSyncOrderUpdate ✅  
**Already handles:**
- Deduplication
- Stripe name lookup
- Field mapping from Customer App payload
- Non-destructive syncing

**Enhance to handle:**
- Real-time pull when Customer App webhook arrives (instead of receiveOrderFromCustomerApp)
- Catch Stripe webhook orders that need Customer App enrichment
- Route through safeSyncOrderUpdate (already does)

### Step 3: Define Authoritative Field Ownership

#### Customer App Owns (Source of Truth):
- `customer_name` (from user profile)
- `customer_email` (from user profile)
- `customer_phone` (from user profile)
- `internal_customer_id` (app's user ID)
- `customer_app_user_id` (app's user ID)
- `address_line1-4` (from delivery form)
- `delivery_notes` (from order)
- `customer_notes` (from order)
- `requested_delivery_date` (from order form)
- `fulfillment_method` (from order form)
- `line_items` (from cart)
- `source_channel` (always "online" for app orders)

#### Stripe Owns (Source of Truth):
- `stripe_customer_id` (from Stripe customer)
- `stripe_payment_intent_id` (from Stripe checkout)
- `stripe_checkout_session_id` (from Stripe checkout)
- `stripe_subscription_id` (from Stripe subscription)
- `stripe_invoice_id` (from Stripe invoice)
- `payment_status` (from Stripe payment/subscription state)
- `total_price` (from Stripe amount, not Customer App)
- `subtotal` (from Stripe, not Customer App)

#### Hub/Operations Owns:
- `production_status` (set by Hub operations only)
- `fulfillment_status` (set by Hub fulfillment)
- `order_lock_status` (set by Hub system)
- `delivery_status` (set by driver)
- `data_quality_status` (set by repair workers)

#### Shopify Owns (When Connected):
- `shopify_order_id` (from Shopify)
- `shopify_order_number` (from Shopify)

### Step 4: Non-Destructive Sync Rules

When syncing Customer App → Hub:

**Allow updates to:**
- Empty/missing fields only
- Existing field only if new value is more complete
- Never replace valid data with blank/null

**Never allow:**
- Overwriting complete address with blank
- Clearing line items if order already has them
- Replacing customer name with blank
- Replacing Stripe IDs once set
- Changing subscription order to one-time
- Creating duplicate if order already exists

**Conflict resolution:**
- If field exists in Hub: check if incoming value is more complete
- If incoming is less complete: skip update
- If uncertain: quarantine and alert admin

---

## REPAIR STRATEGY FOR EXISTING BROKEN ORDERS

### For Orders Missing Customer Info (Email, Phone, Address)

1. **Match to Customer App record** using:
   - internal_customer_id (if present)
   - customer_app_user_id (if present)
   - customer_email (if present, even if empty in Hub)
   - Line item signature + delivery date

2. **Pull from Customer App API:**
   - GET /customer/{customer_id}/profile → customer name, email, phone
   - GET /order/{app_order_id} → full order with address, notes

3. **Pull from Stripe (if missing in Customer App):**
   - Stripe customer object → name, email, address
   - Stripe checkout session → customer details, address

4. **Update Hub order** (non-destructively via safeSyncOrderUpdate):
   - Add missing customer email
   - Add missing phone
   - Add missing address
   - Do NOT replace existing values

### For #UNKNOWN Orders

1. **Identify which system created it:**
   - If has `stripe_payment_intent_id` → came from Stripe webhook
   - If has `customer_app_user_id` → came from Customer App
   - If neither → orphaned, send to review queue

2. **Recover from source:**
   - If Stripe: fetch Stripe customer object → get name
   - If Customer App: fetch order + profile → get name, email, phone
   - If neither: quarantine (cannot auto-recover)

3. **Set proper order number:**
   - Replace `#UNKNOWN` with `#APP-{last6digits}` or `#STRIPE-{last6digits}`

### For Subscription Orders Missing Email/Phone

1. **Fetch Stripe customer object** using stripe_customer_id
2. **Extract email + name** from Stripe customer
3. **Update Hub order** (non-destructively)

---

## ACTION ITEMS

### Immediate (Now)
1. ✅ Audit existing orders — identify broken records
2. ✅ Identify which orders came from which source
3. Create repair batch for 4 broken orders (below)
4. Disable `receiveOrderFromCustomerApp` webhook endpoint
5. Inform Customer App team to stop using webhook, use pull instead

### Within 24 Hours
1. Run repair on 4 broken orders:
   - Fetch missing data from Stripe customer objects
   - Fetch missing data from Customer App (if available)
   - Update Hub orders via safeSyncOrderUpdate
2. Verify all 5 orders now have complete data
3. Verify production planning only shows complete orders
4. Verify driver portal only shows valid delivery records

### Within 1 Week
1. Monitor pullOrdersFromCustomerApp for reliability
2. Verify no new incomplete orders created
3. Document field ownership rules in code comments
4. Add validation to safeSyncOrderUpdate for critical fields
5. Set up alerts for #UNKNOWN orders or broken syncs

---

## FINAL ACTIVE AUTOMATION SET

After consolidation:

| Automation | Frequency | Purpose | Writes | Safe Gateway | Status |
|-----------|-----------|---------|--------|--------------|--------|
| **stripeCheckoutWebhookHardened** | Real-time | Ingest Stripe events | ShopifyOrder, StripeEventLog | ✅ safeSyncOrderUpdate | ✅ KEEP |
| **pullOrdersFromCustomerApp** | Manual or scheduled | Primary Customer App import | ShopifyOrder, OrderSyncLog | ✅ safeSyncOrderUpdate | ✅ KEEP (PRIMARY) |
| **unifiedOrderRepairWorker** | Daily @ 4am | Repair broken orders | ShopifyOrder, OrderReviewQueue | ✅ safeSyncOrderUpdate | ✅ KEEP |
| **systemHealthCheck** | Every 30min | Monitor system health | None (read-only) | N/A | ✅ KEEP |
| **checkSubscriptionFulfillmentIntegrity** | Daily @ 8am | Validate fulfillments | OrderReviewQueue | N/A (validation) | ✅ KEEP |
| **detectDirectOrderWrite** | Every 30min | Catch bypasses | OrderReviewQueue | N/A (regression) | ✅ KEEP |
| **checkQueueBacklog** | Every 6h | Monitor queue | None (email) | N/A | ✅ KEEP |
| **orderReviewQueueAlert** | On create | Alert admin | None (email) | N/A | ✅ KEEP |
| **reconcileAndRepairStripeOrders** | Daily @ 12pm | CONSOLIDATE or disable | ShopifyOrder | ⚠️ Direct | ⚠️ MARK FOR CONSOLIDATION |
| **receiveOrderFromCustomerApp** | On webhook | DISABLE | ShopifyOrder | ❌ Direct | 🗑️ DISABLE |

**Removals:**
- `receiveOrderFromCustomerApp` — replaced by pullOrdersFromCustomerApp
- `reconcileAndRepairStripeOrders` — consolidated into unifiedOrderRepairWorker

**Result:**
- 8 active automations, all safe ✅
- Single primary Customer App import path ✅
- Single Stripe import path ✅
- Single repair worker ✅

---

## TESTING CHECKLIST

- [ ] Audit identifies all broken orders
- [ ] Repair function successfully enriches missing fields
- [ ] Stripe customer name fetched correctly
- [ ] No #UNKNOWN orders remain
- [ ] Production planning shows only complete orders
- [ ] Driver portal shows only valid delivery records
- [ ] New Customer App orders import completely
- [ ] New Stripe orders import completely
- [ ] Subscription fulfillments created correctly
- [ ] No duplicate orders created
- [ ] No orders overwritten with incomplete data

---

## RISK MITIGATION

| Risk | Mitigation |
|------|-----------|
| Repairing wrong order | Match by internal_customer_id first, then email + date + items signature |
| Missing data in Stripe customer | Fall back to Customer App API, or quarantine if neither has it |
| Partial repair corrupts order | Use safeSyncOrderUpdate (enforces field ownership), only fill missing fields |
| Repair creates duplicate | Match by all Stripe IDs first, then check for existing before updating |
| Future imports revert repair | Enforce non-destructive sync (only fill blanks, never overwrite complete data) |

---

## CONCLUSION

**Customer App → Hub import flow will be:**
- ✅ Consolidated (one primary path)
- ✅ Non-destructive (no overwrites of complete data)
- ✅ Safe (routes through safeSyncOrderUpdate)
- ✅ Repairable (unified repair worker)
- ✅ Monitored (health checks active)
- ✅ Auditable (all syncs logged)

**No new duplicate orders, #UNKNOWN orders, or incomplete active orders after repair.**