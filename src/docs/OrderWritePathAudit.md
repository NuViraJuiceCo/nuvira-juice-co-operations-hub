# ORDER WRITE PATH SECURITY AUDIT

**Status**: COMPREHENSIVE AUDIT + CONSOLIDATION PLAN
**Date**: 2026-04-25
**Priority**: CRITICAL

---

## EXECUTIVE SUMMARY

This audit identifies **12 active order write paths** in the system. Currently, these paths:
- ❌ Have scattered validation logic
- ❌ Can create #unknown records
- ❌ Can overwrite subscriptions
- ❌ Have overlapping field authority
- ❌ Lack unified idempotency

**Required**: Consolidate all writes through ONE safe gateway: `upsertOrderSafely()`

---

## SECTION 1: ALL ORDER WRITE PATHS IDENTIFIED

### Write Path #1: Stripe Webhook - Checkout Completed
**Function**: `stripeCheckoutWebhookV2`
**Trigger**: Webhook from Stripe
**Tables Written**: `ShopifyOrder`
**Fields Can Overwrite**: ALL
**Creates**: Orders (one-time or subscription)
**Updates**: Existing orders by stripe_checkout_session_id
**Can Touch Subscriptions**: YES (creates subscription orders)
**Can Create #unknown**: NO (new validation prevents this)
**Idempotency**: ✅ Event ID tracking (stripeEventLog dedup)
**Data Quality Check**: ✅ Email validation, but incomplete
**Current Risk**: MEDIUM - Can skip invalid email but validation is scattered

---

### Write Path #2: Stripe Webhook - Invoice/Payment Events
**Function**: `stripeCheckoutWebhookV2` (same handler)
**Trigger**: invoice.payment_succeeded, charge.succeeded webhooks
**Tables Written**: `ShopifyOrder`
**Fields Can Overwrite**: payment_status, total_price, line_items
**Creates**: NO (updates existing)
**Updates**: By stripe_payment_intent_id, stripe_subscription_id
**Can Touch Subscriptions**: YES (updates subscription order payments)
**Can Create #unknown**: NO
**Idempotency**: ✅ Event ID tracking
**Data Quality Check**: ⚠️ Minimal
**Current Risk**: MEDIUM - Limited field validation

---

### Write Path #3: Customer App Sync - Pull Orders
**Function**: `pullOrdersFromCustomerApp`
**Trigger**: Manual admin call or scheduled sync
**Tables Written**: `ShopifyOrder`
**Fields Can Overwrite**: ALL except production_status
**Creates**: Orders from customer app
**Updates**: Existing orders by shopify_order_id
**Can Touch Subscriptions**: ❌ NOW BLOCKED (protection added)
**Can Create #unknown**: NO (requires valid email)
**Idempotency**: ⚠️ Partial (deduplicates in batch, but re-runs can cause issues)
**Data Quality Check**: ✅ Email validation, preserves critical fields
**Current Risk**: MEDIUM - Idempotency not bulletproof

---

### Write Path #4: Manual Stripe Recovery
**Function**: `recoverStripeSubscriptionWithValidation`
**Trigger**: Admin clicks recovery in StripeRepair page
**Tables Written**: `ShopifyOrder`
**Fields Can Overwrite**: customer_name, line_items, total_price, subscription metadata
**Creates**: NO (updates existing)
**Updates**: By checkout_session_id
**Can Touch Subscriptions**: YES (restores subscription orders)
**Can Create #unknown**: NO
**Idempotency**: ✅ Function-level check (finds order by session ID)
**Data Quality Check**: ✅ Fetches fresh Stripe data
**Current Risk**: LOW - Admin-initiated, validates against Stripe

---

