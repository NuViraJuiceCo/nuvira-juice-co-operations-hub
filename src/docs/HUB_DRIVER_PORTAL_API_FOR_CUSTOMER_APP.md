# Hub Driver Portal API for Customer App

**Last Updated:** May 6, 2026  
**Status:** ✅ Production Ready  
**Target:** Customer App Driver Portal Integration

---

## Overview

Customer App Driver Portal calls Hub endpoints to fetch route data, optimize delivery order, and submit driver actions. Hub is the **operational source of truth** — all filtering, exclusions, FulfillmentTask state, and order synchronization are managed centrally in Hub. Customer App is a **read-only UI client** for route display and a **write client** for driver actions only.

**Key Principle:** One system of record. All changes flow through Hub's protected endpoints, never duplicate logic client-side.

---

## Authentication

All endpoints require Bearer token authentication using the shared `CUSTOMER_APP_SYNC_SECRET`.

```
Authorization: Bearer <CUSTOMER_APP_SYNC_SECRET>
```

**Secret Location:** Set in Hub environment variables (`CUSTOMER_APP_SYNC_SECRET`).

---

## Endpoint 1: GET DRIVER ROUTE FOR DATE

**Purpose:** Fetch sanitized, filterable delivery tasks for a given date.

**Function:** `getDriverRouteForDate`

**URL:** `POST /functions/getDriverRouteForDate` (via base44.functions.invoke)

### Request

```json
{
  "date": "2026-05-06"
}
```

**Field Aliases:** `date` | `selected_date` | `scheduled_date` | `delivery_date`

**Validation:**
- Date format: `YYYY-MM-DD` (ISO 8601)
- Required

### Response (Success)

