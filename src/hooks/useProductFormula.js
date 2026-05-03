import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Normalize a product key for consistent matching
 * - Lowercase + trim
 * - Remove extra spaces
 * - Replace hyphens with spaces then collapse
 * - Remove common suffixes (juice, product, shot)
 */
function normalizeProductKey(key) {
  if (!key) return '';
  return key
    .toLowerCase()
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(juice|product|shot)\b/g, '')
    .trim();
}

/**
 * Product aliases for fuzzy matching
 */
const PRODUCT_ALIASES = {
  're nu': ['re-nu', 're nu', 'renu'],
  'oasis': ['oasis'],
  'aura': ['aura'],
  'reset shot': ['reset', 'reset shot'],
  'hydration shot': ['hydration', 'hydration shot'],
  'radiance shot': ['radiance', 'radiance shot'],
  'orange juice': ['orange', 'orange juice'],
  'pineapple juice': ['pineapple', 'pineapple juice'],
  'watermelon juice': ['watermelon', 'watermelon juice'],
};

/**
 * Try to match a batch product name against known Recipe records
 * Uses normalized matching + aliases for fuzzy matching
 */
function findBestRecipeMatch(recipes, batchProductName) {
  if (!recipes || recipes.length === 0 || !batchProductName) return null;

  const normalized = normalizeProductKey(batchProductName);

  // First pass: exact normalized match
  let match = recipes.find(r => normalizeProductKey(r.product_name) === normalized);
  if (match) return match;

  // Second pass: check aliases
  for (const [canonicalKey, aliases] of Object.entries(PRODUCT_ALIASES)) {
    if (aliases.includes(normalized)) {
      match = recipes.find(r => normalizeProductKey(r.product_name) === canonicalKey);
      if (match) return match;
    }
  }

  return null;
}

/**
 * Fetches the Recipe entity for a given product_name and returns
 * formatted ingredient lines + raw recipe data.
 * Uses normalized product matching to handle casing, spacing, and aliases.
 */
export function useProductFormula(productName) {
  const [recipe, setRecipe] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!productName) return;
    setLoading(true);
    setRecipe(null);
    setNotFound(false);

    // Fetch all recipes once, then filter
    base44.entities.Recipe.list(undefined, 100)
      .then(results => {
        const match = findBestRecipeMatch(results, productName);
        if (match) {
          setRecipe(match);
          setNotFound(false);
        } else {
          setNotFound(true);
        }
      })
      .catch(err => {
        console.error('[useProductFormula] Error fetching recipes:', err);
        setNotFound(true);
      })
      .finally(() => setLoading(false));
  }, [productName]);

  /**
   * Returns a human-readable summary string from recipe ingredients,
   * suitable for the ingredient_lot_notes / formula notes field.
   */
  const formulaSummary = recipe
    ? recipe.ingredients
        ?.map(i => `${i.ingredient_name}${i.quantity_oz ? ` ${i.quantity_oz}${i.unit || 'oz'}` : ''}${i.notes ? ` (${i.notes})` : ''}`)
        .join(', ') || ''
    : '';

  return { recipe, formulaSummary, loading, notFound };
}