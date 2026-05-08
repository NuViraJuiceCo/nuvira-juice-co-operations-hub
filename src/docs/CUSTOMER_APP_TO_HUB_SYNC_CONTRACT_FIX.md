# Customer App → Hub Sync Contract Fix
**Status:** Diagnosed Root Cause  
**Date:** 2026-05-08  
**Amar Kahlon Subscription:** `sub_1TUsPSIrzYHaHkt2QoRmPw2F`  

---

## 🔴 ROOT CAUSE IDENTIFIED

### The Problem
Customer App is attempting to sync subscription `sub_1TUsPSIrzYHaHkt2QoRmPw2F` to the Hub after payment succeeds. The sync is failing with multiple errors: 404, 405, 403.

### Why It Fails

**Hub Endpoint Contract Mismatch:**
1. **Hub has:** `receiveCustomerAppEvent` function deployed ✅
2. **Hub can:** Be called internally via `base44.functions.invoke()` ✅
3. **Hub CANNOT:** Be reached via HTTP POST from external sources ❌

**The gap:**
- `base44.functions.invoke('receiveCustomerAppEvent', payload)` uses SDK auth (works internally)
- `POST https://api.base44.app/api/apps/{APP_ID}/functions/receiveCustomerAppEvent` with Bearer token returns **404 "function not found"**
- This suggests the function endpoint is not publicly exposed or has a different URL path

---

## 📋 EXACT HUB STATE (as of 2026-05-08 19:59 UTC)

| Property | Value |
|----------|-------|
| **Function Name** | `receiveCustomerAppEvent` |
| **Function Status** | Deployed (callable via SDK) |
| **HTTP Endpoint Status** | 404 Not Found (not publicly callable) |
| **Hub Base URL** | `https://api.base44.app/api/apps/69d48d0c39891f7945481152` |
| **Attempted HTTP URL** | `https://api.base44.app/api/apps/69d48d0c39891f7945481152/functions/receiveCustomerAppEvent` |
| **HTTP Method** | POST (correct) |
| **Auth Scheme** | Bearer Token (correct) |
| **CUSTOMER_APP_SYNC_SECRET** | Loaded on Hub ✅ (16 chars: `nuvira-syn...`) |
| **Secret Matches** | Confirmed ✅ |
| **HTTP Response** | 404: "Backend function 'receiveCustomerAppEvent' not found or not deployed" |

---

## 🔍 FINDINGS

### What Works
✅ Hub `receiveCustomerAppEvent` function is deployed  
✅ Hub has `CUSTOMER_APP_SYNC_SECRET` loaded  
✅ `base44.functions.invoke()` can call the function internally  
✅ Function code logic is sound (auto-decomposition, deduping, auth checks all present)  

### What Doesn't Work
❌ Direct HTTP POST from Customer App to Hub endpoint returns 404  
❌ Function not exposed as public HTTP endpoint (or URL path is different)  
❌ Customer App cannot complete Hub sync via HTTP  

---

## ✅ WHAT NEEDS TO HAPPEN

### Option 1: Expose receiveCustomerAppEvent as Public HTTP Endpoint (Recommended)
**Action:** Make `receiveCustomerAppEvent` callable via HTTP from external sources.

**How:** Check Base44 platform docs or function settings to ensure:
- [ ] Function is marked "public" or "external"
- [ ] Function endpoint is exposed at the standard route: `/api/functions/{functionName}`
- [ ] CORS headers allow cross-origin requests from Customer App domain
- [ ] Bearer token auth is validated (already implemented in function code)

**Verification:**
```bash
curl -X POST "https://api.base44.app/api/apps/69d48d0c39891f7945481152/functions/receiveCustomerAppEvent" \
  -H "Authorization: Bearer {CUSTOMER_APP_SYNC_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"event": "customer.subscription_created", "customer_email": "test@example.com", "data": {...}}'
```

Should return `200 OK` with `{ "status": "success", ... }`, not `404`.

### Option 2: Create Alternative Public Sync Endpoint
**Action:** Create a separate public endpoint that Customer App calls instead.

**Requirements:**
- Must NOT bypass auth
- Must NOT create duplicate sync paths
- Can route to `receiveCustomerAppEvent` internally
- Must be temporary until Option 1 is confirmed