```json
{
  "date": "2026-05-06",
  "delivery_window_label": "5 PM – 8 PM",
  "counts": {
    "ready": 0,
    "scheduled": 2,
    "completed": 0,
    "total": 2,
    "left": 2
  },
  "ready_tasks": [],
  "scheduled_tasks": [
    {
      "task_id": "69f6faa0690e14bb5bf5938a",
      "fulfillment_task_id": "69f6faa0690e14bb5bf5938a",
      "order_id": "69f665d1852c5530d521f029",
      "order_number": "NV-JASDEEPGILL",
      "customer_name": "Jasdeep Gill",
      "delivery_address": "210 Still Creek Drive, Lake Saint Louis, MO 63367",
      "address_line1": "210 Still Creek Drive, Lake Saint Louis, MO 63367",
      "address_line2": null,
      "city": "Lake Saint Louis",
      "state": "MO 63367",
      "postal_code": null,
      "items": [
        {
          "title": "The NuVira Trio",
          "quantity": 1
        }
      ],
      "items_summary": null,
      "status": "Scheduled",
      "fulfillment_type": "Delivery",
      "scheduled_date": "2026-05-06",
      "delivery_window_label": "5 PM – 8 PM",
      "time_window": "17:00 - 20:00",
      "source": "fulfillment_task",
      "action_allowed": true,
      "missing_fulfillment_task_id": false
    }
  ],
  "completed_tasks": []
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `task_id` | string | Real FulfillmentTask.id — primary action target |
| `fulfillment_task_id` | string | Alias for task_id |
| `order_id` | string | ShopifyOrder.id (for context only, not for actions) |
| `order_number` | string | Shopify order number (e.g., NV-XXXXXXXX) |
| `customer_name` | string | Customer name |
| `delivery_address` | string | Full address for maps/display |
| `address_line1, city, state` | string | Address components |
| `items` | array | Line items (title, quantity only) |
| `status` | string | FulfillmentTask status (Scheduled, Packed, In Transit, Completed, etc.) |
| `action_allowed` | boolean | Whether driver can take action (false if task is Completed/Cancelled) |
| `missing_fulfillment_task_id` | boolean | Flag: true if this task lacks a real FulfillmentTask ID (rare) |

### Response (Error)

```json
{
  "error": "date required (YYYY-MM-DD)",
  "received": {}
}
```

```json
{
  "error": "Unauthorized",
  "status": 401
}
```

### Data Quality Guarantees

✅ **Filtering Applied Before Response:**
- Cancelled orders excluded
- Refunded orders excluded
- Orders with `excluded` tag excluded
- Manual override orders excluded (unless driver explicitly updating them)
- Test orders excluded

✅ **Real FulfillmentTask IDs:**
- `task_id` is always a real FulfillmentTask.id (never synthetic, never ShopifyOrder.id)
- Null only if no FulfillmentTask was found for the order

✅ **Sanitization Applied:**
- No email addresses
- No phone numbers
- No payment status
- No Stripe IDs
- No internal notes
- Address only (no notes, no history)

---

## Endpoint 2: OPTIMIZE DELIVERY ROUTE

**Purpose:** Sort delivery tasks into optimal route order.

**Function:** `optimizeDeliveryRoute`

**URL:** `POST /functions/optimizeDeliveryRoute` (via base44.functions.invoke)

### Request

```json
{
  "date": "2026-05-06",
  "optimize": true,
  "orders": [
    {
      "id": "69f6faa0690e14bb5bf5938a",
      "order_id": "69f665d1852c5530d521f029",
      "fulfillment_task_id": "69f6faa0690e14bb5bf5938a",
      "customer_name": "Jasdeep Gill",
      "customer_email": "jk000.gill@gmail.com",
      "address_line1": "210 Still Creek Drive, Lake Saint Louis, MO 63367",
      "address_city": "Lake Saint Louis",
      "address_state": "MO 63367",
      "delivery_address": "210 Still Creek Drive, Lake Saint Louis, MO 63367",
      "items": [
        {
          "title": "The NuVira Trio",
          "quantity": 1,
          "price": 36
        }
      ],
      "status": "Scheduled"
    }
  ]
}
```

**Field Notes:**
- `date`: Optional (for context logging)
- `optimize`: true = apply route algorithm; false = return as-is
- `orders`: Array of task objects from `getDriverRouteForDate`

### Response (Success)

```json
{
  "status": "success",
  "orders": [
    // All undelivered orders with updated leg_duration_seconds
  ],
  "optimized_orders": [
    // Orders sorted into optimal delivery sequence (Stop 1, Stop 2, ...)
  ],
  "route_stats": {
    "optimized_duration_minutes": 24,
    "total_distance_miles": 5.1,
    "stops_count": 2,
    "time_saved_minutes": 0,
    "optimization_method": "cluster_sort"
  },
  "return_to_origin": {
    "location": "619 N Main St Unit 3, O'Fallon, MO 63366",
    "display_name": "Return to NuVira Base",
    "is_return_stop": true
  }
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `optimized_orders` | array | Tasks sorted into delivery sequence (Stop 1, Stop 2, ...) |
| `optimized_duration_minutes` | number | Estimated total drive time + stops |
| `total_distance_miles` | number | Total route distance |
| `optimization_method` | string | "google_routes_api" or "cluster_sort" (fallback) |
| `return_to_origin` | object | Depot location for return-to-base at end of route |

### Optimization Methods

1. **Google Routes API** (preferred)
   - Requires valid GOOGLE_MAPS_API_KEY
   - Uses real-time road data
   - Returns actual turn-by-turn distances

2. **Cluster-based Sort** (fallback)
   - Groups by zip code proximity
   - Fast, no external API
   - Used when Google Routes API unavailable

### Consumer Notes

✅ **Task IDs Preserved:**
- Input `fulfillment_task_id` persists through optimization

✅ **Completed Orders Filtered:**
- Already-delivered tasks removed from optimization (included in response separately)

✅ **Safe for Multiple Calls:**
- Idempotent — can call multiple times without side effects

---

## Endpoint 3: RECEIVE DRIVER STATUS UPDATE

**Purpose:** Submit driver action (delivery confirmation, unable-to-deliver, bag return).

**Function:** `receiveDriverStatusUpdate`

**URL:** `POST /functions/receiveDriverStatusUpdate` (via base44.functions.invoke)

### Request: MARK DELIVERED

```json
{
  "order_id": "69f665d1852c5530d521f029",
  "order_number": "NV-JASDEEPGILL",
  "driver_email": "driver@nuvira.local",
  "action": "delivered",
  "delivery_photo_url": "https://storage.example.com/delivery-photo-12345.jpg",
  "delivery_drop_location": "Front Door",
  "delivery_notes": "Left on porch, customer not home"
}
```

### Request: UNABLE TO DELIVER

```json
{
  "order_id": "69f665d1852c5530d521f029",
  "order_number": "NV-JASDEEPGILL",
  "driver_email": "driver@nuvira.local",
  "action": "unable_to_deliver",
  "unable_reason": "customer_not_home",
  "delivery_notes": "Attempted 2x, no answer"
}
```

### Request: BAG RETURN VERIFIED

```json
{
  "order_id": "69f665d1852c5530d521f029",
  "order_number": "NV-JASDEEPGILL",
  "driver_email": "driver@nuvira.local",
  "action": "bag_return_verified",
  "bag_data": {
    "small_bags_requested": 2,
    "small_bags_accepted": 2,
    "tote_bags_requested": 1,
    "tote_bags_accepted": 1,
    "credit_issued": 3.50,
    "verification_status": "verified"
  }
}
```

### Request Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `order_id` | string | Yes | ShopifyOrder.id |
| `order_number` | string | Yes | Order number (NV-XXXXXXX) |
| `driver_email` | string | Yes | Email of driver taking action |
| `action` | string | Yes | Action: `delivered` \| `unable_to_deliver` \| `bag_return_verified` |
| `delivery_photo_url` | string | For `delivered` | URL of proof-of-delivery photo |
| `delivery_drop_location` | string | For `delivered` | Where package was left (e.g., "Front Door", "Garage") |
| `delivery_notes` | string | Optional | General notes |
| `unable_reason` | string | For `unable_to_deliver` | Reason code (customer_not_home, wrong_address, access_issue, refused_delivery, other) |
| `bag_data` | object | For `bag_return_verified` | Bag return details with credit calculation |

### Response (Success)

```json
{
  "status": "success",
  "order_number": "NV-JASDEEPGILL",
  "action": "delivered",
  "sync_result": "accepted"
}
```

### Response (Error)

```json
{
  "error": "Order not found",
  "status": 404
}
```

```json
{
  "error": "Unauthorized",
  "status": 401
}
```

### Side Effects

✅ **ShopifyOrder Status Update:**
- `production_status` → `fulfilled` (if delivered)
- `delivered_at` → timestamp
- `delivered_by` → driver email/name
- `delivery_photo_url` → photo URL
- `internal_notes` → appended with action details

✅ **FulfillmentTask Update** (via `updateDriverDeliveryTask`):
- `status` → "Completed" (if delivered)
- `driver_notes` → appended with structured audit entry

✅ **Audit Trail:**
- RepairAuditLog entry created with driver action details
- ShopifyOrder.audit_trail updated via safeSyncOrderUpdate

✅ **Customer Email:**
- Delivery confirmation sent to customer (if action=delivered)

---

## Endpoint 4: UPDATE DRIVER DELIVERY TASK (Direct FulfillmentTask Updates)

**Purpose:** Update FulfillmentTask directly with driver actions (preferred method).

**Function:** `updateDriverDeliveryTask`

**URL:** `POST /functions/updateDriverDeliveryTask` (via base44.functions.invoke)

### Request

```json
{
  "task_id": "69f6faa0690e14bb5bf5938a",
  "action": "mark_delivered",
  "driver_email": "driver@nuvira.local",
  "driver_name": "John Doe",
  "photo_url": "https://storage.example.com/delivery-photo-12345.jpg",
  "timestamp": "2026-05-06T18:45:00Z"
}
```

### Request Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `task_id` | string | Yes | FulfillmentTask.id |
| `action` | string | Yes | Action: `mark_out_for_delivery` \| `mark_delivered` \| `mark_unable_to_deliver` \| `add_note` |
| `driver_email` | string | Yes | Driver email |
| `driver_name` | string | Optional | Driver name (for audit trail) |
| `photo_url` | string | For `mark_delivered` | Proof-of-delivery photo URL |
| `failure_reason` | string | For `mark_unable_to_deliver` | Why delivery failed |
| `note` | string | Optional | Additional notes |
| `timestamp` | string | Optional | ISO 8601 timestamp (defaults to now) |

### Response (Success)

```json
{
  "status": "success",
  "task_id": "69f6faa0690e14bb5bf5938a",
  "action": "mark_delivered",
  "driver_email": "driver@nuvira.local",
  "previous_status": "Scheduled",
  "new_status": "Completed",
  "order_id": "69f665d1852c5530d521f029",
  "order_sync": "accepted",
  "timestamp": "2026-05-06T18:45:00Z",
  "note": "[DRIVER_ACTION | 2026-05-06T18:45:00Z] driver: driver@nuvira.local action: mark_delivered status: Scheduled → Completed"
}
```

### Supported Actions

| Action | FulfillmentTask Status | ShopifyOrder Status | Use Case |
|--------|------------------------|---------------------|----------|
| `mark_out_for_delivery` | "Out For Delivery" | — | Driver left depot for deliveries |
| `mark_delivered` | "Completed" | fulfillment_status = "fulfilled" | Package delivered to customer |
| `mark_unable_to_deliver` | "Unable To Deliver" | — | Cannot reach customer, need reschedule |
| `add_note` | (unchanged) | (none) | Log notes without changing status |

### Immutability Guard

Once FulfillmentTask reaches "Completed", "Cancelled", or "Refunded", it cannot be updated except via `add_note`.

```json
{
  "error": "Task is immutable (status: Completed). Only add_note is permitted on completed/cancelled tasks.",
  "task_id": "69f6faa0690e14bb5bf5938a",
  "current_status": "Completed",
  "status": 409
}
```

---

## Integration Example: Customer App Driver Portal Flow

### 1. Load Route for Today

```javascript
const route = await base44.functions.invoke('getDriverRouteForDate', {
  date: '2026-05-06'
});
// Returns: { counts, ready_tasks, scheduled_tasks, completed_tasks }
```

### 2. Optimize Route Before Starting

```javascript
const optimized = await base44.functions.invoke('optimizeDeliveryRoute', {
  date: '2026-05-06',
  optimize: true,
  orders: route.scheduled_tasks // or ready_tasks
});
// Returns: { optimized_orders, route_stats }
```

### 3. Driver Marks Out for Delivery

```javascript
const outForDelivery = await base44.functions.invoke('updateDriverDeliveryTask', {
  task_id: optimized.optimized_orders[0].task_id,
  action: 'mark_out_for_delivery',
  driver_email: 'driver@nuvira.local'
});
// FulfillmentTask.status → "Out For Delivery"
```

### 4. Driver Delivers First Stop (with Photo)

```javascript
const delivered = await base44.functions.invoke('updateDriverDeliveryTask', {
  task_id: optimized.optimized_orders[0].task_id,
  action: 'mark_delivered',
  driver_email: 'driver@nuvira.local',
  driver_name: 'John Doe',
  photo_url: 'https://storage.example.com/photo1.jpg',
  timestamp: new Date().toISOString()
});
// FulfillmentTask.status → "Completed"
// ShopifyOrder.fulfilled_at → now
// ShopifyOrder.delivered_by → "John Doe"
// ShopifyOrder.delivery_photo_url → uploaded photo
// Customer receives delivery email
```

### 5. Driver Unable to Deliver Second Stop

```javascript
const unableToDeliver = await base44.functions.invoke('updateDriverDeliveryTask', {
  task_id: optimized.optimized_orders[1].task_id,
  action: 'mark_unable_to_deliver',
  driver_email: 'driver@nuvira.local',
  failure_reason: 'customer_not_home',
  note: 'Attempted twice, no answer'
});
// FulfillmentTask.status → "Unable To Deliver"
// ShopifyOrder.internal_notes appended with reason
// Order returned to queue for rescheduling
```

---

## Security Checklist

✅ **Authentication:** Bearer token (CUSTOMER_APP_SYNC_SECRET)  
✅ **Authorization:** All endpoints verify token before processing  
✅ **Data Sanitization:** Email, phone, payment, Stripe fields removed  
✅ **Immutability Guard:** Completed/cancelled tasks protected  
✅ **Audit Trails:** All driver actions logged in RepairAuditLog  
✅ **Safe Defaults:** Orders default to "not ready" for action  
✅ **Field Filtering:** Only driver-relevant fields exposed  
✅ **No ID Spoofing:** task_id is always real FulfillmentTask.id  

---

## Error Codes

| Code | Message | Action |
|------|---------|--------|
| 401 | Unauthorized | Check CUSTOMER_APP_SYNC_SECRET |
| 400 | Missing required field | Re-check request payload |
| 404 | Task/Order not found | Verify task_id or order_number |
| 409 | Task is immutable | Cannot update Completed/Cancelled task |
| 500 | Internal error | Check Hub logs, retry after delay |

---

## Production Deployment Checklist

- [ ] CUSTOMER_APP_SYNC_SECRET is set in both Hub and Customer App
- [ ] GOOGLE_MAPS_API_KEY configured (optional, fallback works without it)
- [ ] Customer App calls `getDriverRouteForDate` at route load time
- [ ] Customer App calls `optimizeDeliveryRoute` before presenting stops
- [ ] Customer App uses real `fulfillment_task_id` for all driver actions
- [ ] Driver actions only call `updateDriverDeliveryTask` or `receiveDriverStatusUpdate`
- [ ] All responses checked for `error` field before processing
- [ ] Delivery photos uploaded before calling `mark_delivered`
- [ ] Customer App implements retry logic for network failures
- [ ] Audit logs reviewed post-delivery for completeness

---

## Support & Debugging

**Hub Logs:** Check `[GET-DRIVER-ROUTE]`, `[OPTIMIZE-ROUTE]`, `[UPDATE-DRIVER-TASK]` prefixes

**Customer App Logs:** Should mirror Hub responses for all actions

**Real-time Sync:** All changes immediately visible on Hub — no eventual consistency delay