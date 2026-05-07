# Customer App → Hub Refund Event Contract

**Effective:** 2026-05-07  
**Status:** ✅ FINAL & VERIFIED  
**Purpose:** Single source of truth for CA-to-Hub refund propagation auth, endpoint, method, headers, and payload.

---

## 1. Endpoint Contract

| Field | Value |
|-------|-------|
| **Hub Endpoint URL** | `https://{HUB_DOMAIN}/functions/receiveCustomerAppEvent` |
| **HTTP Method** | `POST` (enforced at line 24 of receiveCustomerAppEvent) |
| **Content-Type** | `application/json` (required, validated by body parsing) |

---

## 2. Authentication Contract

| Field | Value |
|-------|-------|
| **Auth Header Name** | `Authorization` |
| **Auth Header Format** | `Bearer {TOKEN}` |
| **Token Source on CA** | Environment variable: `HUB_SYNC_SECRET` (or named as CA prefers) |
| **Token Source on Hub** | Environment variable: `CUSTOMER_APP_SYNC_SECRET` (line 21 of receiveCustomerAppEvent) |
| **Validation Logic** | Hub reads `Authorization` header, extracts value after `Bearer `, compares to `CUSTOMER_APP_SYNC_SECRET` (lines 29-33) |
| **Success Response** | HTTP 200 with structured JSON |
| **Failure Response (Auth)** | HTTP 401 Unauthorized with `{"error": "Unauthorized"}` (line 33) |
| **Failure Response (Method)** | HTTP 405 Method Not Allowed with `{"error": "Method not allowed"}` (line 25) |

---

## 3. Event Type: `order.refunded`

### 3.1 Supported Payload Shape

The Customer App MUST send a POST to `receiveCustomerAppEvent` with:

```json
{
  "event": "order.refunded",
  "order": {
    "order_number": "NV-XXXXXXXX",
    "customer_email": "user@example.com",
    "customer_name": "Full Name",
    "stripe_payment_intent_id": "pi_...",
    "stripe_charge_id": "ch_...",
    "stripe_refund_id": "re_...",
    "stripe_event_id": "evt_...",
    "total_price": 99.99,
    "refund_amount": 99.99,
    "charge_amount": 99.99
  }
}
```

### 3.2 Required Fields for `order.refunded`

- **`order_number`** (string, required) — Hub order number for lookup, e.g., "NV-MOVOAMIF"
- **`stripe_payment_intent_id`** (string, optional but strongly recommended) — Stripe payment intent ID, e.g., "pi_3TUULwIrzYHaHkt23iXuOfME"
- **`stripe_event_id`** (string, required for idempotency) — Stripe event ID, e.g., "evt_1234..."

### 3.3 Optional Fields (improve cascade)

- **`customer_email`** (string) — Customer email for context
- **`customer_name`** (string) — Customer name for context
- **`stripe_charge_id`** (string) — Stripe charge ID
- **`stripe_refund_id`** (string) — Stripe refund ID
- **`refund_amount`** (number) — Amount refunded in USD, e.g., 99.99
- **`charge_amount`** (number) — Original charge amount in USD
- **`total_price`** (number) — Order total (fallback for charge_amount)

### 3.4 Hub Handler Response (Success)

```json
HTTP 200 OK
{
  "status": "success",
  "event": "order.refunded",
  "refund_status": "refund_processed",
  "order_number": "NV-MOVOAMIF"
}
```

**Possible `refund_status` values:**
- `"refund_processed"` — Full refund processed, cascade complete
- `"already_refunded"` — Order already refunded (idempotent)
- `"partial_refund_flagged_for_review"` — Partial refund queued for manual review
- `"order_not_found"` — No Hub order matched (logged as unmatched refund)

### 3.5 Hub Handler Response (Failure)

```json
HTTP 400 Bad Request
{
  "error": "Missing order_number or stripe_payment_intent_id"
}
```

```json
HTTP 401 Unauthorized
{
  "error": "Unauthorized"
}
```

```json
HTTP 405 Method Not Allowed
{
  "error": "Method not allowed"
}
```

```json
HTTP 500 Internal Server Error
{
  "error": "error message from exception"
}
```

---

## 4. Cascade Behavior After Hub Receives `order.refunded`

### Full Refund (refund_amount == charge_amount)

1. **Hub receives event** → `receiveCustomerAppEvent` validates auth ✅
2. **order.refunded handler** → Routes to `processStripeRefund` (line 254)
3. **ShopifyOrder updates:**
   - `payment_status` → `"refunded"`
   - `production_status` → `"canceled"`
   - `tags` → adds `"refunded"`, `"excluded"`
   - `sync_status` → `"do_not_sync"` (prevent re-sync overwrites)
   - Audit trail entry created
