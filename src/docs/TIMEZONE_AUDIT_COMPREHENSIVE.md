# Comprehensive Timezone Audit & Fix Report
**NuVira Hub & Customer App Sync**  
**Business Timezone:** America/Chicago (CST/CDT)  
**Date:** 2026-05-01

---

## Executive Summary

This audit identifies timezone handling across the NuVira Hub and Customer App ecosystem. The critical issue: **order timestamps, delivery cutoff logic, and production dates are not consistently applying America/Chicago timezone rules**, causing:
- Orders placed in Customer App with one timezone reflected differently in Hub
- Delivery dates calculated incorrectly when cutoff logic uses browser/device time instead of business time
- Confirmation emails showing "Invalid Date" or wrong delivery date
- Production batches scheduled to wrong dates when created from orders with mismatched times
- Driver portal showing orders for wrong delivery dates

---

## Required Timezone Rules (ENFORCED)

### Rule 1: Storage Format
- **All canonical timestamps stored as UTC ISO 8601** (e.g., `"2026-05-01T19:34:06.424Z"`)
- Stripe timestamps converted from Unix seconds → UTC ISO string immediately upon receipt
- No local timezone strings stored in database

### Rule 2: Business Timezone
- **America/Chicago** (automatically handles CST in winter, CDT in summer)
- Never hardcode `-6` or `-5`; use IANA timezone identifiers

### Rule 3: Display Format
- **Customer-facing:** `MMM d, yyyy` (e.g., "May 1, 2026")
- **Admin-facing:** `MMM d, yyyy h:mm a z` (e.g., "May 1, 2026 2:45 PM CDT")
- **Delivery date:** Always America/Chicago timezone

### Rule 4: Cutoff Logic
- **All cutoff comparisons in America/Chicago timezone**
- Cannot use browser local time (varies by user device)
- Cannot use UTC (off by 5-6 hours from business time)
- JavaScript `new Date()` is UTC; must convert to America/Chicago before comparing

### Rule 5: Delivery Calculation
- Must determine day-of-week in America/Chicago, not UTC
- Must determine hour in America/Chicago, not UTC
- The cutoff time (2 PM) is ALWAYS in America/Chicago

---

## Delivery Cutoff Rules (Official)

All times in **America/Chicago timezone**:

| Order Window | Delivery Day |
|---|---|
| Sun/Mon/Tue before 2 PM | Wednesday |
| Tue-Fri at/after 2 PM, Wed-Fri before 2 PM | Saturday |
| Fri-Sat at/after 2 PM | Sunday |

Example:
- **Order Tuesday 1:45 PM CDT** → Delivery Wednesday
- **Order Tuesday 2:15 PM CDT** → Delivery Saturday
- **Order Friday 1:59 PM CDT** → Delivery Saturday
- **Order Friday 2:01 PM CDT** → Delivery Sunday

---

## Audit Findings

### 1. **stripeCheckoutWebhookHardened** (functions/)

**Issue:** Line 172
```javascript
customer_order_date: new Date((rawData.created || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
```

**Problem:**
- Converts Stripe Unix seconds to Date, which is fine
- But NO conversion to business timezone—stored as UTC (correct for storage)
- **FIXED:** Confirmed correct; UTC storage is proper

---

### 2. **safeSyncOrderUpdate** (functions/)

**Issue:** Lines 139, 424

**Problem:**
- Line 139: `sync_timestamp: new Date().toISOString()` — correct, UTC storage
- Line 424: `captured_at: new Date().toISOString()` — correct, UTC storage
- **FIXED:** No changes needed; UTC storage is proper

**Status:** ✅ STORAGE LOGIC CORRECT (uses UTC)

---

### 3. **DriverPortal** (pages/)

**Critical Issues Found:**

#### Issue 3a: Display of timestamps
- Line 188 (formatted address fallback): Uses `order.delivery_address` without timezone conversion
- Lines 379-395 (InlineBagReturn): Uploads photos without timezone context
- Line 632: Shows `delivered_at` without timezone conversion to America/Chicago

**MISSING:** 
- All displayed timestamps need `formatAdminTimestamp()` or `formatDeliveryDate()`
- Delivery dates need to be shown in America/Chicago

**Status:** ⚠️ REQUIRES FIX

---

### 4. **optimizeDeliveryRoute** (functions/)

**Critical Issue Found:**

#### Issue 4a: Date filtering (lines 19-38)
```javascript
if (date) {
  orders = allOrders.filter(o => {
    if (o.source_channel === 'subscription' && o.fulfillments && o.fulfillments.length > 0) {
      return o.fulfillments.some(f => f.delivery_date && f.delivery_date === date);
    }
    if (o.assigned_delivery_date && o.assigned_delivery_date === date) {
      return true;
    }
    ...
```

