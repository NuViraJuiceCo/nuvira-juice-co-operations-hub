# Quick Reference: Shopify Admin API Token Setup

## 🎯 What You Need

**Token Type**: Admin API Access Token  
**Format**: `shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`  
**Length**: 38-40 characters  

---

## 📍 Where to Find It

1. **Go to**: https://j01hk0-yw.myshopify.com/admin
2. **Navigate**: Settings → Apps and sales channels → Develop apps
3. **Select**: Your app ("NuVira Hub Core")
4. **Tab**: API credentials
5. **Look for**: "Admin API access token" section
6. **Action**: Click "Reveal token once"
7. **Copy**: The entire token (starts with `shpat_`)

---

## ✅ Correct vs ❌ Wrong Tokens

| Token Type | Format | Use For | Correct? |
|------------|--------|---------|----------|
| **Admin API Access Token** | `shpat_*` | Base44 Backend API Calls | ✅ **YES - Use This** |
| Webhook Signing Secret | `shpss_*` | HMAC Verification | ❌ Wrong (use for SHOPIFY_WEBHOOK_SECRET only) |
| App Proxy Token | `shpss_*` | App Proxy Requests | ❌ Wrong |
| Session Token | `shpst_*` | Temporary Sessions | ❌ Wrong |

---

## 🔧 Base44 Configuration

**Secret Name**: `SHOPIFY_ADMIN_ACCESS_TOKEN`  
**Update Location**: Base44 Dashboard → Settings → Environment Variables  

**Other Required Secrets**:
- `SHOPIFY_SHOP_DOMAIN`: `j01hk0-yw.myshopify.com`
- `SHOPIFY_WEBHOOK_SECRET`: (separate 64-char secret for webhook HMAC)

---

## 📋 Required API Scopes

Make sure your Shopify app has these scopes enabled:

- `read_orders` ✅
- `read_all_orders` ✅
- `write_orders` ✅
- `read_products` ✅
- `read_inventory` ✅
- `read_locations` ✅
- `read_customers` ✅

**Note**: After adding scopes, you must **reinstall the app** for them to take effect.

---

## 🧪 Verification

After updating the token:

1. **Visit**: `/shopify-audit` in your Base44 app
2. **Click**: "Re-run Audit"
3. **Check**: 
   - Token prefix shows `shpat_*` ✅
   - Admin API Connectivity: **PASS** ✅
   - Orders API Access: **PASS** ✅
   - Recent orders displayed ✅

---

## 🚨 Common Issues

### Issue: Token starts with `shpss_*`
**Problem**: You copied the Webhook Secret or App Proxy token  
**Solution**: Go back to Shopify app → API credentials → Look for "Admin API access token" (not webhook secret)

### Issue: Token starts with `shpst_*`
**Problem**: You copied a Session token  
**Solution**: You need the permanent Admin API access token, not a temporary session token

### Issue: 401 Unauthorized
**Problem**: Token is invalid, expired, or doesn't have required scopes  
**Solution**: 
1. Verify token starts with `shpat_*`
2. Check app has all required scopes
3. Reinstall the app after adding scopes
4. Generate a fresh token

### Issue: "Access Denied" or "Unauthorized"
**Problem**: Scopes not activated  
**Solution**: After configuring scopes, click "Install app" to activate them

---

## 📞 Need Help?

**Audit Page**: `/shopify-audit` - Shows detailed connection status  
**Setup Guide**: `/shopify-token-setup` - Step-by-step walkthrough  
**Documentation**: `/docs/SHOPIFY_CLEAN_REBUILD_PLAN.md` - Full rebuild plan

---

## ⚡ Quick Checklist

- [ ] Created Shopify custom app named "NuVira Hub Core"
- [ ] Configured all 7 required API scopes
- [ ] Installed/reinstalled the app to activate scopes
- [ ] Copied Admin API access token (starts with `shpat_*`)
- [ ] Updated `SHOPIFY_ADMIN_ACCESS_TOKEN` secret in Base44
- [ ] Verified token format in `/shopify-audit`
- [ ] Confirmed Admin API returns 200 OK
- [ ] Confirmed recent orders are returned
- [ ] Ready to proceed with POS order validation

---

**Last Updated**: 2026-05-15  
**Status**: Token format validation enhanced, sync fallback implemented