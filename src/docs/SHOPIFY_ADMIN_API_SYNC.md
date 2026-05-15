# Shopify POS Order Sync — Implementation Complete

## Overview
Implemented a reliable pull-based fallback for ingesting Shopify POS orders via Shopify Admin API, eliminating dependency on unreliable webhook delivery.

## What Was Built

### 1. Backend Function: `syncRecentShopifyOrders`
**Location:** `functions/syncRecentShopifyOrders`

**Purpose:** Pull recent Shopify orders via Admin API and ingest missing POS orders into Hub.

**Authentication:** 
- Admin users only, OR
- Scheduled/internal runs with `INTERNAL_FUNCTION_SECRET`

**Inputs:**
```json
{
  "created_at_min": "-24h",  // ISO timestamp or relative (e.g., "-24h", "-2d")
  "limit": 50,               // Max orders to fetch
  "source": "pos"            // "pos" | "all" (filter by order type)
}
```

**Behavior:**
- Calls Shopify Admin API: `GET /admin/api/2024-04/orders.json`
- Fetches orders from all sales channels
- Detects POS orders by: `source_name='pos'`, `app_id`, `location_id`, `fulfillment_service`
- Creates/updates `ShopifyOrder` records with POS classification:
  - `source_type: "shopify_pos"`
  - `payment_status: "paid"` (mapped from financial_status)
  - `fulfillment_status: "fulfilled"`
  - `production_status: "not_required"`
  - `order_lock_status: "fulfilled"`
  - No delivery address required
  - Tags: `['pos_sale', 'event_sale', 'no_delivery', 'no_production', 'api_sync']`
- Idempotent: Updates existing orders, never creates duplicates
- Logs: `synced_count`, `created_count`, `updated_count`, `skipped_count`, `pos_count`, `online_count`, `errors`

**Secrets Required:**
- `SHOPIFY_SHOP_DOMAIN` (e.g., `mystore.myshopify.com`)
- `SHOPIFY_ADMIN_ACCESS_TOKEN` (private app or custom app token)

---

### 2. UI: POS Validation Page Enhancement
**Location:** `pages/POSValidation`

**New Feature:** "Sync Recent Shopify POS Orders" button

**What It Does:**
- Pulls POS orders from last 24 hours
- Shows real-time sync progress
- Displays results: found/created/updated/skipped counts
- Tracks last sync timestamp
- Pre-fills order number for validation if test ingestion runs

**User Flow:**
1. Click "Sync Recent POS Orders"
2. Wait for sync to complete (~5-10 seconds)
3. View results summary
4. Search for synced order by number
5. Run auto-validation checklist

---

## Configuration Required

### Shopify Admin API Access

**Option A: Custom App (Recommended)**
1. Go to **Shopify Admin → Settings → Apps and sales channels**
2. Click **Develop apps for your store**
3. Click **Create an app**
4. Name: "NuVira Hub Sync"
5. Configure **Admin API integration**:
   - **Orders**: `read` access
   - **Products**: `read` access (optional)
   - **Customers**: `read` access (optional)
6. Save and **Install app**
7. Copy **Admin API access token**

**Option B: Private App (Legacy)**
1. Go to **Shopify Admin → Settings → Apps and sales channels**
2. Click **Develop apps** (if available)
3. Create private app with Orders read access
4. Copy access token

### Update Secrets

The following secrets are now configured:
- ✅ `SHOPIFY_SHOP_DOMAIN` — Set to your shop domain
- ✅ `SHOPIFY_ADMIN_ACCESS_TOKEN` — Set to your API token

**Verify Configuration:**
```bash
# Test the API manually
curl -X GET "https://{SHOPIFY_SHOP_DOMAIN}/admin/api/2024-04/orders.json?limit=1" \
  -H "X-Shopify-Access-Token: {SHOPIFY_ADMIN_ACCESS_TOKEN}"
```

---

## Testing Checklist

### Test Case 1: Sync Recent POS Orders
- [ ] Run `syncRecentShopifyOrders` with `created_at_min: "-24h"`, `source: "pos"`
- [ ] Confirm response shows `success: true`
- [ ] Verify `pos_count > 0` if POS orders exist
- [ ] Check `created_count + updated_count` matches expected
- [ ] Review `errors` array (should be empty)