### Write Path #5: Stripe Reconciliation Worker
**Function**: `reconcileAndRepairStripeOrders`
**Trigger**: Scheduled automation or manual admin call
**Tables Written**: `ShopifyOrder`
**Fields Can Overwrite**: customer_name, line_items, total_price, address, payment_status
**Creates**: NO (updates existing)
**Updates**: Auto-detects broken orders (zero total, #unknown, etc.)
**Can Touch Subscriptions**: YES (repairs subscription orders)
**Can Create #unknown**: NO
**Idempotency**: ✅ Filters for broken orders, not re-processing
**Data Quality Check**: ✅ Fetches fresh Stripe objects
**Current Risk**: LOW - Repairs, not updates

---

### Write Path #6: Order Review Queue - Admin Approval
**Function**: None (direct entity update via page)
**Trigger**: Admin clicks "Approve" in OrderReviewQueue page
**Tables Written**: `ShopifyOrder`, `OrderReviewQueue`
**Fields Can Overwrite**: Varies (depends on admin action)
**Creates**: NO
**Updates**: By order_id (admin manually approves merge)
**Can Touch Subscriptions**: ⚠️ YES (admin decides)
**Can Create #unknown**: NO (review queue prevents bad merges)
**Idempotency**: ✅ Single action per queue item
**Data Quality Check**: ✅ Admin review required
**Current Risk**: LOW - Requires manual admin approval

---

### Write Path #7: Order Status Update (Operations Hub)
**Function**: `syncOrderStatusUpdates` (implied from context)
**Trigger**: Admin updates production_status, fulfillment_status, delivery_status on production page
**Tables Written**: `ShopifyOrder`
**Fields Can Overwrite**: production_status, fulfillment_status, delivery_status, assigned_delivery_date
**Creates**: NO
**Updates**: By order_id
**Can Touch Subscriptions**: NO (only operational fields)
**Can Create #unknown**: NO
**Idempotency**: ✅ Direct update by ID
**Data Quality Check**: ⚠️ None (trusts admin input)
**Current Risk**: LOW - Scoped to operational fields

---

### Write Path #8: Production Page Direct Edit
**Function**: None (direct entity update)
**Trigger**: Admin edits order directly on Orders page
**Tables Written**: `ShopifyOrder`
**Fields Can Overwrite**: customer_name, notes, production_status, fulfillment_method, etc.
**Creates**: NO
**Updates**: By order_id
**Can Touch Subscriptions**: ⚠️ YES (admin can edit any field)
**Can Create #unknown**: NO
**Idempotency**: ✅ Single edit action
**Data Quality Check**: ❌ NONE
**Current Risk**: MEDIUM - Admin can overwrite anything without validation

---

### Write Path #9: Cleanup Corrupted Orders
**Function**: `cleanupCorruptedOrders`
**Trigger**: Admin calls manually (one-time)
**Tables Written**: `ShopifyOrder`, `OrderReviewQueue`
**Fields Can Overwrite**: source_channel, customer_name, line_items, total_price
**Creates**: NO
**Updates**: Existing #unknown orders (upgrades or quarantines them)
**Can Touch Subscriptions**: YES (detects and restores subscriptions)
**Can Create #unknown**: NO
**Idempotency**: ✅ Finds by order_id
**Data Quality Check**: ✅ Fetches from Stripe to verify
**Current Risk**: LOW - One-time cleanup, validates against Stripe

---

### Write Path #10: Order Creation (if any fallback exists)
**Function**: Unknown (need to check for fallback logic)
**Trigger**: Unclear
**Tables Written**: `ShopifyOrder`
**Fields Can Overwrite**: N/A (creation)
**Creates**: YES (potential concern)
**Updates**: N/A
**Can Touch Subscriptions**: N/A
**Can Create #unknown**: ⚠️ POSSIBLE RISK
**Idempotency**: Unknown
**Data Quality Check**: Unknown
**Current Risk**: ⚠️ UNKNOWN - Need to audit for stray create() calls

---

### Write Path #11: Fulfillment Decomposition
**Function**: `recalculateProductionBatches`
**Trigger**: Scheduled automation or manual call
**Tables Written**: `ShopifyOrder` (updates fulfillments array), `ProductionBatch`
**Fields Can Overwrite**: fulfillments, assigned_delivery_date
**Creates**: NO (updates fulfillment structure)
**Updates**: By order_id (adds fulfillments for subscriptions)
**Can Touch Subscriptions**: YES (decomposes subscription fulfillments)
**Can Create #unknown**: NO
**Idempotency**: ⚠️ Partial (recalculates from scratch, could cause race conditions)
**Data Quality Check**: ⚠️ None (trusts existing order data)
**Current Risk**: MEDIUM - No idempotency lock; could duplicate fulfillments if run concurrently

---

### Write Path #12: Manual Bulk Delete
**Function**: None (direct entity deletion)
**Trigger**: Admin selects orders and clicks delete on Orders page
**Tables Written**: `ShopifyOrder`
**Fields Can Overwrite**: N/A (deletion)
**Creates**: N/A
**Updates**: N/A
**Can Touch Subscriptions**: YES (can delete subscription orders)
**Can Create #unknown**: NO
**Idempotency**: ✅ ID-based deletion
**Data Quality Check**: ❌ NONE
**Current Risk**: MEDIUM - Can delete active subscriptions

---

## SECTION 2: SCATTERED VALIDATION LOGIC

### Problem 1: Email Validation
**Location**: `stripeCheckoutWebhookV2` ONLY
**Other paths**: None - each has own or no validation
**Risk**: Inconsistent. Customer app sync has it, but direct edits don't.

### Problem 2: Completeness Checking
**Location**: `lib/orderValidator.js` (not used everywhere!)
**Other paths**: `pullOrdersFromCustomerApp` uses it partially
**Risk**: High. OrderValidator exists but isn't called by all write paths.

### Problem 3: Subscription Protection
**Location**: `pullOrdersFromCustomerApp` ONLY
**Other paths**: Direct edits can bypass this
**Risk**: Admin can accidentally downgrade subscription via edit form.

### Problem 4: Idempotency
**Stripe webhooks**: Event ID dedup ✅
**Customer app sync**: Partial dedup ⚠️
**Direct edits**: None ❌
**Recovery**: ID-based lookup ✅
**Cleanup**: ID-based ✅

### Problem 5: Stale Update Detection
**Location**: `orderValidator.js` (defined but not enforced everywhere)
**Risk**: Old webhooks could overwrite newer data if processed out-of-order.

### Problem 6: Unknown Quarantine
**Location**: `orderValidator.js` + webhook
**Other paths**: Direct edits can create #unknown via form
**Risk**: Scattered enforcement.

---

## SECTION 3: SOURCE OF TRUTH MAP (CURRENT - BROKEN)

### Stripe Authority
✅ Owns: payment_status, stripe_subscription_id, invoice_id, payment_intent_id
❌ Problem: Webhook can overwrite customer_name, delivery_address (shouldn't)
❌ Problem: Recovery can only restore if Stripe data exists

### Customer App Authority
✅ Owns: cart contents, line_items at checkout, delivery_address, customer_notes
❌ Problem: Can't distinguish between "customer updated address" vs "incomplete webhook address"
❌ Problem: Sync doesn't know if order is already in production

### Operations Hub Authority
✅ Owns: production_status, fulfillment_status, delivery_status
❌ Problem: Can edit customer_name and other non-operational fields
❌ Problem: No protection against overwriting Stripe metadata

### System Authority
✅ Owns: internal_order_id, order_type, created_at, updated_at
❌ Problem: No data_quality_status field to track record health
❌ Problem: No last_verified_at to track staleness

---

## SECTION 4: FIELD OWNERSHIP RULES (REQUIRED)

### Stripe-Owned Fields (Only Stripe writes, others read-only)
```
- payment_status
- stripe_customer_id
- stripe_subscription_id
- stripe_invoice_id
- stripe_checkout_session_id
- stripe_payment_intent_id
- stripe_charge_id
- stripe_created_event_type
- subscription_status (derived from Stripe)
- last_reconciliation_at (when last verified vs Stripe)
```

### Customer/App-Owned Fields (Customer app updates, Stripe reads)
```
- customer_name
- customer_email
- customer_phone
- address_line1, address_line2, address_city, address_state, address_postal_code, address_country
- customer_notes
- requested_delivery_date
- delivery_notes
```

### Operations-Owned Fields (Hub updates, others read-only)
```
- production_status
- fulfillment_status
- delivery_status
- assigned_delivery_date
- assigned_delivery_window
- production_batch_id
- fulfillments[]
- internal_notes (ops-specific)
```

### System-Owned Fields (System manages)
```
- id
- created_date
- updated_date
- created_by
- sync_status
- repair_status
- repair_timestamp
- last_sync_at
- source_channel
- source_type
- data_quality_status (NEW - see below)
- last_verified_at (NEW)
- stripe_event_id_applied (audit)
```

### Hybrid Fields (Multiple sources, require conflict resolution)
```
- line_items: Stripe provides at checkout, Customer app provides from cart
  → Authority: Whichever is most recent + complete
  → Rule: Never erase line_items; only append new data
  
- total_price: Stripe source, but Customer app can suggest
  → Authority: Stripe (payment_status decides final amount)
  → Rule: If Stripe and App differ, use Stripe
  
- delivery_address: Customer app provides, Stripe provides at checkout
  → Authority: Whichever is most recent
  → Rule: Don't merge partially; use complete address or nothing
```

---

## SECTION 5: NEW REQUIRED FIELDS

Add to ShopifyOrder schema:

```json
{
  "data_quality_status": {
    "type": "string",
    "enum": ["complete", "incomplete", "quarantined", "recovery_pending", "verified"],
    "default": "incomplete",
    "description": "Health of this record. Incomplete records stay out of production."
  },
  "last_verified_at": {
    "type": "string",
    "description": "ISO timestamp when this record was last verified against source system (Stripe for subscriptions, etc.)"
  },
  "field_ownership_source": {
    "type": "object",
    "description": "Tracks which system last updated each field",
    "properties": {
      "customer_name": {"type": "string", "enum": ["stripe_checkout", "customer_app", "manual_recovery", "admin_edit"]},
      "delivery_address": {"type": "string", "enum": ["stripe_checkout", "customer_app", "admin_edit"]},
      "line_items": {"type": "string", "enum": ["stripe_invoice", "customer_app_checkout", "admin_edit"]},
      "total_price": {"type": "string", "enum": ["stripe_payment", "manual_override"]},
      "production_status": {"type": "string", "enum": ["auto_calculated", "admin_set"]},
      "fulfillments": {"type": "string", "enum": ["auto_decomposed", "manual_created"]}
    }
  }
}
```

---

## SECTION 6: CONSOLIDATION - CENTRALIZED GATEWAY

### Create New Function: `upsertOrderSafely()`

**Purpose**: Single validation gateway for ALL order writes

**Location**: `functions/upsertOrderSafely.ts`

**Inputs**:
```typescript
{
  orderId?: string,              // If updating
  incomingData: OrderPayload,    // New/updated fields
  source: 'stripe_webhook' | 'customer_app_sync' | 'manual_recovery' | 'admin_edit' | 'operations_status' | 'decomposition',
  stripEventId?: string,         // For idempotency
  userEmail?: string,            // For admin_edit
  requireCompleteData?: boolean  // Force completeness
}
```

**Validation Steps**:
1. Check idempotency (if update)
2. Verify source authority (which fields can this source write?)
3. Run completeness check
4. Detect subscription orders
5. Check for stale updates
6. Prevent unknown-quality overwrites
7. Prevent subscription downgrades
8. Merge safely if incomplete
9. Update data_quality_status
10. Log to OrderSyncLog
11. Quarantine if suspicious
12. Finally, write to database

**Enforcement**:
- NO direct `.create()` or `.update()` calls to ShopifyOrder outside this function
- All other functions call `upsertOrderSafely()` instead

---

## SECTION 7: CONSOLIDATION PLAN

### Phase 1: Redirect All Writes to Safe Gateway
1. ✅ `stripeCheckoutWebhookV2` → calls `upsertOrderSafely(source='stripe_webhook')`
2. ✅ `pullOrdersFromCustomerApp` → calls `upsertOrderSafely(source='customer_app_sync')`
3. ✅ `recoverStripeSubscriptionWithValidation` → calls `upsertOrderSafely(source='manual_recovery')`
4. ✅ `reconcileAndRepairStripeOrders` → calls `upsertOrderSafely(source='manual_recovery')`
5. ✅ `cleanupCorruptedOrders` → calls `upsertOrderSafely(source='manual_recovery')`
6. ✅ `recalculateProductionBatches` → calls `upsertOrderSafely(source='decomposition')`
7. ⚠️ Operations Hub status updates → needs new wrapper function
8. ❌ Admin direct edits → need form validation wrapper (new component)

### Phase 2: Disable Dangerous Direct Writes
- Remove any direct `.create()` to ShopifyOrder
- Remove any direct `.update()` to ShopifyOrder outside wrapper
- Add API permission checks to prevent form-level bypasses

### Phase 3: Implement Field Ownership
- Add `field_ownership_source` tracking
- Validate that each source only writes its authorized fields
- Reject writes to fields owned by other sources (unless admin + approval)

### Phase 4: Add Production Page Safeguards
- Production pages read from `data_quality_status = 'complete'` only
- Don't display #unknown, quarantined, or incomplete records
- Add visual warning for recovery_pending records

---

## SECTION 8: DETAILED RISK ASSESSMENT

| Write Path | Current Risk | After Consolidation |
|-----------|-------------|-------------------|
| Stripe Webhook | MEDIUM | LOW (validates + logs) |
| Customer App Sync | MEDIUM | LOW (field ownership enforced) |
| Stripe Recovery | LOW | VERY LOW (validation + source tracking) |
| Stripe Repair Worker | LOW | VERY LOW |
| Order Review Queue | LOW | VERY LOW (admin approval) |
| Operations Hub | MEDIUM | LOW (field-scoped update wrapper) |
| Direct Admin Edit | MEDIUM | LOW (form validation wrapper) |
| Production Page Refresh | MEDIUM | LOW (reads verified records only) |
| Decomposition | MEDIUM | LOW (idempotency lock + validation) |
| Cleanup | LOW | VERY LOW |
| Manual Bulk Delete | MEDIUM | LOW (confirmation + subscription check) |
| Unknown Create Fallback | ⚠️ UNKNOWN | ELIMINATED |

---

## SECTION 9: SUBSCRIPTION HARD LOCK

**Rule**: Orders marked as subscription can NEVER become one-time.

**Implementation**:
```typescript
if (order.source_channel === 'subscription' || order.stripe_subscription_id) {
  // If incoming tries to change to one_time
  if (incomingData.source_channel === 'one_time') {
    throw new Error('[SUBSCRIPTION LOCK] Cannot downgrade subscription to one-time. Quarantined.');
  }
  
  // If incoming tries to remove subscription ID
  if (!incomingData.stripe_subscription_id && order.stripe_subscription_id) {
    throw new Error('[SUBSCRIPTION LOCK] Cannot remove stripe_subscription_id. Quarantine.');
  }
  
  // If incoming tries to remove line_items or fulfillments
  if (incomingData.line_items?.length === 0 || 
      (incomingData.fulfillments?.length === 0 && order.fulfillments?.length > 0)) {
    throw new Error('[SUBSCRIPTION LOCK] Cannot erase line_items or fulfillments. Quarantine.');
  }
  
  // Force subscription preservation
  incomingData.source_channel = 'subscription';
  incomingData.stripe_subscription_id = incomingData.stripe_subscription_id || order.stripe_subscription_id;
}
```

---

## SECTION 10: PRODUCTION PAGE SAFEGUARDS

**Records allowed on Production pages**:
- ✅ data_quality_status = 'complete'
- ✅ data_quality_status = 'verified'
- ⚠️ data_quality_status = 'recovery_pending' (with warning badge)

**Records blocked**:
- ❌ data_quality_status = 'incomplete'
- ❌ data_quality_status = 'quarantined'
- ❌ shopify_order_number = '#unknown'
- ❌ total_price = 0 and line_items.length = 0
- ❌ stripe_subscription_id exists but fulfillments empty

**SQL-like filter**:
```sql
WHERE (data_quality_status IN ('complete', 'verified') 
  OR data_quality_status = 'recovery_pending')
AND shopify_order_number != '#unknown'
AND NOT (total_price = 0 AND line_items IS NULL)
```

---

## SECTION 11: TESTING SCENARIOS

### Test 1: Stripe Subscription → Payment → Decomposition
```
1. Checkout session created (mode='subscription')
2. Webhook: checkout.session.completed arrives
   → upsertOrderSafely(source='stripe_webhook')
   → data_quality_status = 'incomplete' (awaiting subscription event)
3. Webhook: subscription.created arrives
   → upsertOrderSafely(source='stripe_webhook')
   → data_quality_status = 'complete'
4. Webhook: invoice.payment_succeeded arrives
   → upsertOrderSafely(source='stripe_webhook', requireCompleteData=false)
   → data_quality_status = 'complete' (still)
5. Decomposition automation runs
   → upsertOrderSafely(source='decomposition')
   → fulfillments[] populated
   → data_quality_status = 'verified'
6. Production page shows order ✅
```

Expected: No downgrade, no #unknown, no data loss.

### Test 2: #Unknown Payload Arrives After Subscription
```
1. Order exists as complete subscription (data_quality_status='verified')
2. Old webhook with #unknown payload arrives
   → upsertOrderSafely(source='stripe_webhook', incomingData={..#unknown..})
   → Validation detects: existing is complete + verified
   → Incoming is incomplete + unknown
   → REJECTS update
   → Quarantines incident
   → No overwrite ✅
```

Expected: Subscription protected, incident logged.

### Test 3: Same Event Twice
```
1. Webhook: checkout.session.completed (event_id = evt_123)
   → upsertOrderSafely(stripeEventId='evt_123')
   → Creates OrderSyncLog entry
2. Same webhook retry (event_id = evt_123)
   → upsertOrderSafely(stripeEventId='evt_123')
   → Detects duplicate in OrderSyncLog
   → Skips processing ✅
```

Expected: Idempotent, no duplicate.

### Test 4: Out-of-Order Webhooks
```
1. Webhook: invoice.payment_succeeded arrives BEFORE subscription.created
   → upsertOrderSafely(source='stripe_webhook')
   → Matches by stripe_payment_intent_id
   → Updates payment_status
   → Preserves existing subscription_id ✅
2. Later: subscription.created arrives
   → Matches same order
   → Updates subscription metadata ✅
```

Expected: Both processed, no confusion.

### Test 5: Admin Edits Subscription
```
1. Order is subscription (data_quality_status='complete')
2. Admin tries to change source_channel to 'one_time'
   → upsertOrderSafely(source='admin_edit', incomingData={source_channel='one_time'})
   → SUBSCRIPTION HARD LOCK triggered
   → Rejects change
   → Logs attempt ✅
```

Expected: Protected.

### Test 6: Customer App Updates One-Time
```
1. Order is one_time (data_quality_status='complete')
2. Customer app pull arrives with updated address
   → upsertOrderSafely(source='customer_app_sync', incomingData={address_line1='new'})
   → Validates: customer_app can write address ✅
   → Validates: incoming data is complete enough ✅
   → Updates address
   → data_quality_status = 'complete' ✅
```

Expected: Address updated safely.

### Test 7: Recovery Subscription with Missing Metadata
```
1. Order exists as subscription but lost line_items
2. Admin runs recovery
   → recoverStripeSubscriptionWithValidation(checkout_session_id)
   → Fetches from Stripe
   → Calls upsertOrderSafely(source='manual_recovery')
   → Restores line_items, subscription_id, metadata
   → data_quality_status = 'verified' ✅
   → Triggers decomposition ✅
```

Expected: Fully restored.

### Test 8: Production Page Refresh
```
1. Decomposition runs
   → upsertOrderSafely(source='decomposition')
   → Populates fulfillments
   → data_quality_status = 'verified'
2. Production page queries orders
   → Filter: data_quality_status IN ('complete', 'verified')
   → Shows order ✅
3. Another #unknown order exists (quarantined)
   → Filter: data_quality_status != 'quarantined'
   → Hidden from production ✅
```

Expected: Production page shows only safe orders.

### Test 9: Parallel Decomposition (Race Condition)
```
1. Decomposition automation runs at 9:00am
   → Locks order for update
   → upsertOrderSafely(source='decomposition', orderId='123')
2. Another automation triggers at 9:00:01
   → Tries to lock same order
   → Detects lock conflict
   → Waits or skips ✅
```

Expected: No duplicate fulfillments.

### Test 10: Stale Webhook After Newer Sync
```
1. Current order: updated_date = 2026-04-25 14:30:00
2. Old webhook arrives: event_date = 2026-04-25 13:00:00
   → upsertOrderSafely(source='stripe_webhook', incomingData={...old data...})
   → Detects: incoming is older than current
   → REJECTS as stale ✅
   → Logs stale attempt
```

Expected: Newer data protected.

---

## SECTION 12: IMPLEMENTATION CHECKLIST

- [ ] Create `upsertOrderSafely()` function with all validation
- [ ] Create `updateOperationalStatusSafely()` for Operations Hub
- [ ] Create form wrapper for admin direct edits
- [ ] Add `data_quality_status` and `last_verified_at` fields to ShopifyOrder
- [ ] Add `field_ownership_source` tracking
- [ ] Update `stripeCheckoutWebhookV2` to call `upsertOrderSafely()`
- [ ] Update `pullOrdersFromCustomerApp` to call `upsertOrderSafely()`
- [ ] Update `recoverStripeSubscriptionWithValidation` to call `upsertOrderSafely()`
- [ ] Update `reconcileAndRepairStripeOrders` to call `upsertOrderSafely()`
- [ ] Update `cleanupCorruptedOrders` to call `upsertOrderSafely()`
- [ ] Update `recalculateProductionBatches` to call `upsertOrderSafely()`
- [ ] Create wrapper for Operations Hub status updates
- [ ] Update Production page to filter by `data_quality_status`
- [ ] Update Orders page form to call validation wrapper
- [ ] Add confirmation to bulk delete with subscription check
- [ ] Remove all direct `.create()` and `.update()` calls to ShopifyOrder
- [ ] Add SUBSCRIPTION HARD LOCK logic to `upsertOrderSafely()`
- [ ] Test all 10 scenarios above
- [ ] Document source-of-truth rules for team

---

## FINAL CONSOLIDATION SUMMARY

### Before
- 12 scattered write paths
- Validation logic duplicated/scattered
- Field authority unclear
- #unknown orders possible
- Subscription downgrades possible
- Race conditions in decomposition
- Admin can bypass all rules

### After
- 1 safe gateway: `upsertOrderSafely()`
- All validation centralized
- Field ownership strictly enforced
- #unknown orders quarantined
- Subscription hard lock
- Race conditions prevented
- Admin edits validated

### Remaining Risks
- **Admin Override**: Admins can still approve bad orders in review queue
  - Mitigation: Email alert, confirmation dialog, audit log
- **Stripe Data Gaps**: If Stripe object is incomplete, recovery can't fill gaps
  - Mitigation: Recovery still sends to review queue if data incomplete
- **Decomposition Timing**: If subscription updated while decomposition runs
  - Mitigation: Idempotency lock on fulfillments array

---

## NEXT STEPS

1. Review and approve this audit
2. Implement `upsertOrderSafely()` function
3. Update all 6 write paths to use new gateway
4. Add field ownership validation
5. Test all 10 scenarios
6. Deploy and monitor for 1 week
7. Disable old direct write paths
8. Final verification

---

**Status**: Ready for implementation
**Timeline**: 4-6 hours for core gateway + redirect all paths
**Risk**: LOW (additive, doesn't break existing flows)
**Rollback**: Keep old functions as fallback during transition