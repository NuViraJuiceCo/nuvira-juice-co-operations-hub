# Customer App Order Ingestion Endpoint Specification

**Status**: READY FOR HUB DEPLOYMENT  
**Date**: 2026-05-01  
**Priority**: CRITICAL — Blocking paid order sync  

---

## Endpoint Details

### URL
```
POST /safeSyncOrderUpdate
OR
POST /ingestCustomerAppOrder
```

### Authentication
```
Header: Authorization: Bearer {CUSTOMER_APP_SYNC_SECRET}
```

**Note**: `CUSTOMER_APP_SYNC_SECRET` is a shared secret between Customer App and Hub. Must be configured in both environments.

---

## Request Body Schema

```json
{
  "order_number": "NV-MONI2Z3R",
  "order_intent_id": "intent_abc123_customer_app_internal_id",
  "customer_name": "Amar Kahlon",
  "customer_email": "amar.kahlon23@yahoo.com",
  "customer_phone": "+1-555-1234",
  "address_line1": "206 West Pine Creek Ct",
  "address_line2": "Apt 5",
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
  "delivery_notes": "Leave at front door",
  "customer_notes": "Please ring doorbell",
  "requested_delivery_date": "2026-05-02"
}
```

### Required Fields
- `order_number` — Unique display order number (e.g., NV-MONI2Z3R)
- `customer_email` — Customer email address
- `line_items` — Array of {title, quantity, price}; must have at least one item
- `total_price` — Order total (must be > 0)
- `payment_status` — Must be "paid"
- **At least one idempotency key**:
  - `stripe_checkout_session_id` (preferred)
  - `stripe_payment_intent_id` (acceptable)
  - `order_intent_id` (fallback)

### Optional Fields
- `customer_name`
- `customer_phone`
- `address_*` (all address fields)
- `delivery_fee`
- `subtotal`
- `stripe_customer_id`
- `fulfillment_method`
- `delivery_notes`
- `customer_notes`
- `requested_delivery_date`

---

## Response Schema

### Success (201 or 200)
```json
{
  "status": "success",
  "action": "created",
  "order_id": "69f5260768ac99c6629a0360",
  "order_number": "NV-MONI2Z3R"
}
```

**Fields**:
- `status`: "success"
- `action`: "created" (new order) or "updated" (existing order matched)
- `order_id`: Hub ShopifyOrder entity ID
- `order_number`: Echo of input order_number

### Idempotent Re-submission (200)
If the exact same order is submitted twice (same Stripe session/intent), the second request is idempotent:
```json
{
  "status": "success",
  "action": "duplicate_skipped",
  "order_id": "69f5260768ac99c6629a0360",
  "order_number": "NV-MONI2Z3R",
  "reason": "Idempotent duplicate — order already synced"
}
```

### Validation Failed (400)
```json
{
  "status": "rejected",
  "reason": "validation_failed",
  "errors": [
    "customer_email required",
    "line_items required (non-empty array)"
  ]
}
```

### Order Rejected by safeSyncOrderUpdate (422)
```json
{
  "status": "rejected",
  "reason": "unknown_quality_would_overwrite_verified_order",
  "order_number": "NV-MONI2Z3R"
}
```

**Possible reasons**:
- `unknown_quality_would_overwrite_verified_order` — Data too incomplete
- `missing_email_for_new_order` — No customer email
- `low_quality_new_order_score_*` — Incomplete data
- `delivery_order_missing_address` — No delivery address
- etc. (see safeSyncOrderUpdate documentation)

### Server Error (500)
```json
{
  "status": "error",
  "reason": "server_error",
  "message": "Error details"
}
```

---

## Idempotency Rules

### Same Customer CAN Place Multiple Orders
- Customer email address **is NOT** an idempotency key
- Same customer email + different Stripe session = **separate orders**
- Each order must have a unique `order_number`
- Each order must have a unique Stripe Session or Intent ID

### Example: Two Orders, Same Customer
```
Order 1:
  - customer_email: amar.kahlon23@yahoo.com
  - order_number: NV-MONGOVGM
  - stripe_checkout_session_id: cs_live_abc123...
  - Result: ✅ Created as order 1

Order 2:
  - customer_email: amar.kahlon23@yahoo.com (SAME EMAIL)
  - order_number: NV-MONI2Z3R (DIFFERENT ORDER NUMBER)
  - stripe_checkout_session_id: cs_live_def456... (DIFFERENT SESSION)
  - Result: ✅ Created as separate order 2 (NOT merged with order 1)
```

### Idempotency Key Priority
1. `stripe_checkout_session_id` — Primary (from Stripe checkout flow)
2. `stripe_payment_intent_id` — Secondary (if using payment intent API)
3. `order_intent_id` — Fallback (Customer App internal ID)
4. `order_number` — Last resort (for non-Stripe orders)

---

