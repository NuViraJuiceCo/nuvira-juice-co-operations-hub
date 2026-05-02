# Customer App → Hub Integration Guide
## receiveDriverStatusUpdate Endpoint Configuration

**Status**: 🔴 **CRITICAL: ENDPOINT NOT YET CALLED BY CUSTOMER APP**
**Resolution Date**: 2026-05-02
**Action Required**: Customer App must configure Driver Portal to invoke this endpoint

---

## QUICK START: Exact Integration Steps

### Step 1: Get the Secret
Contact Hub Admin to retrieve `CUSTOMER_APP_SYNC_SECRET` from:
```
Hub Dashboard → Settings → Secrets → Environment Variables
```

### Step 2: Configure Driver Portal
When driver confirms delivery in Customer App, call:

```
POST https://{HUB_BASE_URL}/functions/receiveDriverStatusUpdate
```

With headers:
```
Authorization: Bearer {CUSTOMER_APP_SYNC_SECRET}
Content-Type: application/json
```

### Step 3: Send Delivery Payload
```json
{
  "order_number": "NV-MON7CNYB",
  "driver_email": "driver@nuvira.local",
  "action": "delivered",
  "delivery_photo_url": "https://storage.example.com/delivery.jpg",
  "delivery_drop_location": "Front porch",
  "delivery_notes": "Left on porch as requested"
}
```

### Step 4: Check Response
Success = `200 OK` with:
```json
{
  "status": "success",
  "order_number": "NV-MON7CNYB",
  "action": "delivered",
  "sync_result": "accepted"
}
```

---

## Integration Code Example (JavaScript)

### Driver Portal Delivery Handler
```javascript
import axios from 'axios';

const HUB_BASE_URL = process.env.HUB_API_URL; // e.g., https://hub.nuvira.io
const CUSTOMER_APP_SYNC_SECRET = process.env.CUSTOMER_APP_SYNC_SECRET;

export async function confirmDelivery(order, photoUrl, dropLocation, notes) {
  try {
    const payload = {
      order_number: order.order_number,
      driver_email: order.assigned_driver?.email || 'driver@nuvira.local',
      action: 'delivered',
      delivery_photo_url: photoUrl,
      delivery_drop_location: dropLocation,
      delivery_notes: notes,
    };

    const response = await axios.post(
      `${HUB_BASE_URL}/functions/receiveDriverStatusUpdate`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.status === 200 && response.data.status === 'success') {
      // Update local order state to reflect delivery
      order.status = 'delivered';
      order.delivered_at = new Date().toISOString();
      return { success: true, message: 'Delivery confirmed in Hub' };
    } else {
      return { success: false, error: response.data.error };
    }
  } catch (error) {
    if (error.response?.status === 404) {
      return { success: false, error: `Order ${order.order_number} not found in Hub (sync delay?)` };
    } else if (error.response?.status === 401) {
      return { success: false, error: 'Invalid authentication with Hub' };
    } else {
      return { success: false, error: `Hub error: ${error.message}` };
    }
  }
}

export async function markUnableToDeliver(order, reason, notes) {
  try {
    const payload = {
      order_number: order.order_number,
      driver_email: order.assigned_driver?.email || 'driver@nuvira.local',
      action: 'unable_to_deliver',
      unable_reason: reason, // e.g., 'customer_not_home', 'wrong_address', etc.
      delivery_notes: notes,
    };

    const response = await axios.post(
      `${HUB_BASE_URL}/functions/receiveDriverStatusUpdate`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.status === 200 && response.data.status === 'success') {
      order.status = 'unable_to_deliver';
      return { success: true, message: 'Unable-to-deliver recorded in Hub' };
    } else {
      return { success: false, error: response.data.error };
    }
  } catch (error) {
    return { success: false, error: `Hub error: ${error.message}` };
  }
}
```

### Retry Logic (Idempotent)
```javascript
async function confirmDeliveryWithRetry(order, photoUrl, dropLocation, notes, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await confirmDelivery(order, photoUrl, dropLocation, notes);
      if (result.success) {
        console.log(`[DELIVERY] Order ${order.order_number} confirmed in Hub (attempt ${attempt})`);
        return result;
      }
      lastError = result.error;
    } catch (error) {
      lastError = error.message;
    }
    
    // Exponential backoff before retry
    if (attempt < maxRetries) {
      const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  return { success: false, error: `Failed after ${maxRetries} attempts: ${lastError}` };
}
```

---

## Current Status Report (2026-05-02)

### Verified Today's Orders ✅ DELIVERED IN HUB

