import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Calculator, BookOpen, RefreshCw, Calendar, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import IngredientNeedsResult from "../components/production/IngredientNeedsResult";
import RecipeManager from "../components/production/RecipeManager";
import PreOrderBatchPlanner from "../components/production/PreOrderBatchPlanner";

const TABS = [
  { id: "preorders", label: "Pre-Orders", icon: Package },
  { id: "planner", label: "Production Planner", icon: Calculator },
  { id: "recipes", label: "Recipes", icon: BookOpen }
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
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Production Planning</h1>
        <p className="text-muted-foreground mt-1">Calculate exactly how much produce to purchase based on incoming orders and your current inventory.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
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
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              Select Delivery Date Range
            </h2>
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">From</label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  className="w-44"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">To</label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  className="w-44"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={setToday}
                  className="text-xs px-3 py-2 rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground"
                >
                  Today
                </button>
                <button
                  onClick={setThisWeek}
                  className="text-xs px-3 py-2 rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground"
                >
                  This Week
                </button>
                <button
                  onClick={() => { setDateFrom(""); setDateTo(""); }}
                  className="text-xs px-3 py-2 rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground"
                >
                  All Active
                </button>
              </div>
              <Button onClick={handleCalculate} disabled={loading} className="gap-2">
                {loading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Calculator className="h-4 w-4" />
                )}
                {loading ? "Calculating..." : "Calculate Needs"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Leave dates empty to calculate needs across <strong>all active, unfulfilled orders</strong>. Use a date range to plan for a specific production day or week.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Results */}
          {result && <IngredientNeedsResult result={result} />}

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
    </div>
  );
}