## Data Quality & Validation Rules

### Minimum Quality for New Orders
- Must have customer name OR email (at least one identifier)
- Must have at least one line item
- Must have order total > 0
- Must have Stripe payment complete (payment_status = "paid")
- Recommended: Complete delivery address (if delivery)

### Address Requirements for Delivery Orders
- If `fulfillment_method` is "delivery", full address is required:
  - `address_line1`
  - `address_city`
  - `address_state`
  - `address_postal_code`
- If address is missing, order may be quarantined to OrderReviewQueue

### Fulfillment Auto-Detection
- If no `fulfillment_mode` provided, defaults to "single_delivery"
- If no `order_type` provided, defaults to "one_time"

---

## Integration with safeSyncOrderUpdate

This endpoint is a **thin authentication + validation layer** that routes to `safeSyncOrderUpdate`.

All business logic flows through safeSyncOrderUpdate:
- ✅ Order lock status enforcement
- ✅ Field ownership validation
- ✅ Idempotency checking
- ✅ Subscription protection (if applicable)
- ✅ Unknown quality detection
- ✅ OrderReviewQueue quarantine
- ✅ OrderSyncLog audit trail

**No competing sync paths** — this is the single canonical Customer App ingestion route.

---

## Deployment Checklist

- [ ] Create or enable POST endpoint (URL: `/safeSyncOrderUpdate` or `/ingestCustomerAppOrder`)
- [ ] Configure `CUSTOMER_APP_SYNC_SECRET` environment variable in Hub
- [ ] Share `CUSTOMER_APP_SYNC_SECRET` with Customer App team (they already have it set)
- [ ] Test endpoint with sample order payload (see test example below)
- [ ] Verify 401 response if Authorization header is missing or invalid
- [ ] Verify 200 response with successful ingestion
- [ ] Verify idempotent duplicate submissions return 200 (not 409 or error)
- [ ] Verify OrderSyncLog entries are created for each request
- [ ] Load-test with Customer App production traffic pattern
- [ ] Enable monitoring/alerting for 4xx/5xx response rates
- [ ] Notify Customer App team when endpoint is live

---

## Test Request Example

```bash
curl -X POST https://hub-api.example.com/safeSyncOrderUpdate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {CUSTOMER_APP_SYNC_SECRET}" \
  -d '{
    "order_number": "NV-MONI2Z3R",
    "customer_name": "Amar Kahlon",
    "customer_email": "amar.kahlon23@yahoo.com",
    "customer_phone": "+1-6366976028",
    "address_line1": "206 West Pine Creek Ct",
    "address_city": "O'\''Fallon",
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
    "stripe_checkout_session_id": "cs_live_b1J7GRe1E8Un8SbXKhMsXGRMceMOhvjVOubNfqkeg9o6ZgAYngK8TgU3xK",
    "stripe_payment_intent_id": "pi_1234567890abcdef",
    "payment_status": "paid",
    "fulfillment_method": "delivery"
  }'
```

**Expected Response** (201 or 200):
```json
{
  "status": "success",
  "action": "created",
  "order_id": "69f5260768ac99c6629a0360",
  "order_number": "NV-MONI2Z3R"
}
```

---

## Monitoring & Alerting

### Metrics to Track
- Request volume (orders/min from Customer App)
- Success rate (200/201 responses)
- Rejection rate (400/422 responses)
- Error rate (500 responses)
- Latency (p50, p95, p99)
- OrderReviewQueue backlog (orders in quarantine)

### Alert Thresholds
- Error rate > 5% — Page on-call
- Latency p99 > 5s — Warning
- Rejections > 10% of traffic — Investigate quality issues
- 401s from Customer App — Check auth token/secret

---

## Customer App Configuration (Reference)

Customer App must:
1. Have `CUSTOMER_APP_SYNC_SECRET` set (shared with Hub)
2. POST paid order payloads to this endpoint after Stripe payment completes
3. Include `Authorization: Bearer {CUSTOMER_APP_SYNC_SECRET}` header
4. Handle 200/201 success responses
5. Handle 400/422 rejection responses (order queued for admin review)
6. Handle 500 error responses (retry with exponential backoff)
7. Log all requests/responses to OrderSyncLog equivalent on Customer App side

---

## Rollback Plan

If this endpoint causes issues:
1. Disable the endpoint (return 503 Service Unavailable)
2. Customer App will see 503 and can retry or queue locally
3. No data loss — orders remain in Customer App cache
4. Once fixed, re-enable and sync via manual recovery function

---

## Questions?

- **Missing endpoint?** Contact Hub DevOps — endpoint needs to be created/enabled
- **Auth token issues?** Verify `CUSTOMER_APP_SYNC_SECRET` matches between Hub and Customer App
- **Data schema?** See Request Body Schema section above
- **Idempotency questions?** See Idempotency Rules section — email is NOT a key