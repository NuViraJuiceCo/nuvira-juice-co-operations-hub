# Shopify Dev Dashboard Token Exchange Flow

## Overview

Shopify has transitioned to a Dev Dashboard authentication model where apps receive **Client ID** and **Client Secret** credentials instead of a one-time static `shpat_*` Admin API token. The Hub must now exchange these client credentials for a temporary access token before making Admin API calls.

## Authentication Flows Supported

The integration now supports **two authentication flows**:

### 1. Client Credentials Flow (New - Recommended)
- **Credentials Required**:
  - `SHOPIFY_CLIENT_ID` (from Shopify Dev Dashboard)
  - `SHOPIFY_CLIENT_SECRET` (from Shopify Dev Dashboard, may start with `shpss_`)
  - `SHOPIFY_SHOP_DOMAIN` (e.g., `j01hk0-yw.myshopify.com`)

- **Token Exchange Endpoint**:
  ```
  POST https://{SHOPIFY_SHOP_DOMAIN}/admin/oauth/access_token
  Content-Type: application/json
  
  {
    "client_id": "SHOPIFY_CLIENT_ID",
    "client_secret": "SHOPIFY_CLIENT_SECRET",
    "grant_type": "client_credentials"
  }
  ```

- **Response**:
  ```json
  {
    "access_token": "shpat_xxxxxxxxxxxxxxxxxxxxx",
    "token_type": "Bearer",
    "expires_in": 86400,
    "scope": "read_orders,read_products,..."
  }
  ```

- **Token Lifetime**: Typically 24 hours (86400 seconds)
- **Refresh Strategy**: Exchange before expiration

### 2. Static Token Flow (Legacy)
- **Credentials Required**:
  - `SHOPIFY_ADMIN_ACCESS_TOKEN` (must start with `shpat_*`)
  - `SHOPIFY_SHOP_DOMAIN`

- **Usage**: Direct Admin API calls with static token
- **Note**: Being phased out by Shopify for new apps

## Updated Functions

### 1. `exchangeShopifyToken.js` (NEW)
**Purpose**: Exchange client credentials for Admin API access token

**Usage**:
```javascript
const response = await base44.functions.invoke('exchangeShopifyToken', {});
// Returns: { access_token, expires_in, scope, obtained_at, expires_at }
```

**Features**:
- Validates client credentials presence
- Performs token exchange with Shopify
- Returns token metadata including expiration
- Admin-only access

### 2. `auditShopifyConnection.js` (UPDATED)
**Purpose**: Comprehensive connectivity audit supporting both flows

**New Features**:
- Detects authentication flow type (`client_credentials` vs `static_token`)
- Performs token exchange automatically when using client credentials
- Validates token exchange success before testing API endpoints
- Shows flow type in audit results

**Audit Results Structure**:
```json
{
  "credentials": {
    "auth_flow": "client_credentials",
    "client_credentials_present": true,
    "static_token_present": false,
    "token_exchange": "SUCCESS",
    "token_expires_in": 86400,
    "token_scope": "read_orders,read_all_orders,..."
  },
  "api_tests": {
    "connectivity": "PASS",
    "orders_access": "PASS"
  },
  "order_samples": {
    "total_fetched": 10,
    "pos_count": 3,
    "online_count": 7
  }
}
```

### 3. `syncRecentShopifyOrders.js` (UPDATED)
**Purpose**: Pull recent orders from Shopify Admin API

**New Features**:
- Supports both client credentials and static token flows
- Automatically exchanges client credentials for access token
- Validates token exchange before fetching orders
- Falls back gracefully if exchange fails

**Usage**:
```javascript
// Manual trigger
const result = await base44.functions.invoke('syncRecentShopifyOrders', {});

// Or via scheduled automation (every 15-30 minutes)
```

## Secrets Configuration

### Required Secrets (Client Credentials Flow)
```
SHOPIFY_SHOP_DOMAIN = j01hk0-yw.myshopify.com
SHOPIFY_CLIENT_ID = 1234567890abcdef
SHOPIFY_CLIENT_SECRET = shpss_xxxxxxxxxxxxxxxxxxxxxxxx  (may start with shpss_)
SHOPIFY_WEBHOOK_SECRET = shpss_xxxxxxxxxxxxxxxxxxxxxxxx  (for webhook HMAC verification)
```

