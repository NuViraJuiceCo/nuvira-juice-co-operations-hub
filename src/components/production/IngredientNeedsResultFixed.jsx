import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STATUS_COLORS = {
  purchase_needed: 'bg-red-100 text-red-800',
  no_stock_data: 'bg-amber-100 text-amber-800',
  sufficient: 'bg-emerald-100 text-emerald-800',
  surplus: 'bg-blue-100 text-blue-800',
};

const VALIDATION_MESSAGES = {
  MISSING_YIELD_DATA: 'Yield data missing',
  INVALID_YIELD_VALUE: 'Invalid yield value',
  SUSPICIOUS_RATIO_UNITS_TO_OZ: 'Divisor may be inverted',
  HIGH_RATIO_UNITS_TO_OZ_NEEDS_REVIEW: 'High ratio — review yield',
  YIELD_VALUE_UNUSUALLY_HIGH: 'Yield unusually high',
};

function IngredientRow({ ingredient, expanded, onToggleExpanded }) {
  const purchase = ingredient.purchase || {};
  const hasValidationIssues = ingredient.validation_flags?.length > 0;
  const hasSources = ingredient.sources?.length > 0;
  const shouldExpand = hasValidationIssues || hasSources;

  return (
    <>
      {/* Main row */}
      <tr className="border-b border-border hover:bg-muted/30 transition-colors">
        <td className="px-4 py-3 text-sm font-medium text-foreground">
          {ingredient.ingredient_name}
        </td>
        <td className="px-4 py-3 text-sm text-right">
          {Math.round(ingredient.demand_oz * 10) / 10} oz
        </td>
        <td className="px-4 py-3 text-sm text-right">
          {ingredient.stock_oz !== null ? `${Math.round(ingredient.stock_oz * 10) / 10} oz` : '—'}
        </td>
        <td className="px-4 py-3 text-sm text-right font-semibold">
          {Math.round(ingredient.shortage_oz * 10) / 10} oz
        </td>
        <td className="px-4 py-3 text-sm">
          <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[ingredient.status]}`}>
            {ingredient.status.replace(/_/g, ' ')}
          </span>
        </td>
        <td className="px-4 py-3 text-sm">
          {purchase.has_yield_data && ingredient.status === 'purchase_needed' ? (
            <div className="font-mono text-xs bg-orange-50 px-2 py-1 rounded border border-orange-200">
              <div>{purchase.units_needed} {purchase.purchase_unit}s</div>
              {purchase.cases_needed !== undefined && (
                <div className="text-muted-foreground">{purchase.cases_needed} case{purchase.cases_needed !== 1 ? 's' : ''}</div>
              )}
            </div>
          ) : ingredient.status === 'purchase_needed' ? (
            <div className="text-xs text-amber-600 font-medium">Config missing</div>
          ) : (
            '—'
          )}
        </td>
        <td className="px-4 py-3 text-sm text-muted-foreground">{ingredient.supplier || '—'}</td>
        {shouldExpand && (
          <td className="px-4 py-3 text-center">
            <button
              onClick={() => onToggleExpanded(ingredient.ingredient_name)}
              className="text-muted-foreground hover:text-foreground inline-block"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </td>
        )}
      </tr>

      {/* Expanded details */}
      {expanded && shouldExpand && (
        <tr className="bg-muted/20 border-b border-border">
          <td colSpan="9" className="px-4 py-3">
            <div className="space-y-3">
              {/* Validation issues */}
              {hasValidationIssues && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                  <p className="text-xs font-semibold text-orange-800 mb-2 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Issues:
                  </p>
                  <div className="space-y-1">
                    {ingredient.validation_flags.map((flag, i) => (
                      <div key={i} className="text-xs text-orange-700">
                        • {VALIDATION_MESSAGES[flag] || flag}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sources */}
              {hasSources && (
                <div className="bg-white border border-border rounded-lg p-3">
                  <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1">
                    <Package className="h-3 w-3" />
                    Sources:
                  </p>
                  <div className="space-y-1">
                    {ingredient.sources.map((src, i) => (
                      <div key={i} className="text-xs text-muted-foreground">
                        <strong>{src.product_name}</strong> — {src.batch_units} units × {Math.round(src.ingredient_oz * 10) / 10} oz = {Math.round(src.ingredient_oz * src.batch_units * 10) / 10} oz
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function IngredientNeedsResultFixed({ result }) {
  const [expandedIngredients, setExpandedIngredients] = useState(new Set());

  const toggleExpanded = (ingredientName) => {
    const newSet = new Set(expandedIngredients);
    if (newSet.has(ingredientName)) {
      newSet.delete(ingredientName);
    } else {
      newSet.add(ingredientName);
    }
    setExpandedIngredients(newSet);
  };

  if (!result?.dates?.length) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
        <p className="text-sm text-amber-700">No production dates found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {result.dates.map((dateData) => (
        <div key={dateData.date} className="space-y-3">
          {/* Date header */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-foreground">{dateData.date}</h3>
              <p className="text-xs text-muted-foreground">
                {dateData.total_units} unit{dateData.total_units !== 1 ? 's' : ''} · {dateData.batches?.map(b => b.product_name).join(', ') || 'No batches'}
              </p>
            </div>
            {dateData.has_warnings && (
              <div className="bg-amber-100 border border-amber-300 rounded px-2 py-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-amber-700" />
                <span className="text-xs font-medium text-amber-700">Data issues</span>
              </div>
            )}
          </div>

          {/* Missing recipes */}
          {dateData.missing_recipes?.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded p-2.5">
              <p className="text-xs font-semibold text-red-700 mb-1">Missing Recipes:</p>
              <div className="text-xs text-red-600 space-y-0.5">
                {dateData.missing_recipes.map((r, i) => (
                  <div key={i}>• {r}</div>
                ))}
              </div>
            </div>
          )}

          {/* Ingredients table */}
          {dateData.ingredients?.length > 0 ? (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-foreground">Ingredient</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-foreground">Required</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-foreground">Stock</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-foreground">Shortage</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-foreground">Status</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-foreground">Order</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-foreground">Supplier</th>
                    <th className="px-4 py-2 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {dateData.ingredients.map((ingredient) => (
                    <IngredientRow
                      key={ingredient.ingredient_name}
                      ingredient={ingredient}
                      expanded={expandedIngredients.has(ingredient.ingredient_name)}
                      onToggleExpanded={toggleExpanded}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-muted/30 rounded p-3 text-center text-xs text-muted-foreground">
              No ingredient data
            </div>
          )}
        </div>
      ))}
    </div>
  );
}