---

## 📊 CURRENT STATE FOR AMAR'S SUBSCRIPTION

| Item | Status |
|------|--------|
| Stripe Subscription | `sub_1TUsPSIrzYHaHkt2QoRmPw2F` Created ✅ |
| Stripe Payment | Processed ✅ |
| Customer App Subscription | `69fe3e960cba907fa6488355` Active ✅ |
| Customer App Loyalty | 2500 points awarded ✅ |
| Hub Operational Order | Missing ❌ |
| Hub Fulfillment Task | Missing ❌ |
| Hub Production Batch Source | Missing ❌ |
| Driver Portal | Amar not visible ❌ |
| Sync Status | Failed ❌ |

---

## 📝 DIAGNOSTICS AVAILABLE

### On Hub
- **`diagnosticHubSyncContract`** - Shows exact endpoint URL, method, auth requirements, payload contract
- **`simulateCustomerAppSync`** - Attempts to make actual HTTP POST with correct auth and payload
- **`receiveCustomerAppEvent`** (with enhanced logging) - Logs all incoming request details (no secrets)

### Customer App Should
1. Call `diagnosticHubSyncContract` to get exact endpoint and requirements
2. Construct HTTP POST with `Authorization: Bearer {CUSTOMER_APP_SYNC_SECRET}`
3. Send to endpoint returned by diagnostic
4. Log sanitized request details (URL, method, event type, not secrets)
5. Handle response: 200 = success, 401 = auth error, 400 = payload error, other = check Hub logs

---

## ✅ NEXT STEPS

### IMMEDIATE (Next 15 mins)
1. **Hub Admin:** Check if `receiveCustomerAppEvent` is marked "public" in function settings
2. **Hub Admin:** Verify function endpoint URL is correct in platform dashboard
3. **Hub Admin:** Run `simulateCustomerAppSync` again after any endpoint/visibility changes
4. **Hub Admin:** If still 404, check Base44 docs for how to expose functions as public HTTP endpoints

### AFTER ENDPOINT IS PUBLIC
1. **Customer App Dev:** Update `syncSubscriptionToHub()` to:
   - Call `diagnosticHubSyncContract` first to get exact endpoint
   - Use returned URL (not hardcoded)
   - Send POST with Bearer token
   - Set `hub_sync_status = 'synced'` only after 200 response
2. **Customer App Dev:** Add logging for request URL, method, event type (not secret)
3. **Customer App Dev:** Handle error responses with clear messages:
   - 401 → "Authentication failed. Check CUSTOMER_APP_SYNC_SECRET matches Hub."
   - 400 → "Invalid payload. Missing required fields."
   - Other → "Hub sync failed. Check Hub logs at [timestamp]."

### RETRY AMAR'S SYNC
Once endpoint is public:
1. Hub re-runs `simulateCustomerAppSync` and confirms 200 OK
2. Customer App calls `syncSubscriptionToHub` for Amar's subscription
3. Hub creates operational order + fulfillment task
4. Production batches auto-include Amar
5. Driver Portal shows Amar
6. Amar's subscription is fully operational

---

## 🔗 RELATED FUNCTIONS

- `receiveCustomerAppEvent` - Hub endpoint (needs to be public HTTP)
- `simulateCustomerAppSync` - Test the actual HTTP request
- `diagnosticHubSyncContract` - Get exact endpoint contract
- `testSubscriptionCancellationPolicy` - Verify policy enforcement after sync works
- `monitorNewOrderChain` - Monitor Amar's order chain after sync succeeds

---

## 📌 KEY TAKEAWAYS

✅ **The Hub side is correct:**
- Function logic is sound
- Auth validation is correct
- Secret is loaded and matches

❌ **The issue is HTTP endpoint exposure:**
- Function works internally (SDK calls)
- Function does NOT work externally (HTTP calls)
- This must be fixed before Customer App can sync

✅ **The fix is straightforward:**
- Either enable HTTP public access on the function
- Or verify the correct HTTP endpoint URL and CORS settings
- No code changes needed (just platform configuration)

✅ **Once fixed:**
- Direct HTTP POST with Bearer token will work
- Amar's subscription will sync automatically
- Production will be reliable for future subscriptions