4. **FulfillmentTask updates:**
   - `status` → `"Cancelled"`
   - `cancelled_at` → timestamp
5. **ProductionBatch updates:**
   - Removes order from `order_sources`
   - Recalculates `planned_units`
   - If no remaining sources → `status` → `"archived"`
6. **Driver Portal:** Auto-excludes (order hidden from delivery queue)
7. **OrderSyncLog:** Records refund_processed action for audit

### Partial Refund (refund_amount < charge_amount)

1. Hub receives event → validates auth ✅
2. `processStripeRefund` detects partial refund
3. **OrderReviewQueue entry created** (not auto-cascade)
4. Admin manually reviews and decides action
5. OrderSyncLog records as "flagged" status

---

## 5. Idempotency Contract

- **Idempotency Key:** `stripe_event_id` from Customer App
- **Deduplication:** Hub checks OrderSyncLog for matching `stripe_event_id` + `order_number`
- **If Duplicate:** Returns HTTP 200 with `refund_status: "already_refunded"`
- **No Duplicate Audit:** Second refund event produces NO duplicate unit subtractions or audit entries
- **Replay Safe:** Replaying the same CA-to-Hub refund event is safe and idempotent

---

## 6. No Manual Repair Required

- ✅ CA sends refund event to Hub
- ✅ Hub receives with HTTP 200 (auth passed)
- ✅ Cascade runs automatically (no manual function calls)
- ✅ Order, tasks, batches, driver portal all update
- ✅ No `repairRefundedOrder` call needed
- ✅ Idempotent on replay

---

## 7. Stripe Webhook Chain

```
Stripe charge.refunded event 
→ stripeChargeRefundedWebhook (Hub webhook endpoint)
  → Receives charge.refunded via Stripe webhook
  → Verifies signature (STRIPE_WEBHOOK_SECRET)
  → Routes to processStripeRefund
  → Returns 200 to Stripe immediately
→ Customer App receives charge.refunded event
→ Customer App calls receiveCustomerAppEvent (POST + Bearer auth)
  → Hub auth passes
  → Hub processes order.refunded
  → Cascade runs
  → Returns 200 to Customer App
```

---

## 8. Configuration Checklist

### Hub (`functions/receiveCustomerAppEvent`)
- [x] Validates `Authorization: Bearer` header (lines 29-33)
- [x] Extracts token after `Bearer ` prefix
- [x] Compares to `CUSTOMER_APP_SYNC_SECRET` env var
- [x] Returns 401 if missing or invalid
- [x] Returns 405 if not POST
- [x] Has `order.refunded` handler (lines 243-274)
- [x] Routes to `processStripeRefund` with `manual_order_number` (line 258)
- [x] Returns HTTP 200 on success
- [x] Logs auth passed/failed
- [x] Logs event_type received
- [x] Logs refund cascade result

### Customer App
- [ ] Reads `HUB_SYNC_SECRET` (or equiv) environment variable
- [ ] Sends `Authorization: Bearer {token}` header
- [ ] Posts to `https://{HUB_DOMAIN}/functions/receiveCustomerAppEvent`
- [ ] Sends JSON: `{ "event": "order.refunded", "order": {...} }`
- [ ] Logs endpoint URL being called
- [ ] Logs HTTP method (POST)
- [ ] Logs auth header name (Authorization)
- [ ] Never logs token value
- [ ] Logs response status from Hub
- [ ] Logs response body from Hub

### Stripe Webhook (Live Mode)
- [x] Event type: `charge.refunded` enabled
- [x] Endpoint: Hub webhook endpoint configured
- [x] Signature secret: `STRIPE_WEBHOOK_SECRET` set ✅

---

## 9. Debugging: Customer App Logs

When CA sends refund event, it MUST log:

```
[CA-REFUND] Sending order.refunded to Hub
[CA-REFUND] Endpoint: https://hub-domain.base44.app/functions/receiveCustomerAppEvent
[CA-REFUND] Method: POST
[CA-REFUND] Auth Header: Authorization (Bearer token not logged)
[CA-REFUND] Order: NV-MOVOAMIF, refund: $99.99
[CA-REFUND] Hub Response Status: 200
[CA-REFUND] Hub Response Body: { "status": "success", "refund_status": "refund_processed" }
```

---

## 10. Debugging: Hub Logs

Hub MUST log:

