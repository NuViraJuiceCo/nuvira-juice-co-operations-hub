import { useState } from "react";
import { ChevronDown, ChevronUp, ShoppingCart, AlertTriangle, CheckCircle2, TrendingUp, Package, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";

const STATUS_CONFIG = {
  purchase_needed: {
    label: "Buy",
    bg: "bg-red-50 border-red-200",
    text: "text-red-700",
    badge: "bg-red-100 text-red-700",
    icon: ShoppingCart,
  },
  no_stock_data: {
    label: "No Stock Data",
    bg: "bg-amber-50 border-amber-200",
    text: "text-amber-700",
    badge: "bg-amber-100 text-amber-700",
    icon: AlertTriangle,
  },
  sufficient: {
    label: "Covered",
    bg: "bg-emerald-50 border-emerald-200",
    text: "text-emerald-700",
    badge: "bg-emerald-100 text-emerald-700",
    icon: CheckCircle2,
  },
  surplus: {
    label: "Surplus",
    bg: "bg-blue-50 border-blue-200",
    text: "text-blue-700",
    badge: "bg-blue-100 text-blue-700",
    icon: TrendingUp,
  },
};

function formatOz(oz) {
  if (oz === null || oz === undefined) return "—";
  if (oz >= 16) return `${Math.round((oz / 16) * 10) / 10} lbs`;
  return `${oz} oz`;
}

function IngredientRow({ ing }) {
  const [expanded, setExpanded] = useState(false);
  const config = STATUS_CONFIG[ing.status] || STATUS_CONFIG.no_stock_data;
  const Icon = config.icon;

  return (
    <div className={`border rounded-lg p-3 ${config.bg}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-foreground">{ing.name}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${config.badge}`}>
              {config.label}
            </span>
          </div>
          <div className="flex flex-wrap gap-3 mt-1.5 text-xs">
            <span className="text-muted-foreground">
              <span className="font-semibold text-foreground">Need:</span> {formatOz(ing.needed_oz)}
            </span>
            {ing.stock_oz !== null ? (
              <span className="text-muted-foreground">
                <span className="font-semibold text-foreground">Stock:</span> {formatOz(ing.stock_oz)}
              </span>
            ) : (
              <span className="text-amber-600 font-medium">No inventory data</span>
            )}
            {ing.status === 'purchase_needed' && ing.shortfall_oz > 0 && (
              <span className={`font-semibold ${config.text}`}>
                Buy: {formatOz(ing.shortfall_oz)}
              </span>
            )}
            {ing.status === 'sufficient' && ing.remaining_oz !== null && (
              <span className="text-emerald-600">
                Remaining: {formatOz(ing.remaining_oz)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Icon className={`h-4 w-4 ${config.text}`} />
          {ing.sources && ing.sources.length > 0 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-muted-foreground hover:text-foreground"
              title="Show breakdown by product"
            >
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>

      {expanded && ing.sources && ing.sources.length > 0 && (
        <div className="mt-2 pt-2 border-t border-current/20 space-y-1">
          <p className="text-xs font-medium text-muted-foreground mb-1">Breakdown by product:</p>
          {ing.sources.map((s, i) => (
            <div key={i} className="flex justify-between text-xs text-muted-foreground pl-2">
              <span>· {s.product} ({s.batch_units} units)</span>
              <span>{formatOz(s.qty_oz)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GroceryList({ items, date }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const lines = [`Grocery List — ${date}`, ''];
    items.forEach(item => {
      lines.push(`${item.name}: ${formatOz(item.amount_oz)}${item.supplier ? ` (${item.supplier})` : ''}`);
    });
    navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 text-emerald-600 text-sm py-3">
        <CheckCircle2 className="h-4 w-4" />
        All ingredients are covered by current stock.
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <ShoppingCart className="h-4 w-4 text-red-500" />
          Grocery Purchase List ({items.length} item{items.length !== 1 ? 's' : ''})
        </p>
        <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5 text-xs h-7">
          <Copy className="h-3 w-3" />
          {copied ? 'Copied!' : 'Copy List'}
        </Button>
      </div>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <span className="text-sm font-medium text-red-800">{item.name}</span>
            <div className="text-right">
              <span className="text-sm font-bold text-red-700">{formatOz(item.amount_oz)}</span>
              {item.supplier && (
                <p className="text-xs text-red-500">{item.supplier}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function IngredientPlanningPanel({ dateData }) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('ingredients');

  if (!dateData) return null;

  const { ingredients, grocery_list, missing_recipes, has_warnings } = dateData;
  const purchaseCount = grocery_list?.length || 0;
  const warningCount = missing_recipes?.length || 0;

  return (
    <div className="mt-6 border border-border rounded-xl overflow-hidden">
      {/* Panel header — always visible */}
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
          open ? 'bg-muted/60' : 'bg-muted/30 hover:bg-muted/50'
        }`}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Package className="h-4 w-4 text-primary" />
            Ingredient Planning
          </span>
          {purchaseCount > 0 && (
            <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full font-medium">
              {purchaseCount} to buy
            </span>
          )}
          {purchaseCount === 0 && ingredients.length > 0 && (
            <span className="bg-emerald-100 text-emerald-700 text-xs px-2 py-0.5 rounded-full font-medium">
              All covered
            </span>
          )}
          {warningCount > 0 && (
            <span className="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {warningCount} recipe{warningCount !== 1 ? 's' : ''} missing
            </span>
          )}
          {ingredients.length === 0 && warningCount === 0 && (
            <span className="text-xs text-muted-foreground">No recipe data — add ingredients to recipes</span>
          )}
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="p-4 space-y-4">
          {/* Missing recipe warnings */}
          {missing_recipes && missing_recipes.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5 mb-1">
                <AlertTriangle className="h-4 w-4" />
                Missing Recipe Mappings
              </p>
              <ul className="text-xs text-amber-700 space-y-0.5">
                {missing_recipes.map((r, i) => (
                  <li key={i}>· {r} — add ingredients in the Recipe Editor above</li>
                ))}
              </ul>
            </div>
          )}

          {ingredients.length > 0 && (
            <>
              {/* Tabs */}
              <div className="flex gap-1 bg-muted/40 rounded-lg p-1">
                <button
                  onClick={() => setActiveTab('ingredients')}
                  className={`flex-1 text-xs py-1.5 px-3 rounded-md font-medium transition-colors ${
                    activeTab === 'ingredients' ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  All Ingredients ({ingredients.length})
                </button>
                <button
                  onClick={() => setActiveTab('grocery')}
                  className={`flex-1 text-xs py-1.5 px-3 rounded-md font-medium transition-colors ${
                    activeTab === 'grocery' ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Grocery List {purchaseCount > 0 ? `(${purchaseCount})` : '✓'}
                </button>
              </div>

              {activeTab === 'ingredients' && (
                <div className="space-y-2">
                  {ingredients.map((ing, i) => (
                    <IngredientRow key={i} ing={ing} />
                  ))}
                </div>
              )}

              {activeTab === 'grocery' && (
                <GroceryList items={grocery_list} date={dateData.date} />
              )}
            </>
          )}

          {ingredients.length === 0 && (!missing_recipes || missing_recipes.length === 0) && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No ingredient data available. Add ingredients to your recipes using the Recipe Editor.
            </p>
          )}
        </div>
      )}
    </div>
  );
}