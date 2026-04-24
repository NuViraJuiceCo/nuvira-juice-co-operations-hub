import { useState } from "react";
import {
  ChevronDown, ChevronUp, ShoppingCart, AlertTriangle, CheckCircle2,
  TrendingUp, Package, Copy, Scale, Boxes
} from "lucide-react";
import { Button } from "@/components/ui/button";

const STATUS_CONFIG = {
  purchase_needed: {
    label: "Buy",
    bg: "bg-white border-red-400",
    text: "text-red-700",
    badge: "bg-red-600 text-white",
    icon: ShoppingCart,
  },
  no_stock_data: {
    label: "No Stock Data",
    bg: "bg-white border-amber-400",
    text: "text-amber-700",
    badge: "bg-amber-500 text-white",
    icon: AlertTriangle,
  },
  sufficient: {
    label: "Covered",
    bg: "bg-white border-emerald-400",
    text: "text-emerald-700",
    badge: "bg-emerald-600 text-white",
    icon: CheckCircle2,
  },
  surplus: {
    label: "Surplus",
    bg: "bg-white border-blue-400",
    text: "text-blue-700",
    badge: "bg-blue-600 text-white",
    icon: TrendingUp,
  },
};

function formatOz(oz) {
  if (oz === null || oz === undefined) return "—";
  if (oz >= 128) return `${Math.round((oz / 16) * 10) / 10} lbs`;
  if (oz >= 16) return `${Math.round((oz / 16) * 10) / 10} lbs`;
  return `${Math.round(oz * 10) / 10} oz`;
}

function PurchaseBadge({ purchase }) {
  if (!purchase) return null;

  if (!purchase.has_yield_data) {
    return (
      <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200">
        <AlertTriangle className="h-3 w-3" />
        Yield data missing
      </span>
    );
  }

  if (purchase.units_needed === undefined) return null;

  const unitLabel = purchase.purchase_unit || 'unit';
  const plural = purchase.units_needed !== 1 ? 's' : '';

  return (
    <span className="inline-flex items-center gap-1 text-xs bg-orange-100 text-orange-800 px-2 py-0.5 rounded-full border border-orange-200 font-medium">
      <Scale className="h-3 w-3" />
      Order: {purchase.units_needed} {unitLabel}{plural}
      {purchase.cases_needed !== null && purchase.units_per_case
        ? ` (${purchase.cases_needed} case${purchase.cases_needed !== 1 ? 's' : ''})`
        : ''}
    </span>
  );
}