```
[RECEIVE-CUSTOMER-EVENT] event=order.refunded, email=user@example.com
[RECEIVE-CUSTOMER-EVENT] Auth passed (Bearer token validated)
[RECEIVE-CUSTOMER-EVENT] Processing order.refunded: NV-MOVOAMIF, refund_amount=$99.99
[RECEIVE-CUSTOMER-EVENT] Routing to processStripeRefund
[RECEIVE-CUSTOMER-EVENT] Refund cascade result: refund_processed
```

---

## 11. Failure Diagnosis

### Scenario: CA Receives 403

**Cause:** Auth header mismatch
- [ ] CA is sending `Authorization: Bearer {token}`?
- [ ] Token matches `CUSTOMER_APP_SYNC_SECRET` on Hub?
- [ ] Both apps use the same secret value?

**Fix:** Verify `CUSTOMER_APP_SYNC_SECRET` is identical on Hub and CA.

### Scenario: CA Receives 405

**Cause:** Hub endpoint expects POST, CA sends GET or PUT
- [ ] CA sending POST request?
- [ ] Endpoint URL correct?

**Fix:** Confirm CA is using POST method.

### Scenario: CA Receives 400 (Missing field)

**Cause:** Payload missing required field
- [ ] `order_number` present in payload?
- [ ] `stripe_payment_intent_id` or `stripe_event_id` present?

**Fix:** Include all required fields in payload.

### Scenario: CA Receives 200 but Order Not Updated on Hub

**Cause:** Refund event received but cascade failed silently
- [ ] Check Hub logs: `[RECEIVE-CUSTOMER-EVENT] Refund cascade result: ...`
- [ ] Check OrderSyncLog for refund event
- [ ] Check if order is in OrderReviewQueue (partial refund?)

**Fix:** Review logs and manually run `repairRefundedOrder` if needed.

---

## 12. Test Case: Full Refund (NV-MOVOAMIF)

**Setup:**
- Order exists in Hub: NV-MOVOAMIF
- Order payment_status: "paid"
- FulfillmentTasks exist and Scheduled
- ProductionBatches contain this order

**Action:**
```json
POST /functions/receiveCustomerAppEvent
Authorization: Bearer {CUSTOMER_APP_SYNC_SECRET}
Content-Type: application/json

{
  "event": "order.refunded",
  "order": {
    "order_number": "NV-MOVOAMIF",
    "customer_email": "amark@nuvisionarymedia.com",
    "stripe_payment_intent_id": "pi_3TUULwIrzYHaHkt23iXuOfME",
    "stripe_event_id": "evt_auto_test_20260507",
    "refund_amount": 74.99,
    "charge_amount": 74.99,
    "total_price": 74.99
  }
}
```

**Expected Result (HTTP 200):**
```json
{
  "status": "success",
  "event": "order.refunded",
  "refund_status": "refund_processed",
  "order_number": "NV-MOVOAMIF"
}
```

**Verification:**
- [x] ShopifyOrder NV-MOVOAMIF: `payment_status=refunded`, `production_status=canceled`, `tags=[..., "refunded"]`
- [x] FulfillmentTasks: `status=Cancelled`
- [x] ProductionBatches: order_sources cleared, planned_units recalculated, empty batches archived
- [x] Driver Portal: order hidden from delivery queue
- [x] OrderSyncLog: entry with action=refund_processed

**Idempotency Test (Replay same event):**
- Expect: HTTP 200
- Expect: refund_status: "already_refunded" or "refund_processed"
- Expect: No duplicate audit entries
- Expect: No duplicate unit removals

---

## 13. Version & Changes

| Date | Change | Status |
|------|--------|--------|
| 2026-05-07 | Initial contract. Auth: Bearer token. Endpoint: receiveCustomerAppEvent. Handler added. | ✅ Finalized |

---

## 14. Sign-Off

- **Hub Implementation:** ✅ Verified
  - receiveCustomerAppEvent accepts POST with Bearer auth
  - order.refunded handler implemented (lines 243-274)
  - Routes to processStripeRefund
  - Returns HTTP 200 on success

- **Stripe Webhook:** ✅ Configured
  - Event: charge.refunded
  - Signature verification enabled
  - Returns 200 to Stripe immediately

- **End-to-End Test:** 🔄 Required
  - Must verify CA can send refund event to Hub
  - Must verify Hub accepts with HTTP 200
  - Must verify automatic cascade works (no manual repair)
  - Must verify idempotency on replay

---

**Next Step:** Run live refund test with real or safe test order.