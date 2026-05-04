/**
 * Resolves the ingredients for a BatchComplianceLog for display/print purposes.
 * Priority: embedded batch ingredients → default formula ingredients → built-in recipe lookup.
 * Read-only — no database writes.
 */

// Normalize product names to canonical form for recipe lookup
export function normalizeProductName(name) {
  if (!name) return 'Unknown';
  const n = name.trim();
  if (/re[\s-]?nu/i.test(n)) return 'Re-Nu';
  if (/reset/i.test(n)) return 'Reset Shot';
  if (/hydrat/i.test(n)) return 'Hydration Shot';
  if (/radiance/i.test(n)) return 'Radiance Shot';
  if (/watermelon/i.test(n)) return 'Watermelon Juice';
  if (/pineapple/i.test(n)) return 'Pineapple Juice';
  if (/orange/i.test(n)) return 'Orange Juice';
  if (/oasis/i.test(n)) return 'Oasis';
  if (/aura/i.test(n)) return 'Aura';
  return n;
}

// Built-in fallback recipe map (ingredient names only — used when no structured data on log)
const BUILT_IN_RECIPES = {
  'Re-Nu': ['Cucumber', 'Green Apple', 'Red Apple', 'Celery', 'Kale'],
  'Aura': ['Carrot', 'Pineapple', 'Orange', 'Ginger', 'Cucumber', 'Coconut Water', 'Sea Salt'],
  'Oasis': ['Watermelon', 'Pineapple', 'Orange', 'Lemon', 'Ginger', 'Coconut Water', 'Sea Salt', 'Black Pepper'],
  'Reset Shot': ['Pineapple', 'Lemon', 'Ginger', 'Black Salt'],
  'Hydration Shot': ['Coconut Water', 'Lime Juice', 'Honey', 'Mint', 'Pink Salt'],
  'Radiance Shot': ['Beetroot', 'Red Apple', 'Lemon'],
  'Orange Juice': ['Orange'],
  'Pineapple Juice': ['Pineapple'],
  'Watermelon Juice': ['Watermelon'],
};

/**
 * Returns { ingredients, source, lotNotes }
 *  - ingredients: array of { ingredient_name, quantity, unit, lot_number } or { ingredient_name } only
 *  - source: 'Batch Final Ingredients' | 'Default Product Formula' | 'Recipe Lookup' | null
 *  - lotNotes: string | null
 */
export function resolveIngredients(log) {
  const lotNotes = log.ingredient_lot_notes || null;

  // 1. BatchComplianceLog.ingredients (set during verifyAndLogBatch from actual batch data)
  if (log.ingredients?.length > 0) {
    return { ingredients: log.ingredients, source: 'Batch Final Ingredients', lotNotes };
  }

  // 2. BatchComplianceLog.final_batch_ingredients
  if (log.final_batch_ingredients?.length > 0) {
    return { ingredients: log.final_batch_ingredients, source: 'Batch Final Ingredients', lotNotes };
  }

  // 3. BatchComplianceLog.default_formula_ingredients
  if (log.default_formula_ingredients?.length > 0) {
    return { ingredients: log.default_formula_ingredients, source: 'Default Product Formula', lotNotes };
  }

  // 4. Built-in recipe lookup by normalized product name
  const normalized = normalizeProductName(log.juice_flavor || log.product_name);
  const builtIn = BUILT_IN_RECIPES[normalized];
  if (builtIn) {
    const ingredients = builtIn.map(name => ({ ingredient_name: name }));
    return { ingredients, source: 'Recipe Lookup', lotNotes };
  }

  // 5. No structured data — fall back to lot notes as text only
  if (lotNotes) {
    return { ingredients: null, source: null, lotNotes };
  }

  return { ingredients: null, source: null, lotNotes: null };
}