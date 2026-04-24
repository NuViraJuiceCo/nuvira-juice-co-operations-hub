# NuVira Ingredient Math System - Complete Rebuild

## Overview

The ingredient demand calculation system has been completely rebuilt with a **5-layer architecture** to ensure mathematically correct, auditable, and transparent ingredient purchasing recommendations.

---

## 5-Layer Architecture

### Layer 1: Product/Recipe Demand
**Purpose**: Aggregate batch production quantities and apply recipes to calculate raw ingredient demand.

**Process**:
1. Filter production batches to the selected production date **only**
2. For each batch, look up its recipe mapping
3. For each ingredient in the recipe, multiply:
   - `ingredient_oz_per_bottle × recipe_yield_factor × batch_units`
4. Aggregate overlapping ingredients across all products for that date
5. Output: Total usable oz demand per ingredient for that date

**Isolation**: This layer is **strictly date-isolated**. Future production dates are never included.

**Example**:
```
May 1 Production:
- 2 Oasis batches
  - Recipe: Orange (5.2 oz/bottle), Lemon (1.1 oz/bottle)
  - Yield factor: 1.05
  - Orange demand: 5.2 × 1.05 × 2 = 10.92 oz
  - Lemon demand: 1.1 × 1.05 × 2 = 2.31 oz

- 5 Aura batches
  - Recipe: Orange (6 oz/bottle), Carrot (3 oz/bottle)
  - Yield factor: 1.05
  - Orange demand: 6 × 1.05 × 5 = 31.5 oz
  - Carrot demand: 3 × 1.05 × 5 = 15.75 oz

Total Orange demand for May 1: 10.92 + 31.5 = 42.42 oz
```

---

### Layer 2: Base Unit Normalization
**Purpose**: Convert all ingredient demands to a consistent, comparable base unit.

**Default Base Unit**: Fluid ounces (`oz`)

**Supported Unit Conversions**:
- `oz` / `fl oz` → 1:1 (base)
- `g` → ÷ 28.3495
- `kg` → × 1000 ÷ 28.3495
- `lb` → × 16
- `l` / `liter` → × 33.814
- `ml` → ÷ 29.5735

**Validation**: If unit is unrecognized, flag as `MISSING_STOCK_UNIT_DATA` and treat stock as unknown.

**Output**: All demands are now in a consistent base unit (oz) for comparison.

---

### Layer 3: Usable Yield Conversion
**Purpose**: Convert ingredient demand (in oz) into purchase units using yield data.

**Data Required**:
- `oz_per_purchase_unit`: Average usable oz obtained from one purchase unit
  - Example: 2.0 oz per orange, 28 oz per pineapple, 10 oz per bunch of kale

**Formula** (correct direction):
```
adjusted_shortfall = shortfall_oz × trim_waste_factor
purchase_units_needed = adjusted_shortfall / oz_per_purchase_unit
```

**Trim/Waste Factor**:
- Default: 1.0 (no waste)
- Example: 1.1 = 10% trim loss, so you need to order 10% extra
- Applied **before** division to account for processing loss

**Validation**:
- If `oz_per_purchase_unit` is missing or ≤ 0 → flag as `INVALID_YIELD_VALUE`
- If `oz_per_purchase_unit` > 1000 → flag as `YIELD_VALUE_UNUSUALLY_HIGH`
- If `units_needed / shortfall_oz > 5` → flag as `HIGH_RATIO_UNITS_TO_OZ_NEEDS_REVIEW`

**Example**:
```
Shortfall: 13.7 oz orange juice
Yield: 2.0 oz per orange
Waste: 1.0

Adjusted shortfall: 13.7 × 1.0 = 13.7 oz
Units needed: 13.7 / 2.0 = 6.85 → 7 oranges (rounded up)
```

---

### Layer 4: Case/Pack Conversion
**Purpose**: Convert purchase units into supplier pack/case recommendations.

**Data Required**:
- `units_per_case`: How many purchase units per supplier case
  - Example: 72 oranges per case, 6 pineapples per case

**Formula**:
```
cases_exact = units_needed / units_per_case
```

**Rounding Rules**:
1. **`round_up_unit`** (default): Round up to whole units, allow fractional cases
   - 7 oranges, 72 per case → 0.1 case (or "part case")

2. **`round_up_case`**: Always round up to full case
   - 7 oranges, 72 per case → 1 full case (72 units)

3. **`exact`**: Allow decimal precision, no rounding
   - 7 oranges, 72 per case → 0.097 cases

**Split Cases**:
- If `split_case_allowed = true`: Supplier accepts partial cases (default)
- If `split_case_allowed = false`: Must buy whole cases, rounds up

**Output**: Supplier case recommendation with exact and rounded values.

---

### Layer 5: Stock + Shortage Logic
**Purpose**: Subtract current inventory and calculate true shortage.

**Sequence** (correct order):
1. Calculate ingredient demand (Layer 1)
2. Normalize to base unit (Layer 2)
3. Get stock on hand, convert to base unit
4. Calculate shortage: `shortage_oz = max(0, demand_oz - stock_oz)`
5. Convert shortage to purchase units (Layer 3)
6. Convert to cases (Layer 4)

**Status Assignment**:
- **`purchase_needed`**: shortage > 0
- **`sufficient`**: shortage = 0, stock ≥ demand
- **`surplus`**: stock > demand × 1.3 (30% buffer)
- **`no_stock_data`**: No inventory data available

**Critical**: Do NOT convert full demand into purchase quantity if inventory covers part of it.

**Example**:
```
Pineapple demand: 220 oz
Stock on hand: 80 oz
Shortage: 220 - 80 = 140 oz

Purchase conversion: 140 oz / 28 oz per pineapple = 5 pineapples
NOT 220 oz / 28 = 7.86 pineapples
```

