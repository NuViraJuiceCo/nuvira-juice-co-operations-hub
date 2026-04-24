# Migration Guide: New Ingredient Math System

## What Changed

The ingredient demand calculation system has been completely rebuilt with a transparent 5-layer architecture. The old system produced incorrect results like "72 oranges for 13.7 oz". The new system is mathematically correct, auditable, and validates all outputs.

## What Users Need To Do

### 1. Configure Ingredient Yields (One-time)
**Location**: Production Planning → Ingredient Yields tab

For each ingredient you use, add a yield configuration:
- Ingredient name (must match recipe ingredients exactly)
- How it's purchased (each, bunch, lb, bag, etc.)
- **Usable oz per purchase unit** (the key field)
  - Example: 2.0 oz per orange
  - This is how much juice/usable product you get from ONE unit
- Supplier case size (optional, for case calculations)
- Waste factor (optional, default 1.0)

### 2. Run Calculations
**Location**: Production Planning → Production Planner tab

1. Select a production date or date range
2. Click "Calculate Needs"
3. View results with validation warnings if any

### 3. Interpret Results
Each ingredient shows:
- Required amount in oz
- Current stock in oz
- Shortage in oz
- Suggested purchase units and cases

Click any ingredient to see:
- Validation issues (if any)
- Which products require this ingredient (breakdown by source)

---

## What's Better

### Mathematically Correct
✅ 13.7 oz demand with 2 oz/orange = **7 oranges** (not 72)
✅ 1.1 oz demand with 1.1 oz/lemon = **1 lemon** (not 115)
✅ Stock is subtracted before calculating purchase quantity

### Auditable
- See exactly which products drove ingredient demand
- Drill-down to understand calculations
- Validation warnings flag suspicious outputs instead of hiding them

### Isolated by Date
- Calculations for May 1 only include May 1 production
- No accidental inclusion of future days

### Proper Waste Handling
- Waste factor applied correctly (before division, not after)
- 10% trim loss properly increases order quantity

---

## Configuration Examples

### Oranges
```
Name: Orange
Purchase unit: each
Oz per unit: 2.0
Units per case: 72
Supplier: Local Produce Co
Notes: Order by Tuesday for Friday
```

### Pineapples
```
Name: Pineapple
Purchase unit: each
Oz per unit: 28
Units per case: 6
Trim waste factor: 1.1 (10% loss)
```

### Kale (by bunch)
```
Name: Kale
Purchase unit: bunch
Oz per unit: 10
Units per case: 12
Split cases allowed: true
```

### Carrot Juice (bottled)
```
Name: Carrot Juice
Purchase unit: bottle
Oz per unit: 32
Units per case: 12
Waste factor: 1.0 (shelf-stable)
```

---

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| "No purchase recommendation" | Yield config missing | Add config in Ingredient Yields tab |
| "Validation warning: HIGH_RATIO" | Oz per unit seems wrong | Check yield value is usable amount per unit, not inverse |
| "Stock data missing" | Inventory unit unrecognized | Update inventory unit to oz, g, lb, ml, kg, or l |
| "Can't find ingredient in recipes" | Name mismatch | Yield ingredient name must match recipe exactly |

---

## Old vs New Comparison

### Old System
- ❌ Could produce 72 oranges for 13.7 oz (10x error)
- ❌ No validation of suspicious outputs
- ❌ Unclear how math worked
- ❌ Could include multiple production dates simultaneously

### New System
- ✅ Produces 7 oranges for 13.7 oz (correct)
- ✅ Flags outputs with ratio > 5:1 for review
- ✅ Shows exact calculation steps
- ✅ Strictly isolated to selected date only
- ✅ Shows which products require each ingredient
- ✅ Validation warnings instead of bad outputs

---

## Implementation Details

### Functions
- `calculateIngredientDemandFixed`: Core calculation engine (new)
- `validateIngredientMath`: Math test suite (new)

### Components
- `IngredientNeedsResultFixed`: Enhanced UI with warnings (new)
- `YieldManager`: Yield configuration interface (new)

### Pages
- `ProductionPlanning`: Now has 4 tabs including new "Ingredient Yields" (updated)

---

## Questions?

Refer to `docs/IngredientMathSystem.md` for complete technical documentation of the 5-layer system.