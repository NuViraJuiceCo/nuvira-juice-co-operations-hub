# Shopify Integration Clean Rebuild Plan

## Current Status
- **Token Issue**: Still using `shpss_*` (proxy/webhook secret) instead of `shpat_*` (Admin API access token)
- **Connection**: Admin API returning 401 Unauthorized
- **Orders**: Cannot pull orders until token is corrected

## Required Actions

### 1. Shopify Custom App Setup
**Location**: Shopify Admin → Settings → Apps and sales channels → Develop apps

**App Name**: "NuVira Hub Core"

**Required Admin API Scopes**:
- `read_orders`
- `read_all_orders` 
- `write_orders`
- `read_products`
- `read_inventory`
- `read_locations`
- `read_customers`

**Installation**: After configuring scopes, click "Install app" to activate them.

### 2. Token Configuration

**Correct Token**:
- **Name**: Admin API access token
- **Format**: `shpat_*` (starts with "shpat_")
- **Length**: ~38-40 characters
- **Location**: Shopify app → API credentials tab → "Admin API access token" → "Reveal token once"

**DO NOT USE**:
- ❌ App Proxy Token (`shpss_*`)
- ❌ Session Token (`shpst_*`)
- ❌ Webhook Signing Secret (`shpss_*`) - this goes in SHOPIFY_WEBHOOK_SECRET only

**Base44 Secret**:
- **Secret Name**: `SHOPIFY_ADMIN_ACCESS_TOKEN`
- **Update Location**: Base44 Dashboard → Settings → Environment Variables

### 3. Verification Steps

After updating the token:

1. **Run Audit**: Visit `/shopify-audit` or click "Re-run Audit"
2. **Check Status**: Should show green checkmark for "Admin API Connectivity"
3. **Verify Orders**: Confirm recent orders are returned (including POS if any exist)
4. **Test POS Sync**: Visit `/pos-validation` and create a test POS order

### 4. Fallback Sync Implementation

**Function**: `syncRecentShopifyOrders`

**Purpose**: Reliable Admin API-based order sync as fallback to webhooks

**Features**:
- Pulls orders from last 48 hours
- Classifies POS vs Online orders automatically
- Creates/updates ShopifyOrder records idempotently
- Tags POS orders with `shopify_pos`
- Excludes POS from fulfillment/production workflows

**Usage**:
- Manual: Admin can trigger from Operations Manager
- Scheduled: Can be set to run every 15-30 minutes via automation

### 5. Webhook Reconfiguration (After Admin API Works)

**Delete old webhooks** pointing to Base44, then create:

1. **Order Creation**: `orders/create` → `shopifyOrderWebhook`
2. **Order Payment**: `orders/paid` → `shopifyOrderWebhook`

**Webhook URL**: Use canonical Base44 production function URL

**Secret**: Use `SHOPIFY_WEBHOOK_SECRET` for HMAC verification

## Acceptance Criteria

- ✅ Shopify Admin API audit passes with HTTP 200
- ✅ `/shop.json` returns shop information
- ✅ Recent orders endpoint returns orders (last 48 hours)
- ✅ POS orders (if any exist) are properly classified
- ✅ Order details include: order_number, source_name, app_id, location_id, financial_status, fulfillment_status, created_at
- ✅ Token format is `shpat_*` (confirmed in audit)

## Next Steps After Token is Fixed

1. Run `auditShopifyConnection` to verify 200 OK
2. Run `syncRecentShopifyOrders` to pull recent orders
3. Verify orders #1001+ appear in Hub Orders page with correct badges
4. Test POS order flow end-to-end
5. Reconfigure webhooks as optimization layer
6. Validate POS orders are excluded from Fulfillment/Production

## Files Updated

- `functions/auditShopifyConnection.js` - Enhanced token format validation
- `functions/syncRecentShopifyOrders.js` - New Admin API sync fallback
- `pages/ShopifyConnectionAudit.jsx` - Improved UI with token format detection
- `pages/ShopifyTokenSetup.jsx` -TokenSetup.jsx` - Step-by-step setup guide
- `docs/SHOPIFY_CLEAN_REBUILD_PLAN.md` - This document

## Critical Reminder

**DO NOT** proceed with webhook debugging until Admin API order pulling works. The Admin API sync is the reliable source of truth; webhooks are just a real-time optimization.