function IngredientRow({ ing, view }) {
  const [expanded, setExpanded] = useState(false);
  const config = STATUS_CONFIG[ing.status] || STATUS_CONFIG.no_stock_data;
  const Icon = config.icon;
  const p = ing.purchase;

  if (view === 'supplier') {
    // Supplier order view
    const hasPurchase = p?.has_yield_data && ing.status === 'purchase_needed';
    return (
      <div className={`border rounded-lg p-3 ${hasPurchase ? 'bg-orange-50 border-orange-200' : config.bg}`}>
        <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-gray-900">{ing.name}</span>
            {ing.supplier && (
              <span className="text-xs text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">{ing.supplier}</span>
            )}
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${config.badge}`}>
              {config.label}
            </span>
          </div>

          {ing.status === 'purchase_needed' && (
            <div className="mt-2 space-y-1">
              {!p?.has_yield_data ? (
                <p className="text-xs text-amber-700 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Yield / Pack Conversion Missing — configure in Yield Editor to get order quantities
                  </p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="bg-white border border-orange-200 rounded-lg p-2">
                     <p className="text-gray-500">Shortage</p>
                     <p className="font-bold text-orange-800">{formatOz(ing.shortfall_oz)}</p>
                    </div>
                    <div className="bg-white border border-orange-200 rounded-lg p-2">
                     <p className="text-gray-500">Yield per {p.purchase_unit}</p>
                     <p className="font-bold text-orange-800">{p.oz_per_unit} oz</p>
                    </div>
                    <div className="bg-white border border-orange-300 rounded-lg p-2">
                     <p className="text-gray-500">Order qty</p>
                     <p className="font-bold text-orange-900">{p.units_needed} {p.purchase_unit}{p.units_needed !== 1 ? 's' : ''}</p>
                    </div>
                    {p.units_per_case && (
                     <div className="bg-white border border-orange-300 rounded-lg p-2">
                       <p className="text-gray-500">Cases</p>
                       <p className="font-bold text-orange-900">
                         {p.cases_needed} case{p.cases_needed !== 1 ? 's' : ''}
                         <span className="text-gray-500 font-normal"> ({p.units_per_case}/{p.purchase_unit === 'each' ? 'case' : p.purchase_unit})</span>
                       </p>
                     </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {ing.status === 'sufficient' && (
              <p className="text-xs text-emerald-600 mt-1">
                Stock covers demand. Remaining after production: {formatOz(ing.remaining_oz)}
              </p>
            )}
            {ing.status === 'surplus' && (
              <p className="text-xs text-blue-600 mt-1">
                Surplus stock: {formatOz(ing.remaining_oz)} remaining
              </p>
            )}
            {ing.status === 'no_stock_data' && (
              <p className="text-xs text-amber-600 mt-1">
                Need: {formatOz(ing.needed_oz)} — no inventory data to check against
              </p>
            )}
          </div>
          <Icon className={`h-4 w-4 ${config.text} shrink-0 mt-0.5`} />
        </div>
      </div>
    );
  }

  // Default ingredient demand view
  return (
    <div className={`border rounded-lg p-3 ${config.bg}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-gray-900">{ing.name}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${config.badge}`}>
              {config.label}
            </span>
            {ing.status === 'purchase_needed' && <PurchaseBadge purchase={p} />}
          </div>
          <div className="flex flex-wrap gap-3 mt-1.5 text-xs">
            <span className="text-gray-700">
              <span className="font-semibold text-gray-900">Need:</span> {formatOz(ing.needed_oz)}
            </span>
            {ing.stock_oz !== null ? (
              <span className="text-gray-700">
                <span className="font-semibold text-gray-900">Stock:</span> {formatOz(ing.stock_oz)}
              </span>
            ) : (
              <span className="text-amber-700 font-medium">No inventory data</span>
            )}
            {ing.status === 'purchase_needed' && ing.shortfall_oz > 0 && (
              <span className={`font-semibold ${config.text}`}>
                Shortage: {formatOz(ing.shortfall_oz)}
              </span>
            )}
            {ing.status === 'sufficient' && ing.remaining_oz !== null && (
              <span className="text-emerald-600">
                Remaining: {formatOz(ing.remaining_oz)}
              </span>
            )}
          </div>

          {/* Purchase detail when expanded or purchase_needed */}
          {ing.status === 'purchase_needed' && p?.has_yield_data && p.units_needed !== undefined && (
            <div className="mt-2 pt-2 border-t border-gray-200 text-xs grid grid-cols-2 sm:grid-cols-3 gap-2">
              <span className="text-gray-500">Yield: <span className="font-medium text-gray-900">{p.oz_per_unit} oz/{p.purchase_unit}</span></span>
              <span className="text-gray-500">Order: <span className="font-semibold text-gray-900">{p.units_needed} {p.purchase_unit}{p.units_needed !== 1 ? 's' : ''}</span></span>
              {p.units_per_case && (
                <span className="text-gray-500">Cases: <span className="font-semibold text-gray-900">{p.cases_needed} ({p.split_case_allowed ? 'split ok' : 'full cases only'})</span></span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
        <Icon className={`h-4 w-4 ${config.text}`} />
        {ing.sources && ing.sources.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-gray-400 hover:text-gray-700"
          >
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>

      {expanded && ing.sources && ing.sources.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-200 space-y-1">
          <p className="text-xs font-medium text-gray-500 mb-1">Breakdown by product:</p>
          {ing.sources.map((s, i) => (
            <div key={i} className="flex justify-between text-xs text-gray-600 pl-2">
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
    const lines = [`Grocery / Supplier Order — ${date}`, ''];
    items.forEach(item => {
      const p = item.purchase;
      let line = `${item.name}: ${formatOz(item.amount_oz)}`;
      if (p?.has_yield_data && p.units_needed !== undefined) {
        line += ` → ${p.units_needed} ${p.purchase_unit}${p.units_needed !== 1 ? 's' : ''}`;
        if (p.cases_needed !== null) line += ` (${p.cases_needed} case${p.cases_needed !== 1 ? 's' : ''})`;
      }
      if (item.supplier) line += ` — ${item.supplier}`;
      lines.push(line);
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
      <div className="space-y-2">
        {items.map((item, i) => {
          const p = item.purchase;
          return (
            <div key={i} className="bg-white border border-red-400 rounded-lg px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium text-red-800">{item.name}</span>
                {item.supplier && (
                  <span className="text-xs text-red-400 shrink-0">{item.supplier}</span>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
                <span className="text-red-700">Shortage: <span className="font-bold">{formatOz(item.amount_oz)}</span></span>
                {p?.has_yield_data && p.units_needed !== undefined ? (
                  <>
                    <span className="text-orange-700">→ Order: <span className="font-bold">{p.units_needed} {p.purchase_unit}{p.units_needed !== 1 ? 's' : ''}</span></span>
                    {p.units_per_case && (
                      <span className="text-orange-600">= <span className="font-bold">{p.cases_needed} case{p.cases_needed !== 1 ? 's' : ''}</span> of {p.units_per_case}</span>
                    )}
                  </>
                ) : (
                  <span className="text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Yield data missing — add in Yield Editor
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function IngredientPlanningPanel({ dateData }) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('ingredients');
  const [view, setView] = useState('demand'); // 'demand' | 'supplier'

  if (!dateData) return null;

  const { ingredients, grocery_list, missing_recipes } = dateData;
  const purchaseCount = grocery_list?.length || 0;
  const warningCount = missing_recipes?.length || 0;
  const missingYieldCount = ingredients.filter(i => i.status === 'purchase_needed' && !i.purchase?.has_yield_data).length;

  return (
    <div className="mt-6 border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${open ? 'bg-muted/60' : 'bg-muted/30 hover:bg-muted/50'}`}
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
          {missingYieldCount > 0 && (
            <span className="bg-orange-100 text-orange-700 text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
              <Scale className="h-3 w-3" />
              {missingYieldCount} yield config missing
            </span>
          )}
          {ingredients.length === 0 && warningCount === 0 && (
            <span className="text-xs text-muted-foreground">No recipe data</span>
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
              {/* View toggle + Tabs */}
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                {/* View toggle */}
                <div className="flex gap-1 bg-muted/40 rounded-lg p-1 w-fit">
                  <button
                    onClick={() => setView('demand')}
                    className={`flex items-center gap-1.5 text-xs py-1.5 px-3 rounded-md font-medium transition-colors ${view === 'demand' ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    <Package className="h-3 w-3" />
                    Ingredient Demand
                  </button>
                  <button
                    onClick={() => setView('supplier')}
                    className={`flex items-center gap-1.5 text-xs py-1.5 px-3 rounded-md font-medium transition-colors ${view === 'supplier' ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    <Boxes className="h-3 w-3" />
                    Supplier Order View
                  </button>
                </div>

                {/* Tab selector */}
                <div className="flex gap-1 bg-muted/40 rounded-lg p-1 w-fit">
                  <button
                    onClick={() => setActiveTab('ingredients')}
                    className={`text-xs py-1.5 px-3 rounded-md font-medium transition-colors ${activeTab === 'ingredients' ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    All ({ingredients.length})
                  </button>
                  <button
                    onClick={() => setActiveTab('grocery')}
                    className={`text-xs py-1.5 px-3 rounded-md font-medium transition-colors ${activeTab === 'grocery' ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Purchase List {purchaseCount > 0 ? `(${purchaseCount})` : '✓'}
                  </button>
                </div>
              </div>

              {activeTab === 'ingredients' && (
                <div className="space-y-2">
                  {ingredients.map((ing, i) => (
                    <IngredientRow key={i} ing={ing} view={view} />
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