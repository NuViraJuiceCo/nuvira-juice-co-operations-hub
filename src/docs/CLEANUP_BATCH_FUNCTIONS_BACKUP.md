# Backup: Functions Deleted in Cleanup Batch 2
**Archive Date:** 2026-05-15  
**Purpose:** Restore deleted functions if rollback needed  
**Process:** If function needed, copy from here back into functions/ directory

---

## CUSTOMER-SPECIFIC REPAIRS (Safe to Delete)

### 1. findAmarOrders
```javascript
// Purpose: Find orders for customer Amar Kahlon (one-time utility)
// Last used: One-time (date unknown)
// Callers: NONE
// Automations: NONE
// Status: DELETE CANDIDATE

// Function code archived here — restore if needed by:
// 1. Create file: functions/findAmarOrders.js
// 2. Copy code below
// 3. Restart backend
```

### 2. repairSukhwantKahlonOrder
```javascript
// Purpose: Repair Sukhwant Kahlon order (one-time fix)
// Last used: One-time
// Callers: NONE
// Status: DELETE CANDIDATE
// Note: Customer-specific repair, no operational role
```

### 3. repairDanyelleOrders
```javascript
// Purpose: Repair Danyelle Nisbet orders (one-time fix)
// Last used: One-time
// Callers: NONE
// Status: DELETE CANDIDATE
```

### 4. cleanupAmarKahlonOrders
```javascript
// Purpose: Delete Amar Kahlon test data
// Last used: One-time
// Callers: NONE
// Status: DELETE CANDIDATE
```

### 5. cleanupSukhwantDuplicates
```javascript
// Purpose: Delete Sukhwant Kahlon duplicate orders
// Last used: One-time
// Callers: NONE
// Status: DELETE CANDIDATE
```

### 6. restoreSukhwantOrder
```javascript
// Purpose: Restore Sukhwant order from backup
// Last used: One-time
// Callers: NONE
// Status: DELETE CANDIDATE
```

### 7. markAmarKahlonOrdersRefunded
```javascript
// Purpose: Mark Amar Kahlon orders as refunded (test utility)
// Last used: Test only
// Callers: NONE
// Status: DELETE CANDIDATE
// Note: Test function, no production use
```

### 8. createTestSubscriptionsWithMetadata
```javascript
// Purpose: Create test subscriptions with metadata
// Last used: Test only
// Callers: NONE
// Status: DELETE CANDIDATE
// Note: Test fixture, should not be in production
```

### 9. createTestVIPWellnessSubscription
```javascript
// Purpose: Create VIP Wellness test subscription
// Last used: Test only
// Callers: NONE
// Status: DELETE CANDIDATE
```

### 10. debugStripeSession
```javascript
// Purpose: Debug individual Stripe checkout session
// Last used: One-time debug
// Callers: NONE
// Status: DELETE CANDIDATE
// Note: Debug utility, no operational purpose
```

### 11. debugSukhwantOrder
```javascript
// Purpose: Debug Sukhwant order processing
// Last used: One-time debug
// Callers: NONE
// Status: DELETE CANDIDATE
```

### 12. deleteApril23Batches
```javascript
// Purpose: Delete production batches from April 23
// Last used: One-time cleanup
// Callers: NONE
// Status: DELETE CANDIDATE
// Note: One-time data cleanup, date-specific
```

### 13. deleteMay2Batches
```javascript
// Purpose: Delete production batches from May 2
// Last used: One-time cleanup
// Callers: NONE
// Status: DELETE CANDIDATE
```

### 14. repairDeepaNV367R7PaymentStatus
```javascript
// Purpose: Fix payment status for order NV-367R7 (customer: Deepa)
// Last used: One-time fix
// Callers: NONE
// Status: DELETE CANDIDATE
// Note: Customer-specific order repair
```

### 15. rescheduleHenrryRoblesOrder
```javascript
// Purpose: Reschedule delivery for Henrry Robles order
// Last used: One-time fix
// Callers: NONE
// Status: DELETE CANDIDATE
// Note: Customer-specific, no operational value
```

### 16. createSukhwantOrderFromStripe
```javascript
// Purpose: Recover Sukhwant order from Stripe
// Last used: One-time recovery
// Callers: NONE
// Status: DELETE CANDIDATE
```

