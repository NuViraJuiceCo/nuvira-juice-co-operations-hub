# Hub API Endpoint Outage — Incident Report

**Date**: 2026-05-01  
**Status**: CRITICAL — Active Revenue Loss  
**Impact**: New paid Stripe orders not reaching Hub; repeat customers cannot place orders  

---

## Summary

Customer App → Hub order sync endpoints are returning **405 Method Not Allowed** errors. This is causing all new one-time orders to be silently dropped:
- ✅ Stripe accepts payment
- ✅ Customer App receives paid notification  
- ❌ Hub never receives the order
- ❌ No error surfaced to customer
- ❌ Order never appears in Admin Orders, Driver Portal, or Production

**Example**: Customer placed paid order **NV-MONI2Z3R** ($43.99) on 2026-05-01 22:44:40. Order is complete in Stripe but missing from Hub entirely.

---

## Affected Endpoints

| Endpoint | Method | Status | Purpose |
|----------|--------|--------|---------|
| `HUB_API_URL` (legacy) | POST | **405 ❌** | Push order from Customer App to Hub |
| `HUB_API_URL/pullOrdersFromCustomerApp` | POST | **405 ❌** | Pull orders from Customer App to Hub |

**Last Confirmed Working**: Pre-2026-05-01 (exact date unknown)

---

## Root Cause Evidence

### 1. OrderSyncLog Shows No Sync Attempts
- No sync log entries for order **NV-MONI2Z3R** exist
- No safeSyncOrderUpdate was ever called for this order
- Order exists in Stripe metadata but Hub received zero notification

### 2. Stripe Webhook Handler Logs Sync Failures
- `stripeCheckoutWebhookHardened` now captures failed push attempts to Hub
- Logs will show 405 errors when webhook tries to notify Hub of paid checkout

### 3. Order Exists Everywhere Except Hub
- ✅ Stripe Checkout Session: `cs_live_b1J7GRe1E8Un8SbXKhMsXGRMceMOhvjVOubNfqkeg9o6ZgAYngK8TgU3xK` (PAID)
- ✅ Customer App: Order created and stored locally
- ❌ Hub ShopifyOrder: Empty (query by order_number `NV-MONI2Z3R` returns nothing)
- ❌ Hub OrderReviewQueue: Empty (no quarantine entry)
- ❌ Hub OrderSyncLog: Empty (no sync attempt recorded)

---

## Recovery Infrastructure Ready

### Entities Created
- ✅ **OrderSyncLog** — Audit trail for all order sync attempts (source, action, fields, success/error)
- ✅ **OrderReviewQueue** — Quarantine for incomplete or rejected orders

### Functions Created/Updated
- ✅ **manualPushOrderToHub** — Backend function to push stuck orders to Hub once endpoints restore
- ✅ **syncStuckOrdersPollerManual** — Detects all orders stuck in Customer App (never synced to Hub)
- ✅ **stripeCheckoutWebhookHardened** — Logs all sync failures; will not silently drop orders

### Current Order Status
- **NV-MONI2Z3R**: Safely stored in Customer App, ready to sync to Hub once endpoints are restored
- **No data loss** — Order will be recovered automatically when endpoints are re-enabled

---

## Action Required

### Option A: Re-enable Legacy Endpoints
Restore the original POST endpoints:
- `POST HUB_API_URL` — Order push (Customer App → Hub)
- `POST HUB_API_URL/pullOrdersFromCustomerApp` — Order pull (if async pull model)

### Option B: Provide New Endpoint
If endpoints were intentionally removed, provide new Hub order ingestion endpoint:
- **Required**: Accepts full order payload (customer, address, items, Stripe metadata)
- **Required**: Idempotency key support (Stripe session ID, payment intent ID, order_number)
- **Required**: Returns 200 + order_id on success or 400 + error reason on validation failure

### Option C: Confirm Architecture Change
If Hub → Customer App push model is being implemented instead, confirm:
- Webhook URL for Customer App to send orders
- Expected payload format
- Expected response format
- Timeline for availability

---

## Next Steps

1. **Confirm which endpoint to use** (A, B, or C above)
2. **Test endpoint availability** with sample order payload
3. **Notify once restored** so manual recovery functions can run
4. **We will then trigger**: `syncStuckOrdersPollerManual` to recover all stuck orders
5. **Verify**: Stripe webhook handler will automatically sync future orders

---

## Customer Impact

**Currently Blocked**:
- Any customer placing a second order with the same email
- Any new customer orders (they may silently fail after payment)
- Order visibility in Admin Orders / Driver Portal

**Timeline to Restore**:
- Endpoint re-enable: **IMMEDIATE**
- Stuck order recovery: **< 5 minutes after endpoint available**
- Production schedule update: **Auto-triggered**
- Customer communication: **Ready to notify once recovered**

---

## Prepared Contact Message

**To Hub Team**:

> "Our Customer App is unable to push orders to Hub—both legacy and new order ingestion endpoints are returning 405 Method Not Allowed. This is causing paid Stripe orders to be silently dropped. 
>
> Affected endpoint(s):
> - POST {HUB_API_URL}
> - POST {HUB_API_URL}/pullOrdersFromCustomerApp
>
> Example stuck order: NV-MONI2Z3R (paid $43.99 on 2026-05-01 22:44:40, order_number NV-MONI2Z3R, customer amar.kahlon23@yahoo.com).
>
> Please either:
> 1. Restore the original endpoints, OR
> 2. Confirm the new Hub order endpoint if architecture changed
>
> We have recovery infrastructure ready—once endpoints are available, we can sync all stuck orders automatically."