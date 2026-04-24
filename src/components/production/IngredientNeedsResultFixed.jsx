import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, CheckCircle2, Package } from 'lucide-react';

const STATUS_COLORS = {
  purchase_needed: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', badge: 'bg-red-600 text-white' },
  no_stock_data: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', badge: 'bg-amber-500 text-white' },
  sufficient: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', badge: 'bg-emerald-600 text-white' },
  surplus: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', badge: 'bg-blue-600 text-white' },
};

const VALIDATION_MESSAGES = {
  MISSING_YIELD_DATA: 'Yield data missing — cannot convert to purchase units',
  INVALID_YIELD_VALUE: 'Yield value is zero or invalid',
  SUSPICIOUS_RATIO_UNITS_TO_OZ: 'Unit conversion is extremely high — divisor may be inverted',
  HIGH_RATIO_UNITS_TO_OZ_NEEDS_REVIEW: 'Unit conversion is high — needs manual review',
  YIELD_VALUE_UNUSUALLY_HIGH: 'Yield per unit is unusually high (>1000 oz)',
};

function IngredientRow({ ingredient, expanded, onToggleExpanded }) {
  const status = ingredient.status;
  const colors = STATUS_COLORS[status] || STATUS_COLORS.sufficient;
  const hasValidationIssues = ingredient.validation_flags && ingredient.validation_flags.length > 0;
  const hasSources = ingredient.sources && ingredient.sources.length > 0;
  const shouldAllowExpand = hasValidationIssues || hasSources;

  const purchase = ingredient.purchase || {};
  const unitLabel = purchase.purchase_unit || '?';
  const ozPerUnit = purchase.oz_per_unit;

  return (
    <div className={`border rounded-lg p-4 ${colors.bg} ${colors.border}`}>
      {/* Main row */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <h4 className="font-semibold text-foreground">{ingredient.ingredient_name}</h4>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors.badge}`}>
              {status}
            </span>
            {hasValidationIssues && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {ingredient.validation_flags.length} issue{ingredient.validation_flags.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Key metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="bg-white/60 rounded px-2 py-1.5">
              <p className="text-xs text-muted-foreground">Required</p>
              <p className="font-semibold text-foreground">{ingredient.demand_oz} oz</p>
            </div>
            <div className="bg-white/60 rounded px-2 py-1.5">
              <p className="text-xs text-muted-foreground">In Stock</p>
              <p className="font-semibold text-foreground">
                {ingredient.stock_oz !== null ? `${ingredient.stock_oz} oz` : '—'}
              </p>
            </div>
            <div className="bg-white/60 rounded px-2 py-1.5">
              <p className="text-xs text-muted-foreground">Shortage</p>
              <p className="font-semibold text-foreground">{ingredient.shortage_oz} oz</p>
            </div>
            {ingredient.supplier && (
              <div className="bg-white/60 rounded px-2 py-1.5">
                <p className="text-xs text-muted-foreground">Supplier</p>
                <p className="font-semibold text-foreground text-sm">{ingredient.supplier}</p>
              </div>
            )}
          </div>

          {/* Purchase recommendation */}
          {purchase.has_yield_data && ingredient.status === 'purchase_needed' && (
            <div className="mt-3 pt-3 border-t border-white/40">
              <p className="text-xs font-semibold text-foreground mb-2">Purchase Recommendation:</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <div className="bg-white/40 rounded px-2 py-1">
                  <p className="text-xs text-muted-foreground">Yield</p>
                  <p className="font-mono font-semibold text-foreground">
                    {ozPerUnit} oz/{unitLabel}
                  </p>
                </div>
                <div className="bg-white/40 rounded px-2 py-1">
                  <p className="text-xs text-muted-foreground">Order Qty</p>
                  <p className="font-mono font-semibold text-foreground">
                    {purchase.units_needed} {unitLabel}{purchase.units_needed !== 1 ? 's' : ''}
                  </p>
                </div>
                {purchase.units_per_case && (
                  <>
                    <div className="bg-white/40 rounded px-2 py-1">
                      <p className="text-xs text-muted-foreground">Pack Size</p>
                      <p className="font-mono font-semibold text-foreground">
                        {purchase.units_per_case}/{purchase.purchase_unit}
                      </p>
                    </div>
                    <div className="bg-white/40 rounded px-2 py-1">
                      <p className="text-xs text-muted-foreground">Cases</p>
                      <p className="font-mono font-semibold text-foreground">
                        {purchase.cases_needed}
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* No yield data warning */}
          {!purchase.has_yield_data && ingredient.status === 'purchase_needed' && (
            <div className="mt-3 pt-3 border-t border-white/40">
              <p className="text-xs font-semibold text-amber-700 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Cannot recommend purchase units — yield configuration missing
              </p>
            </div>
          )}
        </div>

        {/* Expand button */}
        {shouldAllowExpand && (
          <button
            onClick={() => onToggleExpanded(ingredient.ingredient_name)}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-1"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* Expanded details */}
      {expanded && shouldAllowExpand && (
        <div className="mt-4 pt-4 border-t border-white/40 space-y-4">
          {/* Validation flags */}
          {hasValidationIssues && (
            <div className="bg-orange-100 border border-orange-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-orange-800 mb-2 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                Data Issues:
              </p>
              <ul className="space-y-1">
                {ingredient.validation_flags.map((flag, i) => (
                  <li key={i} className="text-xs text-orange-800">
                    • {VALIDATION_MESSAGES[flag] || flag}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Sources breakdown */}
          {hasSources && (
            <div>
              <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1">
                <Package className="h-3.5 w-3.5" />
                Ingredient Sources:
              </p>
              <div className="space-y-1">
                {ingredient.sources.map((source, i) => (
                  <div key={i} className="bg-white/50 rounded px-2 py-1.5 text-xs">
                    <p className="font-medium text-foreground">{source.product_name}</p>
                    <p className="text-muted-foreground">
                      {source.batch_units} unit{source.batch_units !== 1 ? 's' : ''} × {source.ingredient_oz} oz = {source.ingredient_oz * source.batch_units} oz
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
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

  if (!result || !result.dates || result.dates.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
        <p className="text-sm text-amber-700">No production dates found for the selected range.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {result.dates.map((dateData) => (
        <div key={dateData.date} className="space-y-4">
          {/* Date header */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-foreground">{dateData.date}</h2>
              <p className="text-sm text-muted-foreground">
                {dateData.total_units} unit{dateData.total_units !== 1 ? 's' : ''} scheduled
                {dateData.batches && dateData.batches.length > 0 && ` · ${dateData.batches.map(b => b.product_name).join(', ')}`}
              </p>
            </div>
            {dateData.has_warnings && (
              <div className="bg-amber-100 border border-amber-300 rounded-lg px-3 py-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-700" />
                <span className="text-xs font-medium text-amber-700">Data issues detected</span>
              </div>
            )}
          </div>

          {/* Missing recipes warning */}
          {dateData.missing_recipes && dateData.missing_recipes.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-red-700 flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4" />
                Missing Recipe Mappings:
              </p>
              <ul className="text-sm text-red-600 space-y-1">
                {dateData.missing_recipes.map((recipe, i) => (
                  <li key={i}>• {recipe}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Ingredients */}
          {dateData.ingredients && dateData.ingredients.length > 0 ? (
            <div className="space-y-2">
              {dateData.ingredients.map((ingredient) => (
                <IngredientRow
                  key={ingredient.ingredient_name}
                  ingredient={ingredient}
                  expanded={expandedIngredients.has(ingredient.ingredient_name)}
                  onToggleExpanded={toggleExpanded}
                />
              ))}
            </div>
          ) : (
            <div className="bg-muted/30 border border-border rounded-lg p-4 text-center text-sm text-muted-foreground">
              No ingredient data available.
            </div>
          )}
        </div>
      ))}
    </div>
  );
}