import { ShoppingCart, CheckCircle, TrendingUp, AlertTriangle } from "lucide-react";

const statusConfig = {
  purchase_needed: {
    label: "Purchase Needed",
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
    icon: ShoppingCart,
    iconColor: "text-red-500"
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

export default function IngredientNeedsResult({ result }) {
  if (!result) return null;

  const { summary, ingredient_needs } = result;
  const purchaseNeeded = ingredient_needs.filter(i => i.status === "purchase_needed");
  const sufficient = ingredient_needs.filter(i => i.status !== "purchase_needed");

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Orders Included</p>
          <p className="text-2xl font-bold text-foreground mt-1">{summary.total_orders}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Matched Orders</p>
          <p className="text-2xl font-bold text-foreground mt-1">{summary.matched_orders}</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-xs text-red-600 uppercase tracking-wide">Need to Purchase</p>
          <p className="text-2xl font-bold text-red-700 mt-1">{purchaseNeeded.length}</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <p className="text-xs text-emerald-600 uppercase tracking-wide">In Stock ✓</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1">{sufficient.length}</p>
        </div>
      </div>

      {/* Bottle counts per product */}
      {summary.bottle_counts && Object.keys(summary.bottle_counts).length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">Bottles to Produce</h3>
          <div className="flex flex-wrap gap-3">
            {Object.entries(summary.bottle_counts).map(([product, count]) => (
              <div key={product} className="px-4 py-2 bg-primary/10 rounded-lg">
                <span className="text-sm font-bold text-primary">{count}</span>
                <span className="text-sm text-muted-foreground ml-1.5">× {product}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unmatched items warning */}
      {summary.unmatched_items?.length > 0 && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Some order items have no matching recipe</p>
            <p className="text-xs text-amber-700 mt-0.5">{summary.unmatched_items.join(", ")}</p>
            <p className="text-xs text-amber-600 mt-1">Add recipes for these products in the Recipes tab.</p>
          </div>
        </div>
      )}

      {/* Ingredients Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Ingredient Requirements (with 5% production buffer)</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Ingredient</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Need (oz)</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Need (lbs)</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">In Stock (oz)</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Shortfall (lbs)</th>
                <th className="px-5 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody>
              {ingredient_needs.map((ing) => {
                const cfg = statusConfig[ing.status] || statusConfig.sufficient;
                const Icon = cfg.icon;
                return (
                  <tr key={ing.ingredient} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="text-sm font-medium text-foreground capitalize">{ing.ingredient}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right text-sm text-foreground font-mono">{ing.needed_oz}</td>
                    <td className="px-5 py-3.5 text-right text-sm text-foreground font-mono">{ing.needed_lbs}</td>
                    <td className="px-5 py-3.5 text-right text-sm text-muted-foreground font-mono">{ing.current_stock_oz}</td>
                    <td className="px-5 py-3.5 text-right">
                      {ing.shortfall_oz > 0 ? (
                        <span className="text-sm font-bold text-red-600 font-mono">{ing.shortfall_lbs} lbs</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </td>
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
      </div>
    </div>
  );
}