| Order Number | Customer | Status | delivered_at | Task | Audit Log |
|--------------|----------|--------|--------------|------|-----------|
| **NV-MON7CNYB** | Jesse Kahlon | ✅ Fulfilled | 2026-05-02T20:27:18Z | ✅ Complete | ✅ Created |
| **NV-MOILSACV** | Danyelle #1 | ✅ Fulfilled | 2026-05-02T20:27:18Z | ✅ Complete | ✅ Created |
| **NV-MOILVI17** | Danyelle #2 | ✅ Fulfilled | 2026-05-02T20:27:18Z | ✅ Complete | ✅ Created |
| **NV-MOF1S04J** | Parminder | ✅ Fulfilled | 2026-05-02T20:27:18Z | ✅ Complete | ✅ Created |
| **NV-MODIHVQQ** | Zach Rootz | ✅ Fulfilled | 2026-05-02T20:27:18Z | ✅ Complete | ✅ Created |
| **NV-MON367R7** | Deepa Jaswal | ✅ Not Delivered (correct) | — | Scheduled | — |

**Verification**: Route optimization **EXCLUDES** all 5 delivered orders. They do **NOT** reappear in `optimizeDeliveryRoute` responses.

---

### Pending/Missing Orders Status

#### NV-MONL4I2M (Amar Kahlon)
- ✅ **FOUND IN HUB**
- Payment Status: **PENDING** (not yet paid)
- Production Status: `new`
- Data Quality: **complete**
- **In Review Queue**: Yes (32 entries, all `missing_customer_info` type)
- **Issue**: Order missing delivery address at both parent and fulfillment levels
- **Action Required**: Cannot enter Driver Portal until address is provided
- **Recommendation**: Manual review & address entry or contact customer

#### NV-MOOPFCUS
- ❌ **NOT FOUND IN HUB**
- Stripe Events: 0 found
- **Recommendation**: Investigate if order was created in Customer App; if yes, check Stripe sync logs for creation event

---

## Endpoint Specification (Complete Reference)

### URL & Method
```
POST /functions/receiveDriverStatusUpdate
```

### Headers Required
```
Authorization: Bearer {CUSTOMER_APP_SYNC_SECRET}
Content-Type: application/json
```

### Payload Schema

#### Delivered Action
```json
{
  "order_number": "string (required)",
  "order_id": "string (optional, fallback to order_number)",
  "driver_email": "string (optional, defaults to 'driver')",
  "action": "delivered (required)",
  "delivery_photo_url": "string (required)",
  "delivery_drop_location": "string (recommended)",
  "delivery_notes": "string (optional)"
}
```

#### Unable to Deliver Action
```json
{
  "order_number": "string (required)",
  "driver_email": "string (optional)",
  "action": "unable_to_deliver (required)",
  "unable_reason": "string: 'customer_not_home' | 'wrong_address' | 'access_issue' | 'refused_delivery' | 'other' (required)",
  "delivery_notes": "string (optional)"
}
```

#### Bag Return Verified Action
```json
{
  "order_number": "string (required)",
  "driver_email": "string (optional)",
  "action": "bag_return_verified (required)",
  "bag_data": {
    "small_bags_requested": "number",
    "small_bags_accepted": "number",
    "tote_bags_requested": "number",
    "tote_bags_accepted": "number",
    "credit_issued": "number",
    "verification_status": "string: 'verified' | 'partially_verified' | 'not_eligible' | 'not_found' | 'unable_to_collect'"
  }
}
```

### Response Schema

#### Success (200 OK)
```json
{
  "status": "success",
  "order_number": "NV-MON7CNYB",
  "action": "delivered",
  "sync_result": "accepted"
}
```

#### Errors

**400 Bad Request** (missing required fields)
```json
{ "error": "Missing order_number or action" }
```

**401 Unauthorized** (invalid token)
```json
{ "error": "Unauthorized" }
```

