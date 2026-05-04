import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Calculator, BookOpen, RefreshCw, Calendar, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import AdminGuide from "../components/shared/AdminGuide";
import IngredientNeedsResultFixed from "../components/production/IngredientNeedsResultFixed";
import YieldManager from "../components/production/YieldManager";
import RecipeManager from "../components/production/RecipeManager";
import PreOrderBatchPlanner from "../components/production/PreOrderBatchPlanner";

const TABS = [
  { id: "preorders", label: "Pre-Orders", icon: Package },
  { id: "planner", label: "Production Planner", icon: Calculator },
  { id: "recipes", label: "Recipes", icon: BookOpen },
  { id: "yields", label: "Ingredient Yields", icon: Package }
];

export default function ProductionPlanning() {
  const [activeTab, setActiveTab] = useState("planner");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleCalculate = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await base44.functions.invoke("calculateIngredientNeeds", {
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined
        });
        setResult(res.data);
        setLoading(false);
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < 2) await new Promise(r => setTimeout(r, 500));
      }
    }
    setError(lastErr?.message || "Calculation failed. Please try again.");
    setLoading(false);
  };

  const setToday = () => {
    const today = new Date().toISOString().split("T")[0];
    setDateFrom(today);
    setDateTo(today);
  };

  const setThisWeek = () => {
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - today.getDay() + 1);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    setDateFrom(monday.toISOString().split("T")[0]);
    setDateTo(sunday.toISOString().split("T")[0]);
  };

  return (
    <div className="space-y-5 p-4 sm:p-6 lg:p-8 w-full overflow-x-hidden" style={{ paddingBottom: 'calc(110px + env(safe-area-inset-bottom))' }}>
      {/* Header */}
      <div>
        <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Production Planning</h1>
        <p className="text-sm text-muted-foreground mt-1">Calculate exactly how much produce to purchase based on incoming orders and your current inventory.</p>
      </div>

      <AdminGuide
        title="Admin Guide — Production Planning"
        steps={[
          "Start in the Recipes tab to define your juice products and their ingredient requirements. Each recipe must list ingredients with quantities in oz per bottle.",
          "Go to Ingredient Yields to configure how each ingredient is purchased (per orange, per bunch, per lb, etc.) and its usable yield. This is critical for accurate ordering.",
          "Use the Production Planner to select production dates and calculate ingredient needs. The system shows exactly what to buy based on orders and current inventory.",
          "Pre-Orders tab shows upcoming orders scheduled for fulfillment. Use it to validate your batch planning before running production.",
        ]}
        tips={[
          "Ingredient names in recipes must match exactly with yield configurations — use consistent naming.",
          "The 'oz per purchase unit' yield field is crucial — it's how much usable juice you get from ONE unit (e.g., 2 oz per orange).",
          "After adding or updating recipes/yields, always run a fresh calculation to see the impact.",
          "Validation warnings appear if yield data is missing or seems suspicious — follow them to fix configuration issues.",
        ]}
      />

      {/* Tabs — scrollable on mobile */}
      <div className="flex gap-1 bg-muted p-1 rounded-lg overflow-x-auto scrollbar-none">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-md text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Pre-Orders Tab */}
      {activeTab === "preorders" && (
        <PreOrderBatchPlanner />
      )}

      {/* Production Planner Tab */}
      {activeTab === "planner" && (
        <div className="space-y-6">
          {/* Date Filter */}
          <div className="bg-card border border-border rounded-xl p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              Select Production Date Range
            </h2>
            {/* Date inputs — stack on mobile, row on desktop */}
            <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end sm:gap-4">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">From</label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  className="w-full sm:w-44 bg-green-50 border-green-200 text-black"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">To</label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  className="w-full sm:w-44 bg-green-50 border-green-200 text-black"
                />
              </div>
            </div>
            {/* Quick filters + calculate */}
            <div className="flex flex-wrap gap-2 mt-3">
              <button onClick={setToday} className="text-xs px-3 py-2 rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground">Today</button>
              <button onClick={setThisWeek} className="text-xs px-3 py-2 rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground">This Week</button>
              <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-xs px-3 py-2 rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground">All Active</button>
              <Button onClick={handleCalculate} disabled={loading} className="gap-2 ml-auto sm:ml-0">
                {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
                {loading ? "Calculating..." : "Calculate Needs"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Filter by <strong>production date</strong>. Leave blank for all upcoming. Select a range to see a specific run's needs.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Results */}
          {result && <IngredientNeedsResultFixed result={result} />}

          {/* Empty state */}
          {!result && !error && !loading && (
            <div className="text-center py-16 bg-card border border-border rounded-xl">
              <Calculator className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
              <h3 className="text-base font-medium text-foreground mb-1">Ready to Calculate</h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                Select a date range or leave blank for all active orders, then click "Calculate Needs" to see your full ingredient shopping list.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Recipes Tab */}
      {activeTab === "recipes" && <RecipeManager />}

      {/* Ingredient Yields Tab */}
      {activeTab === "yields" && <YieldManager />}
    </div>
  );
}