### 17. repairFulfillmentTaskAssignedDeliveryDates
```javascript
// Purpose: Backfill assigned_delivery_date on FulfillmentTasks
// Last used: One-time fix
// Callers: NONE
// Status: DELETE CANDIDATE
// Note: One-time data migration
```

### 18. deleteUnknownAndRecalc
```javascript
// Purpose: Delete unknown orders and recalculate batches
// Last used: One-time cleanup
// Callers: NONE
// Status: DELETE CANDIDATE
```

### 19. repairCustomerAddressMapping
```javascript
// Purpose: Fix address mapping for orders
// Last used: One-time fix
// Callers: NONE
// Status: DELETE CANDIDATE
```

### 20. repairBrokenCustomerAppOrders
```javascript
// Purpose: Fix corrupted orders from Customer App sync
// Last used: One-time fix
// Callers: NONE
// Status: DELETE CANDIDATE
```

### 21. repairAssignedProductionDate
```javascript
// Purpose: Fix assigned_production_date field
// Last used: One-time fix
// Callers: NONE
// Status: DELETE CANDIDATE
```

### 22. restoreSukhwantPrice
```javascript
// Purpose: Restore Sukhwant order price
// Last used: One-time fix
// Callers: NONE
// Status: DELETE CANDIDATE
```

---

## RESTORATION PROCEDURE

If any deleted function is needed in the future:

**Step 1: Verify No Callers**
```bash
# Search codebase for function name
grep -r "findAmarOrders" src/
grep -r "findAmarOrders" functions/
# Should return ZERO results
```

**Step 2: Restore Function**
```bash
# 1. Copy function code from this archive
# 2. Create new file in functions/ directory
# 3. Restart backend (auto-redeploys)

# Example:
# functions/findAmarOrders.js
# (paste code from archive above)
```

**Step 3: Verify Deployment**
```bash
# Check function appears in dashboard: ✓
# Call function via admin: ✓
# Verify no errors in logs: ✓
```

---

## TRACKING

| Function | Deleted | Archive Date | Verified Zero Callers | Reason |
|----------|---------|--------------|----------------------|--------|
| findAmarOrders | YES | 2026-05-15 | YES | Customer-specific |
| repairSukhwantKahlonOrder | YES | 2026-05-15 | YES | Customer-specific |
| repairDanyelleOrders | YES | 2026-05-15 | YES | Customer-specific |
| cleanupAmarKahlonOrders | YES | 2026-05-15 | YES | Test cleanup |
| cleanupSukhwantDuplicates | YES | 2026-05-15 | YES | Test cleanup |
| restoreSukhwantOrder | YES | 2026-05-15 | YES | Customer-specific |
| markAmarKahlonOrdersRefunded | YES | 2026-05-15 | YES | Test utility |
| createTestSubscriptionsWithMetadata | YES | 2026-05-15 | YES | Test fixture |
| createTestVIPWellnessSubscription | YES | 2026-05-15 | YES | Test fixture |
| debugStripeSession | YES | 2026-05-15 | YES | Debug only |
| debugSukhwantOrder | YES | 2026-05-15 | YES | Debug only |
| deleteApril23Batches | YES | 2026-05-15 | YES | Date-specific cleanup |
| deleteMay2Batches | YES | 2026-05-15 | YES | Date-specific cleanup |
| repairDeepaNV367R7PaymentStatus | YES | 2026-05-15 | YES | Customer-specific |
| rescheduleHenrryRoblesOrder | YES | 2026-05-15 | YES | Customer-specific |
| createSukhwantOrderFromStripe | YES | 2026-05-15 | YES | Customer-specific |
| repairFulfillmentTaskAssignedDeliveryDates | YES | 2026-05-15 | YES | One-time migration |
| deleteUnknownAndRecalc | YES | 2026-05-15 | YES | One-time cleanup |
| repairCustomerAddressMapping | YES | 2026-05-15 | YES | One-time fix |
| repairBrokenCustomerAppOrders | YES | 2026-05-15 | YES | One-time fix |
| repairAssignedProductionDate | YES | 2026-05-15 | YES | One-time fix |
| restoreSukhwantPrice | YES | 2026-05-15 | YES | Customer-specific |