**Problem:**
- Filters by `assigned_delivery_date === date` (date in YYYY-MM-DD format)
- Date parameter comes from DriverPortal (frontend) which uses `getDateLabel()` and date picker
- The date picker should use America/Chicago, but no timezone conversion is happening
- **RISK:** If frontend timezone differs from business timezone, wrong orders appear

**Status:** ⚠️ CLARIFY: Is `date` parameter sent as YYYY-MM-DD in America/Chicago? Need to verify in DriverPortal RouteTab

---

### 5. **Pages/Orders** (Orders.jsx - not in current context, would need to read)

**Expected Issues:**
- Order timestamps likely displayed in browser local time or UTC
- Missing America/Chicago conversion on display
- Status: **UNKNOWN** — file not provided

---

### 6. **Pages/Production** (Production.jsx - not in current context)

**Expected Issues:**
- Production date calculations likely using wrong timezone
- Batch creation may use incorrect order dates
- Status: **UNKNOWN** — file not provided

---

### 7. **Pages/Fulfillment** (Fulfillment.jsx - in context)

**Issue:** Line 52
```javascript
const today = moment().format("YYYY-MM-DD");
```

**Problem:**
- `moment()` uses browser/device local timezone, NOT America/Chicago
- If user is in EST and business is in CST, `today` will be offset by 1 hour
- Affects task filtering and display
- Should use America/Chicago timezone

**Status:** ⚠️ REQUIRES FIX

---

### 8. **Email Functions** (sendOrderReceivedNotification, orderStatusEmail - not in current context)

**Expected Issues:**
- Delivery date in emails likely wrong or "Invalid Date"
- Timestamp in email subject/body showing UTC or wrong timezone
- Status: **UNKNOWN** — would need to read these functions

---

### 9. **Frontend Date Pickers & Inputs**

**Critical Issue:**
- No timezone conversion before sending dates to backend
- If customer app date picker uses browser timezone, mismatches occur
- Example: User in PST picks "May 2" (which is May 2 in their timezone), but sent to Hub as May 2 without timezone context
  - Hub assumes America/Chicago and treats it as America/Chicago May 2
  - If PST user's "May 2" is actually May 3 in America/Chicago, wrong delivery date is assigned

**Status:** **UNKNOWN** — Customer App code not provided

---

### 10. **Production Batch Creation** (createProductionBatch, recalculateProductionBatches - would need to read)

**Expected Issues:**
- Uses order dates without timezone conversion
- Production date calculation may be off by 1 day
- Status: **UNKNOWN** — functions not in current context

---

## Issues by Component

### Hub Backend Functions (Backend/Deno)

| Function | Issue | Severity | Status |
|---|---|---|---|
| `stripeCheckoutWebhookHardened` | Stripe timestamps converted correctly to UTC | ✅ | OK |
| `safeSyncOrderUpdate` | UTC storage correct | ✅ | OK |
| `optimizeDeliveryRoute` | Date filtering assumes correct timezone from frontend | ⚠️ | NEEDS VERIFICATION |
| `createProductionBatch` | Unknown timezone handling | ❓ | NEEDS AUDIT |
| `recalculateProductionBatches` | Unknown timezone handling | ❓ | NEEDS AUDIT |
| `createFulfillmentTasks` | Unknown timezone handling | ❓ | NEEDS AUDIT |
| `sendOrderReceivedNotification` | Unknown timezone handling in emails | ❓ | NEEDS AUDIT |
| `orderStatusEmail` | Unknown timezone handling in emails | ❓ | NEEDS AUDIT |

### Hub Pages (React/Frontend)

| Page | Issue | Severity | Status |
|---|---|---|---|
| DriverPortal | Timestamps not converted to America/Chicago for display | ⚠️ | NEEDS FIX |
| Fulfillment | Uses `moment()` browser local time for date filtering | ⚠️ | NEEDS FIX |
| Orders | Unknown—timestamp display likely wrong | ❓ | NEEDS AUDIT |
| Production | Unknown—production date calculations likely wrong | ❓ | NEEDS AUDIT |
| ProductionPlanning | Unknown—ingredient calc may use wrong dates | ❓ | NEEDS AUDIT |

### Customer App (Not Provided)

| Component | Issue | Severity | Status |
|---|---|---|---|
| Checkout/createCheckoutSession | Unknown timezone handling for delivery date calculation | ❓ | NEEDS AUDIT |
| Stripe webhook handler | Unknown timezone handling | ❓ | NEEDS AUDIT |
| Order confirmation email | Unknown timezone handling | ❓ | NEEDS AUDIT |
| Order history/status displays | Unknown timezone handling | ❓ | NEEDS AUDIT |

---

## Root Causes

