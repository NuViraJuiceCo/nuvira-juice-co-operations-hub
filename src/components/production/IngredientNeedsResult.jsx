import { ShoppingCart, CheckCircle, TrendingUp, AlertTriangle, Scale, Package } from "lucide-react";

const statusConfig = {
  purchase_needed: {
    label: "Purchase Needed",
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
    icon: ShoppingCart,
    iconColor: "text-red-500"
  },
  no_stock_data: {
    label: "No Stock Data",
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
    icon: AlertTriangle,
    iconColor: "text-amber-500"
  },
  sufficient: {
    label: "Sufficient",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
    icon: CheckCircle,
    iconColor: "text-emerald-500"
  },
  surplus: {
    label: "Surplus",
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
    icon: TrendingUp,
    iconColor: "text-blue-500"
  }
};

function formatOz(oz) {
  if (oz === null || oz === undefined) return "—";
  if (oz >= 16) return `${Math.round((oz / 16) * 100) / 100} lbs`;
  return `${Math.round(oz * 10) / 10} oz`;
}

function DateBlock({ dateData }) {
  const { date, batches, ingredients, grocery_list, missing_recipes } = dateData;
  const purchaseCount = grocery_list?.length || 0;
  const inStockCount = ingredients.filter(i => i.status === 'sufficient' || i.status === 'surplus').length;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Date header */}
      <div className="px-5 py-4 border-b border-border bg-muted/30 flex flex-wrap items-center gap-4">
        <div>
          <h3 className="text-sm font-bold text-foreground">
            Production: {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {batches.map(b => `${b.planned_units} × ${b.product_name}`).join(' · ')}
          </p>
        </div>
        <div className="ml-auto flex gap-2 flex-wrap">
          {purchaseCount > 0 && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-red-100 text-red-700 font-medium">{purchaseCount} to buy</span>
          )}
          {inStockCount > 0 && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 font-medium">{inStockCount} in stock</span>
          )}
        </div>
      </div>

      {/* Missing recipe warnings */}
      {missing_recipes?.length > 0 && (
        <div className="mx-5 mt-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-amber-800">Missing recipe mappings:</p>
            <p className="text-xs text-amber-700 mt-0.5">{missing_recipes.join(', ')}</p>
          </div>
        </div>
      )}

      {/* Ingredients table */}
      {ingredients.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Ingredient</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Need</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">In Stock</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Shortfall</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Order Qty</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Supplier</th>
                <th className="px-5 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody>
              {ingredients.map((ing) => {
                const cfg = statusConfig[ing.status] || statusConfig.sufficient;
                const Icon = cfg.icon;
                const p = ing.purchase;
                return (
                  <tr key={ing.name} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="text-sm font-medium text-foreground">{ing.name}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right text-sm text-foreground font-mono">{formatOz(ing.needed_oz)}</td>
                    <td className="px-5 py-3.5 text-right text-sm text-muted-foreground font-mono">
                      {ing.stock_oz !== null ? formatOz(ing.stock_oz) : <span className="text-amber-500">—</span>}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {ing.shortfall_oz > 0 ? (
                        <span className="text-sm font-bold text-red-600 font-mono">{formatOz(ing.shortfall_oz)}</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {ing.status === 'purchase_needed' && (
                        p?.has_yield_data && p.units_needed !== undefined ? (
                          <span className="text-sm font-semibold text-orange-700">
                            {p.units_needed} {p.purchase_unit}{p.units_needed !== 1 ? 's' : ''}
                            {p.cases_needed !== null ? ` (${p.cases_needed} case${p.cases_needed !== 1 ? 's' : ''})` : ''}
                          </span>
                        ) : (
                          <span className="text-xs text-amber-600 flex items-center gap-1">
                            <Scale className="h-3 w-3" /> Yield missing
                          </span>
                        )
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-muted-foreground">{ing.supplier || '—'}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex justify-center">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text} ${cfg.border} border`}>
                          <Icon className={`h-3 w-3 ${cfg.iconColor}`} />
                          {cfg.label}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {ingredients.length === 0 && !missing_recipes?.length && (
        <p className="px-5 py-6 text-sm text-muted-foreground text-center">No ingredient data — add ingredients to recipes first.</p>
      )}
    </div>
  );
}

export default function IngredientNeedsResult({ result }) {
  if (!result) return null;

  // New shape: { success, dates: [...] }
  const dates = result.dates || [];

  if (dates.length === 0) {
    return (
      <div className="text-center py-12 bg-card border border-border rounded-xl">
        <Package className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm font-medium text-foreground">No production batches found in this date range.</p>
        <p className="text-xs text-muted-foreground mt-1">Try a different date range or check that batches have been calculated.</p>
      </div>
    );
  }

  const totalToBuy = dates.reduce((s, d) => s + (d.grocery_list?.length || 0), 0);
  const totalUnits = dates.reduce((s, d) => s + (d.total_units || 0), 0);

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Production Days</p>
          <p className="text-2xl font-bold text-foreground mt-1">{dates.length}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Units</p>
          <p className="text-2xl font-bold text-foreground mt-1">{totalUnits}</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-xs text-red-600 uppercase tracking-wide">Ingredients to Buy</p>
          <p className="text-2xl font-bold text-red-700 mt-1">{totalToBuy}</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <p className="text-xs text-emerald-600 uppercase tracking-wide">In Stock ✓</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1">
            {dates.reduce((s, d) => s + d.ingredients.filter(i => i.status === 'sufficient' || i.status === 'surplus').length, 0)}
          </p>
        </div>
      </div>

      {/* One block per production date */}
      {dates.map(d => <DateBlock key={d.date} dateData={d} />)}
    </div>
  );
}