### Test Case 2: Verify Order Creation
- [ ] Search for a synced POS order in Hub (Orders page)
- [ ] Confirm order has:
  - [ ] `source_type: "shopify_pos"`
  - [ ] `payment_status: "paid"`
  - [ ] `fulfillment_status: "fulfilled"`
  - [ ] `production_status: "not_required"`
  - [ ] Tags include `pos_sale`, `api_sync`
  - [ ] No delivery address (blank fields)

### Test Case 3: Idempotency
- [ ] Run sync again for same time period
- [ ] Confirm `created_count: 0` (no duplicates)
- [ ] Confirm `updated_count` reflects status updates only
- [ ] Verify no duplicate orders in Hub

### Test Case 4: UI Validation
- [ ] Go to `/pos-validation` page
- [ ] Click "Sync Recent POS Orders"
- [ ] Verify sync completes without errors
- [ ] Check "Last sync" timestamp updates
- [ ] Search for synced order
- [ ] Run auto-validation checklist
- [ ] Confirm all POS checks pass

### Test Case 5: Operational Isolation
- [ ] Confirm POS order does NOT appear in Fulfillment queue
- [ ] Confirm POS order does NOT appear in Production Planning demand
- [ ] Confirm POS order DOES appear in Reporting revenue

---

## Production Usage

### Manual Sync (On-Demand)
Use the POS Validation page UI to trigger syncs as needed.

### Scheduled Sync (Recommended)
Create a scheduled automation to run every 6 hours:

```javascript
// Automation configuration (to be created in Dashboard)
{
  "automation_type": "scheduled",
  "name": "Shopify POS Order Sync",
  "function_name": "syncRecentShopifyOrders",
  "repeat_interval": 6,
  "repeat_unit": "hours",
  "function_args": {
    "created_at_min": "-6h",
    "limit": 100,
    "source": "pos"
  }
}
```

**Note:** The function accepts `INTERNAL_FUNCTION_SECRET` header for scheduled runs, so no user authentication is required.

---

## Error Handling

### Common Errors

**401 Unauthorized**
- Cause: Invalid `SHOPIFY_ADMIN_ACCESS_TOKEN` or `SHOPIFY_SHOP_DOMAIN`
- Fix: Re-check token in Shopify Admin → Apps

**404 Not Found**
- Cause: Wrong API version or shop domain
- Fix: Verify domain format (`mystore.myshopify.com`, not `https://...`)

**Rate Limiting**
- Shopify Admin API allows 2 requests/second (leaky bucket)
- Function uses `limit` parameter to control batch size
- For large syncs, use multiple runs with different time windows

**Missing Orders**
- If orders exist in Shopify but not synced:
  - Check `created_at_min` window (may be outside range)
  - Verify order status (archived orders excluded by default)
  - Check function logs for specific error messages

---

## Comparison: Webhooks vs. Admin API Sync

| Feature | Webhooks | Admin API Sync |
|---------|----------|----------------|
| **Latency** | Real-time (<1s) | Delayed (sync interval) |
| **Reliability** | Depends on delivery | Deterministic (pull-based) |
| **Setup Complexity** | Medium (URL, HMAC) | Low (API token) |
| **Backfill Capability** | No (forward-only) | Yes (any time window) |
| **Idempotency** | Manual | Built-in |
| **Error Recovery** | Retry queue | Re-run sync |
| **Best For** | Real-time updates | Reconciliation, fallback |

**Recommendation:** Use both. Webhooks for real-time, Admin API sync for reliability and backfill.

---

## Next Steps

1. **Configure Shopify API credentials** (if not already done)
2. **Test sync function** with 24-hour window
3. **Verify POS orders** appear correctly in Hub
4. **Create scheduled automation** for regular syncs (optional)
5. **Monitor sync logs** for errors or missing orders

---

## Support

**Function Logs:** Dashboard → Code → Functions → `syncRecentShopifyOrders` → Logs

**Shopify API Docs:** https://shopify.dev/docs/api/admin-rest

**Troubleshooting:** Check `errors` array in sync response for specific order-level failures.