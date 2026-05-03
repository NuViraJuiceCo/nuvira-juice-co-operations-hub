import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import AdminGuide from "../components/shared/AdminGuide";
import BatchEditForm from "../components/production/BatchEditForm";
import BatchStartForm from "../components/production/BatchStartForm";
import BatchCompleteForm from "../components/production/BatchCompleteForm";
import BatchVerifyForm from "../components/production/BatchVerifyForm";
import BatchHistory from "../components/production/BatchHistory";
import ProductionDayCard from "../components/production/ProductionDayCard";
import IngredientPlanningPanel from "../components/production/IngredientPlanningPanel";
import RecipeEditor from "../components/production/RecipeEditor";
import IngredientYieldEditor from "../components/production/IngredientYieldEditor";
import PullToRefresh from "../components/shared/PullToRefresh";
import { SelectContent, SelectItem } from "@/components/ui/select";
import SelectMobile from "../components/SelectMobile";
import { Button } from "@/components/ui/button";
import { RefreshCw, Play, CheckSquare, FileCheck } from "lucide-react";
import _ from "lodash";
import moment from "moment";

export default function Production() {
  const [batches, setBatches] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [tab, setTab] = useState("today");
  const [editingBatch, setEditingBatch] = useState(null);
  const [startingBatch, setStartingBatch] = useState(null);
  const [completingBatch, setCompletingBatch] = useState(null);
  const [verifyingBatch, setVerifyingBatch] = useState(null);
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
    const [batchData, planData] = await Promise.all([
      base44.entities.ProductionBatch.list("production_date", 200),
      base44.functions.invoke('getProductionPlanningData', {}),
    ]);
    setBatches(batchData);
    setOrders(planData.data?.production_rows || []);
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

  const handleEditBatch = (batch) => {
    // Route to the appropriate form based on batch status
    if (batch.status === 'in_production') {
      // In progress batches should go to completion form, not edit
      setCompletingBatch(batch);
    } else {
      // Other statuses use basic edit form
      setEditingBatch(batch);
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

  const handleSaveAction = async () => {
    setStartingBatch(null);
    setCompletingBatch(null);
    setVerifyingBatch(null);
    await load();
  };

  const today = moment().format("YYYY-MM-DD");

  // Filter
  const filtered = batches.filter(b => {
    if (statusFilter !== "all" && b.status !== statusFilter) return false;
    if (categoryFilter !== "all" && b.product_category !== categoryFilter) return false;
    return true;
  });

  // Group by production date, include past 7 days + future (allows retrospective batch logging)
  const sevenDaysAgo = moment(today).subtract(7, 'days').format('YYYY-MM-DD');
  const grouped = _.groupBy(
    filtered.filter(b => b.production_date >= sevenDaysAgo),
    b => b.production_date
  );

  const sortedDates = Object.keys(grouped).sort();
  const activeBatches = filtered.filter(b => b.status !== "completed" && b.production_date >= today);
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

          {/* Header + Tabs */}
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

            {/* Tabs */}
            <div className="flex gap-2 border-b">
              <button
                onClick={() => setTab("today")}
                className={`px-3 py-2 text-sm font-medium border-b-2 ${
                  tab === "today"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                📅 Today & Upcoming
              </button>
              <button
                onClick={() => setTab("in_progress")}
                className={`px-3 py-2 text-sm font-medium border-b-2 ${
                  tab === "in_progress"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                ⚙️ In Progress
              </button>
              <button
                onClick={() => setTab("verify")}
                className={`px-3 py-2 text-sm font-medium border-b-2 ${
                  tab === "verify"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                ✓ Needs Verification
              </button>
              <button
                onClick={() => setTab("history")}
                className={`px-3 py-2 text-sm font-medium border-b-2 ${
                  tab === "history"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                📋 History
              </button>
            </div>

            {tab !== "history" && (
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
                    <SelectItem value="planned">Planned</SelectItem>
                    <SelectItem value="ready_for_production">Ready</SelectItem>
                    <SelectItem value="in_production">In Progress</SelectItem>
                    <SelectItem value="completed_pending_verification">Pending Verify</SelectItem>
                    <SelectItem value="verified_logged">Verified</SelectItem>
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
            )}
          </div>

          {/* Batch History Tab */}
          {tab === "history" ? (
            <BatchHistory />
          ) : (
            <>
              {/* Admin tools — Recipe Editor + Yield/Pack Conversion Editor */}
              {tab === "today" && (
                <>
                  <RecipeEditor onRecipeSaved={loadIngredients} />
                  <IngredientYieldEditor onSaved={loadIngredients} />
                </>
              )}

              {/* Today & Upcoming Tab */}
              {tab === "today" && (
                <>
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
                             onEdit={handleEditBatch}
                             onDelete={handleDelete}
                             onToggleLock={handleToggleLock}
                             onStart={setStartingBatch}
                           />
                          <IngredientPlanningPanel
                            dateData={ingredientData[date]}
                            loading={ingredientLoading}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* In Progress Tab */}
              {tab === "in_progress" && (
                <div className="space-y-3">
                  {batches.filter(b => b.status === 'in_production').length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">No batches in production.</p>
                  ) : (
                    batches.filter(b => b.status === 'in_production').map(batch => (
                      <div key={batch.id} className="bg-card border rounded-lg p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h3 className="font-semibold">{batch.batch_id}</h3>
                            <p className="text-sm text-muted-foreground">{batch.product_name}</p>
                          </div>
                          <span className="text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-700">IN PRODUCTION</span>
                        </div>
                        <div className="grid grid-cols-3 gap-3 text-sm mb-3">
                          <div>
                            <p className="text-muted-foreground text-xs">Started</p>
                            <p className="font-medium">{moment(batch.actual_start_time).format('HH:mm')}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">Staff</p>
                            <p className="font-medium">{(batch.staff_on_duty || []).length} on duty</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">Planned Qty</p>
                            <p className="font-medium">{batch.planned_units}</p>
                          </div>
                        </div>
                        <Button
                          onClick={() => setCompletingBatch(batch)}
                          size="sm"
                          className="gap-2 w-full"
                        >
                          <CheckSquare className="h-4 w-4" />
                          Mark Complete
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Needs Verification Tab */}
              {tab === "verify" && (
                <div className="space-y-3">
                  {batches.filter(b => b.status === 'completed_pending_verification').length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">No batches pending verification.</p>
                  ) : (
                    batches.filter(b => b.status === 'completed_pending_verification').map(batch => (
                      <div key={batch.id} className="bg-card border border-orange-200 rounded-lg p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h3 className="font-semibold">{batch.batch_id}</h3>
                            <p className="text-sm text-muted-foreground">{batch.product_name}</p>
                          </div>
                          <span className="text-xs px-2 py-1 rounded bg-orange-100 text-orange-700">PENDING</span>
                        </div>
                        <div className="grid grid-cols-4 gap-3 text-sm mb-3">
                          <div>
                            <p className="text-muted-foreground text-xs">Quantity</p>
                            <p className="font-medium">{batch.actual_quantity_produced || '-'}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">pH</p>
                            <p className="font-medium">{batch.pH_result || '-'}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">Status</p>
                            <p className={`font-medium text-xs ${batch.passed_failed === 'passed' ? 'text-green-600' : 'text-red-600'}`}>
                              {batch.passed_failed?.toUpperCase() || '-'}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">Complete</p>
                            <p className="font-medium text-xs">
                              {batch.actual_quantity_produced && batch.pH_result && batch.passed_failed ? '✓' : '-'}
                            </p>
                          </div>
                        </div>
                        <Button
                          onClick={() => setVerifyingBatch(batch)}
                          disabled={batch.status !== 'completed_pending_verification'}
                          size="sm"
                          className="gap-2 w-full"
                        >
                          <FileCheck className="h-4 w-4" />
                          Verify & Log
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
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

      {startingBatch && (
        <BatchStartForm
          batch={startingBatch}
          onClose={() => setStartingBatch(null)}
          onSave={handleSaveAction}
        />
      )}

      {completingBatch && (
        <BatchCompleteForm
          batch={completingBatch}
          onClose={() => setCompletingBatch(null)}
          onSave={handleSaveAction}
        />
      )}

      {verifyingBatch && (
        <BatchVerifyForm
          batch={verifyingBatch}
          onClose={() => setVerifyingBatch(null)}
          onSave={handleSaveAction}
        />
      )}
    </>
  );
}