### Optional (Legacy Static Token Flow)
```
SHOPIFY_ADMIN_ACCESS_TOKEN = shpat_xxxxxxxxxxxxxxxxxxxxxxxx
```

**Important**: The `SHOPIFY_CLIENT_SECRET` may start with `shpss_` - this is **NOT** an error. In the new Dev Dashboard flow, this is the expected client secret format.

## Token Management

### Token Exchange Flow
1. Function checks for client credentials presence
2. Calls Shopify token exchange endpoint
3. Receives temporary access token
4. Uses token for Admin API calls
5. Token cached until expiration (optional optimization)

### Token Lifetime
- **Default**: 24 hours (86400 seconds)
- **Refresh**: Exchange 1 hour before expiration
- **Storage**: Can be cached in Base44 secrets or memory

### Error Handling
- **Invalid Credentials**: 401 Unauthorized from Shopify
- **Expired Token**: Exchange again
- **Network Error**: Retry with exponential backoff

## Validation Checklist

After configuring client credentials:

- [ ] Set `SHOPIFY_CLIENT_ID` secret
- [ ] Set `SHOPIFY_CLIENT_SECRET` secret
- [ ] Set `SHOPIFY_SHOP_DOMAIN` secret
- [ ] Run `/shopify-audit` to verify connection
- [ ] Confirm `auth_flow: client_credentials` in results
- [ ] Confirm `token_exchange: SUCCESS`
- [ ] Confirm `connectivity: PASS`
- [ ] Confirm `orders_access: PASS`
- [ ] Verify recent orders returned (including POS if any)
- [ ] Run `syncRecentShopifyOrders` to pull orders
- [ ] Verify POS orders classified correctly

## Migration from Static Token

If you previously used `SHOPIFY_ADMIN_ACCESS_TOKEN`:

1. **Keep existing token** (don't delete yet)
2. **Add client credentials**:
   - Set `SHOPIFY_CLIENT_ID`
   - Set `SHOPIFY_CLIENT_SECRET`
3. **Run audit** - should show `auth_flow: client_credentials`
4. **Verify orders sync** works with new flow
5. **Remove static token** (optional):
   - Delete `SHOPIFY_ADMIN_ACCESS_TOKEN` secret
   - System will now use client credentials exclusively

## POS Order Support

Both flows support POS order detection:

**Classification Criteria**:
- `source_name === 'pos'`
- `channel === 'pos'`
- `location_id` present
- `app_id` matches known POS apps (`131`, `131313`, `com.jadedpixel.pos`)

**POS Order Handling**:
- Tagged with `shopify_pos`
- Excluded from fulfillment workflows
- Marked as `production_status: not_required`
- Visible in Orders page with POS badge

## Troubleshooting

### Token Exchange Fails (401 Unauthorized)
**Cause**: Invalid Client ID or Client Secret  
**Solution**: 
1. Verify credentials in Shopify Dev Dashboard
2. Ensure app is installed for the shop
3. Check app has required scopes

### No Orders Returned
**Cause**: Missing scopes or wrong shop domain  
**Solution**:
1. Verify `read_orders` and `read_all_orders` scopes
2. Confirm shop domain is correct
3. Check if orders exist in last 48 hours

### POS Orders Not Detected
**Cause**: POS app not properly configured  
**Solution**:
1. Verify POS app uses same Shopify shop
2. Check POS order source_name field
3. Run audit to see POS classification logic

## Next Steps

After token exchange is working:

1. **Automate Sync**: Set up scheduled automation for `syncRecentShopifyOrders` (every 15-30 min)
2. **Configure Webhooks**: Register Shopify webhooks for real-time updates (optional optimization)
3. **Monitor Token Expiry**: Add logging for token exchange timestamps
4. **Test POS Flow**: Create test POS order and verify classification

## Documentation References

- `/shopify-audit` - Run connectivity audit
- `/shopify-token-setup` - Setup guide (being updated)
- `/pos-validation` - Validate POS order flow
- `docs/SHOPIFY_CLEAN_REBUILD_PLAN.md` - Original rebuild plan
- `docs/SHOPIFY_TOKEN_QUICK_REFERENCE.md` - Quick reference (legacy)

---

**Last Updated**: 2026-05-15  
**Status**: Client credentials flow implemented and tested