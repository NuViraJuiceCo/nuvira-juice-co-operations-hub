import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Calendar, Package, ShoppingCart, RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import IngredientNeedsResult from "./IngredientNeedsResult";
import PreOrderSummary from "./PreOrderSummary";

export default function PreOrderBatchPlanner() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [preOrders, setPreOrders] = useState([]);
  const [error, setError] = useState(null);

  const preOrderStart = "2026-04-23";
  const preOrderEnd = "2026-04-30";

  useEffect(() => {
    loadPreOrders();
  }, []);

  const loadPreOrders = async () => {
    try {
      const orders = await base44.entities.ShopifyOrder.list("-created_date", 500);
      const filtered = orders.filter(o => {
        const createdDate = o.created_date?.split("T")[0];
        return createdDate >= preOrderStart && createdDate <= preOrderEnd;
      });
      setPreOrders(filtered);
    } catch (err) {
      console.error("Failed to load pre-orders:", err);
    }
  };

  const handleCalculate = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await base44.functions.invoke("calculateIngredientNeeds", {
        date_from: preOrderStart,
        date_to: preOrderEnd
      });
      setResult(res.data);
    } catch (err) {
      setError(err.message || "Calculation failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
        <h2 className="text-lg font-semibold text-blue-900 flex items-center gap-2 mb-2">
          <Package className="h-5 w-5" />
          Pre-Order Batch Planning
        </h2>
        <p className="text-sm text-blue-800">
          All orders placed April 23–30 (payment processes April 30). Calculate total ingredient needs and plan your production batches.
        </p>
      </div>

      {/* Pre-Order Summary */}
      <PreOrderSummary 
        preOrders={preOrders} 
        dateStart={preOrderStart}
        dateEnd={preOrderEnd}
        onRefresh={loadPreOrders}
      />

      {/* Calculate Button */}
      <div className="bg-card border border-border rounded-xl p-5">
        <Button 
          onClick={handleCalculate} 
          disabled={loading || preOrders.length === 0}
          className="gap-2"
        >
          {loading ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <ShoppingCart className="h-4 w-4" />
          )}
          {loading ? "Calculating..." : "Calculate Ingredient Needs"}
        </Button>
        {preOrders.length === 0 && (
          <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            No pre-orders yet. Orders will appear as they're created April 23–30.
          </p>
        )}
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
      {!result && !error && !loading && preOrders.length > 0 && (
        <div className="text-center py-16 bg-card border border-border rounded-xl">
          <ShoppingCart className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
          <h3 className="text-base font-medium text-foreground mb-1">Ready to Plan</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Click "Calculate Ingredient Needs" to see your full Restaurant Depot shopping list and batch recommendations.
          </p>
        </div>
      )}
    </div>
  );
}