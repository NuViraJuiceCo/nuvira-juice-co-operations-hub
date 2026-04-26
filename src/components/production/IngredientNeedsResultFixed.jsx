import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Package, Zap } from 'lucide-react';

const STATUS_CONFIG = {
  purchase_needed: { badge: 'bg-red-500', label: 'Buy Now', text: 'text-red-700' },
  sufficient: { badge: 'bg-emerald-500', label: 'Covered', text: 'text-emerald-700' },
  surplus: { badge: 'bg-blue-500', label: 'Surplus', text: 'text-blue-700' },
};

function IngredientRow({ ingredient, expanded, onToggleExpanded }) {
  const config = STATUS_CONFIG[ingredient.status] || STATUS_CONFIG.sufficient;
  
  const needed = Math.round(ingredient.needed_oz * 10) / 10;
  const stock = Math.round((ingredient.current_stock_oz || 0) * 10) / 10;
  const shortfall = Math.round((ingredient.shortfall_oz || 0) * 10) / 10;

  return (
    <div className="border border-border rounded-lg overflow-hidden mb-3">
      <div className="bg-card hover:bg-muted/30 transition-colors">
        <button
          onClick={() => onToggleExpanded(ingredient.ingredient)}
          className="w-full text-left px-6 py-4 flex items-center justify-between gap-4 group"
        >
          {/* Left: Name and status */}
          <div className="flex-1 min-w-0">
            <h4 className="text-base font-bold text-foreground group-hover:text-primary transition-colors">
              {ingredient.ingredient}
            </h4>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${config.badge} text-white mt-1.5`}>
              <Zap className="h-3 w-3" />
              {config.label}
            </span>
          </div>

          {/* Middle: Quantities */}
          <div className="hidden sm:grid grid-cols-3 gap-6 text-right flex-1">
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-0.5">Needed</p>
              <p className="text-lg font-bold text-foreground">{needed}<span className="text-xs text-muted-foreground ml-1">oz</span></p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-0.5">Stock</p>
              <p className="text-lg font-bold text-foreground">{stock}<span className="text-xs text-muted-foreground ml-1">oz</span></p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium mb-0.5">Shortfall</p>
              <p className="text-lg font-bold text-red-600">{shortfall}<span className="text-xs text-muted-foreground ml-1">oz</span></p>
            </div>
          </div>

          {/* Right: Order recommendation */}
          <div className="flex-shrink-0 text-right">
            {ingredient.status === 'purchase_needed' ? (
              <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                <p className="text-xs text-orange-600 font-medium mb-1">Buy</p>
                <p className="text-sm font-bold text-orange-700">
                  {ingredient.cases_needed_rounded || '—'} case{ingredient.cases_needed_rounded !== 1 ? 's' : ''}
                </p>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">✓</div>
            )}
          </div>

          {/* Chevron */}
          <div className="text-muted-foreground group-hover:text-foreground flex-shrink-0">
            {expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </div>
        </button>
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className="bg-muted/20 border-t border-border px-6 py-4 space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground font-bold">Needed (oz)</p>
              <p className="font-semibold text-foreground mt-1">{needed}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-bold">Stock (oz)</p>
              <p className="font-semibold text-foreground mt-1">{stock}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-bold">Shortfall (oz)</p>
              <p className="font-semibold text-red-600 mt-1">{shortfall}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-bold">Shortfall (lbs)</p>
              <p className="font-semibold text-foreground mt-1">{Math.round((ingredient.shortfall_lbs || 0) * 100) / 100}</p>
            </div>
          </div>
          
          {ingredient.supplier && (
            <div className="pt-3 border-t border-border">
              <p className="text-xs font-bold text-muted-foreground mb-1">Supplier</p>
              <p className="text-sm font-semibold text-foreground">{ingredient.supplier}</p>
            </div>
          )}

          {ingredient.cases_needed && ingredient.status === 'purchase_needed' && (
            <div className="pt-3 border-t border-border bg-orange-50 rounded p-3">
              <p className="text-xs font-bold text-orange-700 mb-2">Order Details</p>
              <div className="space-y-1 text-sm">
                <p className="text-orange-700"><strong>Cases:</strong> {ingredient.cases_needed_rounded}</p>
                {ingredient.supplier_packaging_qty && (
                  <p className="text-orange-700"><strong>Pack:</strong> {ingredient.supplier_packaging_qty}</p>
                )}
                {ingredient.cost_per_supplier_unit && (
                  <p className="text-orange-700"><strong>Cost/Unit:</strong> ${ingredient.cost_per_supplier_unit.toFixed(2)}</p>
                )}
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

  if (!result?.ingredient_needs?.length) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
        <p className="text-sm text-amber-700 font-medium">
          {result?.summary?.total_orders === 0 
            ? 'No orders found for the selected range.'
            : 'No ingredients needed (all orders fulfilled or no recipe matches).'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Summary section */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-lg font-bold text-foreground mb-4">Summary</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-muted-foreground font-medium">Total Orders</p>
            <p className="text-2xl font-bold text-foreground mt-1">{result.summary.total_orders}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium">Matched Orders</p>
            <p className="text-2xl font-bold text-foreground mt-1">{result.summary.matched_orders}</p>
          </div>
          {Object.keys(result.summary.bottle_counts || {}).length > 0 && (
            <div className="sm:col-span-2">
              <p className="text-xs text-muted-foreground font-medium mb-2">Products</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(result.summary.bottle_counts).map(([prod, qty]) => (
                  <span key={prod} className="inline-block px-2.5 py-1 bg-primary/10 text-primary rounded text-xs font-semibold">
                    {qty}× {prod}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        {result.summary.unmatched_items?.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs font-semibold text-amber-700 mb-2">⚠ Unmatched Items (no recipe):</p>
            <div className="flex flex-wrap gap-2">
              {result.summary.unmatched_items.map((item, i) => (
                <span key={i} className="text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded border border-amber-200">
                  {item}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Ingredients list */}
      <div className="space-y-0">
        <h2 className="text-lg font-bold text-foreground mb-4">Ingredient Needs</h2>
        {result.ingredient_needs.map((ingredient) => (
          <IngredientRow
            key={ingredient.ingredient}
            ingredient={ingredient}
            expanded={expandedIngredients.has(ingredient.ingredient)}
            onToggleExpanded={toggleExpanded}
          />
        ))}
      </div>

      {/* Orders included */}
      {result.orders_included?.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-6">
          <h3 className="font-semibold text-foreground mb-3">Orders Included ({result.orders_included.length})</h3>
          <div className="space-y-2">
            {result.orders_included.slice(0, 5).map((order) => (
              <div key={order.id} className="flex justify-between text-sm">
                <span className="font-medium text-foreground">{order.order_number}</span>
                <span className="text-muted-foreground">{order.delivery_date}</span>
              </div>
            ))}
            {result.orders_included.length > 5 && (
              <p className="text-xs text-muted-foreground pt-2 border-t border-border">
                ... and {result.orders_included.length - 5} more orders
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}