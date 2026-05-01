import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import AdminGuide from "../components/shared/AdminGuide";
import BatchEditForm from "../components/production/BatchEditForm";
import ProductionDayCard from "../components/production/ProductionDayCard";
import IngredientPlanningPanel from "../components/production/IngredientPlanningPanel";
import RecipeEditor from "../components/production/RecipeEditor";
import IngredientYieldEditor from "../components/production/IngredientYieldEditor";
import PullToRefresh from "../components/shared/PullToRefresh";
import { SelectContent, SelectItem } from "@/components/ui/select";
import SelectMobile from "../components/SelectMobile";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import _ from "lodash";
import moment from "moment";

export default function Production() {
  const [batches, setBatches] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editingBatch, setEditingBatch] = useState(null);
  const [lastCalc, setLastCalc] = useState(null);
  const [ingredientData, setIngredientData] = useState({}); // date -> dateData
  const [ingredientLoading, setIngredientLoading] = useState(false);

  const loadIngredients = useCallback(async () => {
    setIngredientLoading(true);
    try {
      const res = await base44.functions.invoke('getIngredientDemandByDate', {});
      if (res.data?.dates) {
        const map = {};
        for (const d of res.data.dates) map[d.date] = d;
        setIngredientData(map);
      }
    } finally {
      setIngredientLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    const [batchData, orderData] = await Promise.all([
      base44.entities.ProductionBatch.list("production_date", 200),
      base44.entities.ShopifyOrder.list("-created_date", 200),
    ]);
    setBatches(batchData);
    setOrders(orderData);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    loadIngredients();

    let debounceTimer = null;
    const unsub = base44.entities.ProductionBatch.subscribe(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // Force fresh data load — invalidate and reload
        load();
        loadIngredients();
      }, 1000);
    });
    return () => {
      unsub();
      clearTimeout(debounceTimer);
    };
  }, [load, loadIngredients]);

  const handleRecalculate = async () => {
    setRecalculating(true);
    try {
      console.log('Starting recalculate...');
      const res = await base44.functions.invoke('recalculateProductionBatches', {});
      console.log('Recalculate response:', res.data);
      setLastCalc(res.data?.message || 'Done');
      // Force refresh after 1.5 second delay for database commit
      setTimeout(async () => {
        console.log('Refreshing production data...');
        await load();
        await loadIngredients();
      }, 1500);
    } catch (error) {
      console.error('Recalculate error:', error);
      setLastCalc('Error: ' + error.message);
    } finally {
      setRecalculating(false);
    }
  };

  const handleSaveEdit = async () => {
    setEditingBatch(null);
    await load();
  };

  const handleDelete = async (id) => {
    await base44.entities.ProductionBatch.delete(id);
    setBatches(prev => prev.filter(b => b.id !== id));
  };

  const handleToggleLock = async (batch) => {
    await base44.entities.ProductionBatch.update(batch.id, { is_locked: !batch.is_locked });
    await load();
  };

  const today = moment().format("YYYY-MM-DD");

  // Filter
  const filtered = batches.filter(b => {
    if (statusFilter !== "all" && b.status !== statusFilter) return false;
    if (categoryFilter !== "all" && b.product_category !== categoryFilter) return false;
    return true;
  });

  // Group by production date, only future/today
  const grouped = _.groupBy(
    filtered.filter(b => b.production_date >= today),
    b => b.production_date
  );

  const sortedDates = Object.keys(grouped).sort();
  const activeBatches = filtered.filter(b => b.status !== "Completed" && b.production_date >= today);
  const totalUnits = activeBatches.reduce((s, b) => s + (b.planned_units || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div className="space-y-6 p-4 sm:p-6 lg:p-8 w-full overflow-x-hidden pb-24 sm:pb-20 lg:pb-6">
          <AdminGuide
            title="Admin Guide — Production Planning"
            steps={[
              "Click 'Recalculate' to sync all order data into production cards. This runs automatically when orders change.",
              "Each card represents one product/flavor for a specific production date — quantities are pulled from all active orders.",
              "Bundles and packages are automatically decomposed into their individual products.",
              "Lock a production day once planning is finalized to prevent auto-recalculation from overwriting it.",
              "Edit any card to update status (Planned → In Production → Completed) and actual units produced.",
            ]}
            tips={[
              "The 'Total Orders' count shows bottles actually needed based on all decomposed order data.",
              "Subscriptions, bundles, and one-time orders all flow in automatically.",
              "Lock a date before production starts so changes to orders won't affect finalized plans.",
            ]}
          />

          {/* Header */}
          <div className="space-y-4">
            <div>
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-semibold text-foreground">Production Planning</h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                {activeBatches.length} active · {totalUnits} units
              </p>
              {lastCalc && (
                <p className="text-xs text-green-600 mt-1">{lastCalc}</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <SelectMobile value={categoryFilter} onValueChange={setCategoryFilter} placeholder="Category" triggerClassName="flex-1">
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="juice">Juice</SelectItem>
                  <SelectItem value="shot">Shot</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </SelectMobile>
              <SelectMobile value={statusFilter} onValueChange={setStatusFilter} placeholder="Status" triggerClassName="flex-1">
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="Planned">Planned</SelectItem>
                  <SelectItem value="Awaiting Ingredients">Await Ing</SelectItem>
                  <SelectItem value="In Production">Produc</SelectItem>
                  <SelectItem value="In Packing">Pack</SelectItem>
                  <SelectItem value="Completed">Done</SelectItem>
                </SelectContent>
              </SelectMobile>
              <Button
                onClick={handleRecalculate}
                disabled={recalculating}
                className="gap-2 flex-1 sm:flex-none text-xs sm:text-sm"
              >
                <RefreshCw className={`h-4 w-4 ${recalculating ? 'animate-spin' : ''}`} />
                <span>{recalculating ? 'Calc...' : 'Calc'}</span>
              </Button>
            </div>
          </div>

          {/* Admin tools — Recipe Editor + Yield/Pack Conversion Editor */}
          <RecipeEditor onRecipeSaved={loadIngredients} />
          <IngredientYieldEditor onSaved={loadIngredients} />

          {/* Production Days */}
          {sortedDates.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <p className="text-lg font-medium mb-2">No upcoming production scheduled</p>
              <p className="text-sm">Click Recalculate to generate production cards from active orders.</p>
            </div>
          ) : (
            <div className="space-y-10">
              {sortedDates.map(date => (
                <div key={date}>
                  <ProductionDayCard
                    date={date}
                    batches={grouped[date]}
                    orders={orders}
                    today={today}
                    onEdit={setEditingBatch}
                    onDelete={handleDelete}
                    onToggleLock={handleToggleLock}
                  />
                  <IngredientPlanningPanel
                    dateData={ingredientData[date]}
                    loading={ingredientLoading}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </PullToRefresh>

      {editingBatch && (
        <BatchEditForm
          batch={editingBatch}
          onClose={() => setEditingBatch(null)}
          onSave={handleSaveEdit}
        />
      )}
    </>
  );
}