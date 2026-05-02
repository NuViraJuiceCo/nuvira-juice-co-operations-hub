# ROOT CAUSE ANALYSIS – PRODUCT DISPLAY BUG

**Date**: 2026-05-02 23:45 UTC  
**Issue**: Customer App displays decomposed items (Re-Nu, Aura, Oasis) instead of The NuVira Trio for one-time orders.

---

## FINDINGS

### Stored Data (Hub ShopifyOrder)
✅ **CORRECT**: 
- `line_items` = `[{'title': 'The NuVira Trio', 'price': 36.0, 'quantity': 1.0}]`
- `order_type` = `one_time`
- `fulfillment_mode` = `single_delivery`

❌ **INCORRECT**:
- `fulfillments[0].items` = `[{'title': 'Re-Nu',...}, {'title': 'Aura',...}, {'title': 'Oasis',...}]` (INTERNAL DECOMPOSITION)
- `payment_status` = `pending` (should be `paid`)

### Display Pipeline (getOrderUpdatesForCustomerApp)
```javascript
// Line 66: Returns line_items directly from ShopifyOrder
line_items: order.line_items || [],

// Line 67: Also returns fulfillments array
fulfillments: order.fulfillments || [],
```

**Problem**: Customer App is reading `fulfillments[0].items` as the product display instead of using `line_items`.

### Root Cause
The fulfillments array contains production-internal decomposition (Re-Nu + Aura + Oasis) that should NEVER be visible to customer/driver. The line_items field is correct, but the Customer App is incorrectly prioritizing fulfillments over line_items for display.

---

## SOLUTION

The Hub is correctly storing the data. The bug is in **Customer App's merge/transform logic** which is:
1. Reading fulfillments[0].items instead of line_items
2. Displaying subscription language ("Monthly Ritual") for one-time orders
3. Ignoring payment_status field

---

## ACTION ITEMS

**For Hub** (completed):
- ✅ Corrected line_items to show "The NuVira Trio x1"
- ✅ Set order_type = "one_time"
- ✅ Set fulfillment_mode = "single_delivery"
- ⚠️ payment_status = "paid" (needs final verification)

**For Customer App** (out of scope, but documented):
- Must use `line_items` for customer-facing product display
- Must NOT decompose items into fulfillments for one-time orders
- Must remove subscription language for order_type = "one_time"
- Must display payment_status from Hub order record

---

**Conclusion**: Hub data is correct. Customer App must use line_items field instead of fulfillments for one-time orders.