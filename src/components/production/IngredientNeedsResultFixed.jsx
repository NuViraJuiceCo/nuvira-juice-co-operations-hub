import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Package, Zap } from 'lucide-react';

const STATUS_CONFIG = {
  purchase_needed: { badge: 'bg-red-500', label: 'Buy Now', text: 'text-red-700' },
  no_stock_data: { badge: 'bg-amber-500', label: 'No Data', text: 'text-amber-700' },
  sufficient: { badge: 'bg-emerald-500', label: 'Covered', text: 'text-emerald-700' },
  surplus: { badge: 'bg-blue-500', label: 'Surplus', text: 'text-blue-700' },
};

const VALIDATION_MESSAGES = {
  MISSING_YIELD_DATA: 'Yield configuration missing — cannot calculate order quantity',
  INVALID_YIELD_VALUE: 'Invalid yield value (zero or missing)',
  SUSPICIOUS_RATIO_UNITS_TO_OZ: 'Suspicious ratio — divisor may be inverted',
  HIGH_RATIO_UNITS_TO_OZ_NEEDS_REVIEW: 'High unit-to-oz ratio — verify yield is correct',
  YIELD_VALUE_UNUSUALLY_HIGH: 'Unusually high yield value (>1000 oz)',
};

function IngredientRow({ ingredient, expanded, onToggleExpanded }) {
  const purchase = ingredient.purchase || {};
  const config = STATUS_CONFIG[ingredient.status] || STATUS_CONFIG.sufficient;
  const hasValidationIssues = ingredient.validation_flags?.length > 0;
  const hasSources = ingredient.sources?.length > 0;
  const shouldExpand = hasValidationIssues || hasSources;

  const shortageOz = Math.round(ingredient.shortage_oz * 10) / 10;
  const demandOz = Math.round(ingredient.demand_oz * 10) / 10;
  const stockOz = ingredient.stock_oz !== null ? Math.round(ingredient.stock_oz * 10) / 10 : null;

  return (
    <>
      {/* Main row */}
      <div className="border border-border rounded-lg overflow-hidden mb-3">
        <div className="bg-card hover:bg-muted/30 transition-colors">
          <button
            onClick={() => onToggleExpanded(ingredient.ingredient_name)}
            className="w-full text-left px-6 py-4 flex items-center justify-between gap-4 group"
          >
            {/* Left: Name and status */}
            <div className="flex-1 min-w-0">
              <h4 className="text-base font-bold text-foreground group-hover:text-primary transition-colors">
                {ingredient.ingredient_name}
              </h4>
              <div className="flex items-center gap-2 mt-1.5">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${config.badge} text-white`}>
                  <Zap className="h-3 w-3" />
                  {config.label}
                </span>
                {hasValidationIssues && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-500/20 text-orange-700">
                    <AlertTriangle className="h-3 w-3" />
                    {ingredient.validation_flags.length} issue{ingredient.validation_flags.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>

            {/* Middle: Quantities */}
            <div className="hidden sm:grid grid-cols-3 gap-6 text-right flex-1">
              <div>
                <p className="text-xs text-muted-foreground font-medium mb-0.5">Required</p>
                <p className="text-lg font-bold text-foreground">{demandOz}<span className="text-xs text-muted-foreground ml-1">oz</span></p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium mb-0.5">Stock</p>
                <p className="text-lg font-bold text-foreground">{stockOz !== null ? `${stockOz}` : '—'}<span className="text-xs text-muted-foreground ml-1">{stockOz !== null ? 'oz' : ''}</span></p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium mb-0.5">Shortage</p>
                <p className="text-lg font-bold text-red-600">{shortageOz}<span className="text-xs text-muted-foreground ml-1">oz</span></p>
              </div>
            </div>

            {/* Right: Order recommendation */}
            <div className="flex-shrink-0 text-right">
              {purchase.has_yield_data && ingredient.status === 'purchase_needed' ? (
                <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                  <p className="text-xs text-orange-600 font-medium mb-1">Order</p>
                  <p className="text-sm font-bold text-orange-700">
                    {purchase.units_needed} {purchase.purchase_unit}{purchase.units_needed !== 1 ? 's' : ''}
                  </p>
                  {purchase.cases_needed !== undefined && (
                    <p className="text-xs text-orange-600 mt-1">
                      {purchase.cases_needed} case{purchase.cases_needed !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>
              ) : ingredient.status === 'purchase_needed' ? (
                <div className="text-xs text-amber-600 font-semibold">Need config</div>
              ) : (
                <div className="text-xs text-muted-foreground">—</div>
              )}
            </div>

            {/* Chevron */}
            {shouldExpand && (
              <div className="text-muted-foreground group-hover:text-foreground flex-shrink-0">
                {expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
              </div>
            )}
          </button>
        </div>

        {/* Expanded section */}
        {expanded && shouldExpand && (
          <div className="bg-muted/20 border-t border-border px-6 py-4 space-y-4">
            {/* Validation issues */}
            {hasValidationIssues && (
              <div className="bg-orange-50 border-l-4 border-orange-500 rounded p-3.5">
                <p className="text-sm font-bold text-orange-900 mb-2 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Data Issues
                </p>
                <div className="space-y-1">
                  {ingredient.validation_flags.map((flag, i) => (
                    <p key={i} className="text-sm text-orange-800">
                      • {VALIDATION_MESSAGES[flag] || flag}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* Yield details (if purchase_needed) */}
            {purchase.has_yield_data && ingredient.status === 'purchase_needed' && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white border border-border rounded-lg p-3">
                  <p className="text-xs text-muted-foreground font-medium">Yield</p>
                  <p className="text-sm font-bold text-foreground mt-1">{purchase.oz_per_unit} oz/{purchase.purchase_unit}</p>
                </div>
                <div className="bg-white border border-border rounded-lg p-3">
                  <p className="text-xs text-muted-foreground font-medium">Order Qty</p>
                  <p className="text-sm font-bold text-foreground mt-1">{purchase.units_needed} {purchase.purchase_unit}s</p>
                </div>
                {purchase.units_per_case && (
                  <>
                    <div className="bg-white border border-border rounded-lg p-3">
                      <p className="text-xs text-muted-foreground font-medium">Pack Size</p>
                      <p className="text-sm font-bold text-foreground mt-1">{purchase.units_per_case} per case</p>
                    </div>
                    <div className="bg-white border border-border rounded-lg p-3">
                      <p className="text-xs text-muted-foreground font-medium">Cases</p>
                      <p className="text-sm font-bold text-foreground mt-1">{purchase.cases_needed}</p>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Sources */}
            {hasSources && (
              <div className="bg-white border border-border rounded-lg p-4">
                <p className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" />
                  Sources ({ingredient.sources.length})
                </p>
                <div className="space-y-2">
                  {ingredient.sources.map((src, i) => (
                    <div key={i} className="bg-muted/40 rounded p-2.5 text-sm">
                      <p className="font-semibold text-foreground">{src.product_name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {src.batch_units} unit{src.batch_units !== 1 ? 's' : ''} × {Math.round(src.ingredient_oz * 10) / 10} oz = <strong>{Math.round(src.ingredient_oz * src.batch_units * 10) / 10} oz</strong>
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Supplier info */}
            {ingredient.supplier && (
              <div className="bg-white border border-border rounded-lg p-3">
                <p className="text-xs text-muted-foreground font-medium">Supplier</p>
                <p className="text-sm font-semibold text-foreground mt-1">{ingredient.supplier}</p>
              </div>
            )}
          </div>
        )}
      </div>
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
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
        <p className="text-sm text-amber-700 font-medium">No production dates found for the selected range.</p>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      {result.dates.map((dateData) => (
        <div key={dateData.date}>
          {/* Date header */}
          <div className="mb-6">
            <div className="flex items-baseline justify-between gap-4 mb-2">
              <h2 className="text-3xl font-bold text-foreground">{dateData.date}</h2>
              {dateData.has_warnings && (
                <div className="bg-amber-100 border border-amber-300 rounded-lg px-3 py-1.5 flex items-center gap-2 flex-shrink-0">
                  <AlertTriangle className="h-4 w-4 text-amber-700" />
                  <span className="text-xs font-bold text-amber-700">Data issues detected</span>
                </div>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              <strong>{dateData.total_units}</strong> unit{dateData.total_units !== 1 ? 's' : ''} scheduled
              {dateData.batches?.length > 0 && ` • ${dateData.batches.map(b => b.product_name).join(', ')}`}
            </p>
          </div>

          {/* Missing recipes warning */}
          {dateData.missing_recipes?.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <p className="text-sm font-bold text-red-800 mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Missing Recipe Mappings
              </p>
              <ul className="space-y-1">
                {dateData.missing_recipes.map((recipe, i) => (
                  <li key={i} className="text-sm text-red-700">• {recipe}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Ingredients */}
          {dateData.ingredients?.length > 0 ? (
            <div className="space-y-0">
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
            <div className="bg-muted/40 rounded-lg p-6 text-center">
              <p className="text-sm text-muted-foreground font-medium">No ingredient data available</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}