---

## Data Model: IngredientYield Entity

Each ingredient must have a yield configuration defining how it's purchased and used.

```json
{
  "ingredient_name": "Orange",
  "purchase_unit": "each",
  "oz_per_purchase_unit": 2.0,
  "trim_waste_factor": 1.0,
  "units_per_case": 72,
  "split_case_allowed": true,
  "rounding_rule": "round_up_unit",
  "supplier": "Local Produce Co",
  "notes": "Order by Tuesday for Friday delivery"
}
```

**Required Fields**:
- `ingredient_name`: Must match Recipe ingredient names
- `purchase_unit`: How it's purchased (each, bunch, lb, bag, bottle, case, carton, box, other)
- `oz_per_purchase_unit`: Average usable oz per unit

**Optional Fields**:
- `trim_waste_factor`: Default 1.0, accounts for processing loss
- `units_per_case`: For case calculations
- `split_case_allowed`: Default true, can split cases
- `rounding_rule`: Default "round_up_unit"
- `supplier`: Default supplier name
- `notes`: Administrative notes

---

## Validation & Error Flags

### Missing Data Flags
- `MISSING_YIELD_DATA`: No yield config exists for ingredient
- `INVALID_YIELD_VALUE`: Yield per unit is zero or missing
- `MISSING_STOCK_UNIT_DATA`: Stock unit is unrecognized

### Math Issues
- `HIGH_RATIO_UNITS_TO_OZ_NEEDS_REVIEW`: Units needed / oz demand > 5
  - Common cause: Inverted divisor, yield data from wrong source
  - Action: Verify yield values are correct

- `SUSPICIOUS_RATIO_UNITS_TO_OZ`: Units needed / oz demand > 100
  - Likely indicates divisor is inverted or yield is in wrong unit
  - Action: Stop and manually review

- `YIELD_VALUE_UNUSUALLY_HIGH`: Yield > 1000 oz per unit
  - Suspicious, likely data entry error
  - Action: Verify units are correct

### Display Behavior
- If yield data is missing: Show usable demand only, flag conversion as blocked
- If validation flags exist: Show warning banner with explanations
- Never display impossible outputs (e.g., 72 oranges for 13.7 oz without explanation)

---

## User Interface

### Production Planning Page - Tabs

1. **Pre-Orders**: Batch planning interface
2. **Production Planner**: 
   - Select date range
   - View ingredient demand with stock comparison
   - See purchase recommendations
   - Drill-down into ingredient sources (which products require this ingredient)
3. **Recipes**: Define product recipes
4. **Ingredient Yields**: Manage ingredient yield configurations

### Ingredient Row Display

For each ingredient:
- **Ingredient name** with status badge
- **Demand**: Required usable oz
- **Stock**: Current oz on hand (if available)
- **Shortage**: Oz still needed
- **Yield**: Usable oz per purchase unit
- **Order qty**: How many units to order
- **Pack size**: Units per supplier case (if defined)
- **Cases**: Recommended case quantity
- **Status**: purchase_needed, sufficient, surplus, or no_stock_data
- **Validation flags**: Click to expand and see details
- **Sources**: Click to expand and see which products require this ingredient

---

## Test Cases & Examples

### Test 1: Orange Math
**Input**: 13.7 oz demand, 2.0 oz per orange, 1.0 waste factor
**Expected**: 7 oranges
**Calculation**: (13.7 × 1.0) / 2.0 = 6.85 → 7

### Test 2: Lemon Math
**Input**: 1.1 oz demand, 1.1 oz per lemon, 1.0 waste factor
**Expected**: 1 lemon
**Calculation**: (1.1 × 1.0) / 1.1 = 1.0 → 1

### Test 3: With Waste
**Input**: 10 oz demand, 2.0 oz per unit, 1.1 waste factor
**Expected**: 6 units
**Calculation**: (10 × 1.1) / 2.0 = 5.5 → 6

### Test 4: Case Conversion
**Input**: 7 units, 72 per case
**Expected**: 0.1 cases
**Calculation**: 7 / 72 = 0.0972 → 0.1

### Test 5: Stock Subtraction
**Input**: 100 oz demand, 30 oz stock
**Expected**: 70 oz shortage
**Calculation**: max(0, 100 - 30) = 70

---

## Implementation Files

- **`functions/calculateIngredientDemandFixed`**: Core 5-layer calculation engine
- **`functions/validateIngredientMath`**: Test suite to verify math correctness
- **`components/production/IngredientNeedsResultFixed`**: Enhanced UI with validation warnings
- **`components/production/YieldManager`**: Admin interface for yield configuration
- **`pages/ProductionPlanning`**: Main planning page with 4 tabs

---

## Troubleshooting

### "72 oranges for 13.7 oz"
**Cause**: Yield value is inverted (0.19 instead of 2.0)
**Fix**: Check yield config. Oz per unit should be the usable amount from one purchase unit, not the inverse.

### "Weird case numbers"
**Cause**: Missing units_per_case or wrong rounding rule
**Fix**: Configure units_per_case and select appropriate rounding rule

### "Stock data missing"
**Cause**: InventoryItem stock unit not recognized
**Fix**: Use one of: oz, fl oz, g, kg, lb, l, ml

### "No purchase recommendation"
**Cause**: Yield config missing or invalid
**Fix**: Create yield config for ingredient. See "Ingredient Yields" tab.

---

## Migration Notes

The old `getIngredientDemandByDate` function has been replaced with `calculateIngredientDemandFixed`. The new system:
- Calculates math correctly (no more inverted formulas)
- Validates outputs and flags suspicious conversions
- Provides detailed breakdown of sources
- Isolates calculations to selected dates only
- Shows validation warnings instead of generating nonsense outputs

All existing IngredientYield records remain compatible.