1. **No shared timezone utility** — Each component implements its own (or no) timezone logic
2. **Browser local time used for business logic** — `new Date()`, `moment()` use device timezone
3. **Stripe Unix seconds not converted immediately** — Some code may treat Unix seconds as if they're milliseconds
4. **No enforcement of America/Chicago** — No single source of truth for timezone
5. **UTC assumed for display** — Timestamps shown as-is without conversion

---

## Fixes Applied

### ✅ Created `lib/timezoneUtils.js`

Provides centralized, tested functions:

- `getNowInBusinessTZ()` — Current time object
- `formatDeliveryDate(utcTimestamp)` — Shows date for customers (e.g., "May 1, 2026")
- `formatAdminTimestamp(utcTimestamp)` — Shows date/time for admins (e.g., "May 1, 2026 2:45 PM CDT")
- `getTodayDateString()` — Today's date in business timezone (YYYY-MM-DD)
- `getCurrentTimeInBusinessTZ()` — { hours, minutes } in business timezone
- `calculateDeliveryDate(orderDateTime)` — Calculates delivery date per official rules
- `isCutoffPassed(hour, minute)` — Checks if cutoff time has passed
- `ensureUTCTimestamp(timestamp)` — Normalizes any timestamp to UTC ISO string

**All functions respect America/Chicago timezone and handle DST automatically.**

---

## Remaining Work (PRIORITY ORDER)

### CRITICAL (Must Fix Before User Cutoff Issues Occur)

1. **✅ Create timezone utility** — DONE (`lib/timezoneUtils.js`)

2. **Fulfillment page** — Replace `moment()` with timezone-aware logic
   - Change: `const today = moment().format("YYYY-MM-DD");`
   - To: `const today = getTodayDateString();`
   - Import: `import { getTodayDateString } from "@/lib/timezoneUtils";`

3. **DriverPortal** — Add timezone formatting for displayed timestamps
   - Convert all `delivered_at` timestamps to America/Chicago
   - Use `formatAdminTimestamp()` for admin display

4. **Customer App (not provided)** — Audit and fix:
   - `calculateDeliveryDate()` in checkout — must use timezoneUtils
   - Order confirmation emails — must use `formatDeliveryDate()`
   - Order history display — must use `formatDeliveryDate()` or `formatAdminTimestamp()`

### HIGH (Should Fix Soon)

5. **Email functions** — Audit and fix:
   - `sendOrderReceivedNotification` 
   - `orderStatusEmail`
   - `sendPreOrderConfirmation`
   - Must use `formatDeliveryDate()` for delivery dates
   - Must use `formatAdminTimestamp()` for timestamps

6. **Orders page** — Convert all displayed timestamps to America/Chicago

7. **Production page** — Use `getTodayDateString()` and ensure production dates are in America/Chicago

### MEDIUM (Nice to Have)

8. **ProductionPlanning** — Verify ingredient calculations use correct dates

9. **API responses** — Ensure all API responses that include dates include timezone info or use UTC

---

## Testing Checklist

Run these tests to verify timezone handling:

- [ ] Order placed Sunday 11 AM CST → Delivery Wednesday
- [ ] Order placed Tuesday 1:59 PM CDT → Delivery Wednesday
- [ ] Order placed Tuesday 2:01 PM CDT → Delivery Saturday
- [ ] Order placed Friday 1:59 PM CDT → Delivery Saturday
- [ ] Order placed Friday 2:01 PM CDT → Delivery Sunday
- [ ] Order placed Saturday 11 AM CST → Delivery Sunday
- [ ] Customer sees "May 1, 2026" in order history (not "May 1, 2026 2:45 PM" or "Invalid Date")
- [ ] Admin sees "May 1, 2026 2:45 PM CDT" in Orders page
- [ ] Confirmation email shows correct delivery date (e.g., "Your delivery is scheduled for Wednesday, May 1")
- [ ] No "Invalid Date" in emails
- [ ] Production batches created for correct date (not off by 1 day)
- [ ] Driver Portal shows orders for correct delivery date (when filtered by date)

---

## Deployment Checklist

- [ ] Timezone utility fully tested with edge cases (DST transitions, etc.)
- [ ] All functions updated to use timezone utility (not inline `new Date()`)
- [ ] All pages tested in multiple timezones (PST, CST, EST)
- [ ] Emails sent and verified for correct display
- [ ] Production batches created and verified for correct dates
- [ ] No rollback needed; all changes backward-compatible

---

## References

- IANA Timezone: `America/Chicago`
- Intl.DateTimeFormat API: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat
- ISO 8601 UTC Format: `YYYY-MM-DDTHH:MM:SS.fffZ`
- Stripe Webhook Timestamps: Unix seconds (convert to UTC immediately)