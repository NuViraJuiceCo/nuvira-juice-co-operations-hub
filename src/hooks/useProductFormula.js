import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Fetches the Recipe entity for a given product_name and returns
 * formatted ingredient lines + raw recipe data.
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

    base44.entities.Recipe.filter({ product_name: productName })
      .then(results => {
        const match = results?.find(r => r.is_active !== false) || results?.[0];
        if (match) {
          setRecipe(match);
        } else {
          setNotFound(true);
        }
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