**404 Not Found** (order doesn't exist)
```json
{ "error": "Order not found" }
```

**500 Internal Server Error**
```json
{ "error": "Error message details" }
```

---

## Curl Examples for Testing

### Test 1: Confirm Delivery
```bash
curl -X POST https://hub.nuvira.io/functions/receiveDriverStatusUpdate \
  -H "Authorization: Bearer YOUR_SYNC_SECRET_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "order_number": "NV-MON7CNYB",
    "driver_email": "test_driver@example.com",
    "action": "delivered",
    "delivery_photo_url": "https://storage.example.com/delivery-photo.jpg",
    "delivery_drop_location": "Front porch, left side",
    "delivery_notes": "Left as requested"
  }'
```

### Test 2: Mark Unable to Deliver
```bash
curl -X POST https://hub.nuvira.io/functions/receiveDriverStatusUpdate \
  -H "Authorization: Bearer YOUR_SYNC_SECRET_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "order_number": "NV-MOILSACV",
    "driver_email": "test_driver@example.com",
    "action": "unable_to_deliver",
    "unable_reason": "customer_not_home",
    "delivery_notes": "No answer after 2 attempts"
  }'
```

### Test 3: Verify Bag Return
```bash
curl -X POST https://hub.nuvira.io/functions/receiveDriverStatusUpdate \
  -H "Authorization: Bearer YOUR_SYNC_SECRET_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "order_number": "NV-MOF1S04J",
    "driver_email": "test_driver@example.com",
    "action": "bag_return_verified",
    "bag_data": {
      "small_bags_requested": 2,
      "small_bags_accepted": 2,
      "tote_bags_requested": 1,
      "tote_bags_accepted": 1,
      "credit_issued": 4.00,
      "verification_status": "verified"
    }
  }'
```

### Test 4: Idempotency (Retry Same Payload)
```bash
# First call
curl -X POST https://hub.nuvira.io/functions/receiveDriverStatusUpdate \
  -H "Authorization: Bearer YOUR_SYNC_SECRET_HERE" \
  -H "Content-Type: application/json" \
  -d '{"order_number": "NV-MODIHVQQ", "action": "delivered", "delivery_photo_url": "https://...", "delivery_drop_location": "Porch"}'

# Second call (same payload) — should NOT create duplicate audit log
curl -X POST https://hub.nuvira.io/functions/receiveDriverStatusUpdate \
  -H "Authorization: Bearer YOUR_SYNC_SECRET_HERE" \
  -H "Content-Type: application/json" \
  -d '{"order_number": "NV-MODIHVQQ", "action": "delivered", "delivery_photo_url": "https://...", "delivery_drop_location": "Porch"}'
```

---

## Integration Checklist

- [ ] **Secret Retrieval**: Get `CUSTOMER_APP_SYNC_SECRET` from Hub Dashboard
- [ ] **Environment Config**: Store secret in `HUB_SYNC_SECRET` or equivalent env var
- [ ] **Driver Portal Update**: Add call to `receiveDriverStatusUpdate` in delivery confirmation flow
- [ ] **Error Handling**: Catch and handle 401, 404, and 5xx responses
- [ ] **Retry Logic**: Implement exponential backoff for transient failures
- [ ] **Logging**: Log all requests & responses for debugging
- [ ] **Testing**: Test with one order end-to-end (manual delivery flow)
- [ ] **Verification**: Confirm order appears as "delivered" in Hub Driver Portal
- [ ] **Route Check**: Verify delivered order does NOT reappear in optimized route
- [ ] **Audit Trail**: Check RepairAuditLog shows driver action recorded
- [ ] **Email Confirmation**: Verify customer received delivery email from Hub
- [ ] **Production Deployment**: Deploy updated Customer App with integration

---

## Support & Debugging

### Hub Admin: How to Check Integration Status

```javascript
// 1. Check latest driver updates
const logs = await base44.entities.RepairAuditLog.filter({
  repair_function: 'receiveDriverStatusUpdate',
}, '-timestamp', 10);

// 2. Verify order marked as delivered
const order = await base44.entities.ShopifyOrder.get('order_id');
console.log(order.production_status); // Should be 'fulfilled'
console.log(order.delivered_at); // Should have timestamp

// 3. Verify route optimization excludes delivered
const route = await base44.functions.invoke('optimizeDeliveryRoute', {
  date: '2026-05-02',
  optimize: false,
});
const activeOrders = route.orders.filter(o => o.status !== 'delivered');
console.log(activeOrders.length); // Should NOT include 5 delivered orders
```

### Customer App: Troubleshooting Failures

| Error | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Invalid secret or missing Bearer prefix | Verify token format: `Bearer <secret>` |
| `404 Not Found` | Order doesn't exist in Hub | Check order_number is correct; wait 60s for sync |
| `400 Bad Request` | Missing required field | Verify order_number and action are present |
| `500 Internal Server Error` | Server error in Hub | Check Hub logs; retry after delay |
| Silent Failure (no response) | Network timeout | Increase timeout; implement retry logic |

---

## Final Proof & Sign-Off

✅ **Hub Endpoint Status**: READY FOR CUSTOMER APP INTEGRATION
✅ **Today's Deliveries**: 5 orders confirmed fulfilled in Hub
✅ **Route Optimization**: Excludes delivered orders correctly
✅ **Audit Trail**: RepairAuditLog created automatically
✅ **Idempotency**: Handles retries without duplicates
✅ **Documentation**: Complete specification provided

🔴 **PENDING**: Customer App must call the endpoint on driver delivery confirmation

---

**Next Step**: Customer App team integrates `receiveDriverStatusUpdate` into Driver Portal delivery flow. Once integrated, 404 errors will resolve and delivery status will persist in real-time.

**Contact**: Hub Admin for `CUSTOMER_APP_SYNC_SECRET` and endpoint URL configuration.