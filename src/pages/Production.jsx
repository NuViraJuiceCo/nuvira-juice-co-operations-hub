import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import AdminGuide from "../components/shared/AdminGuide";
import PreProductionChecklist from "../components/production/PreProductionChecklist";

import BatchProcessForm from "../components/production/BatchProcessForm";
import BatchVerifyForm from "../components/production/BatchVerifyForm";
import BatchHistory from "../components/production/BatchHistory";
import ProductionDayCard from "../components/production/ProductionDayCard";
import IngredientPlanningPanel from "../components/production/IngredientPlanningPanel";
import RecipeEditor from "../components/production/RecipeEditor";
import IngredientYieldEditor from "../components/production/IngredientYieldEditor";
import SubscriptionLiveVerificationPanel from "../components/production/SubscriptionLiveVerificationPanel";
import PullToRefresh from "../components/shared/PullToRefresh";
import { SelectContent, SelectItem } from "@/components/ui/select";
import SelectMobile from "../components/SelectMobile";
import { Button } from "@/components/ui/button";
import { RefreshCw, Play, CheckSquare, FileCheck, ClipboardCheck } from "lucide-react";
import _ from "lodash";
import moment from "moment";

export default function Production() {
  const [batches, setBatches] = useState([]);
  const [orders, setOrders] = useState([]);
  const [fulfillmentTasks, setFulfillmentTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [tab, setTab] = useState("today");

  const [processingBatch, setProcessingBatch] = useState(null);
  const [processingMode, setProcessingMode] = useState('edit');
  const [verifyingBatch, setVerifyingBatch] = useState(null);
  const [preCheckBatch, setPreCheckBatch] = useState(null); // batch waiting for pre-production checklist
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
    const [batchData, planData, ftData] = await Promise.all([
      base44.entities.ProductionBatch.list("production_date", 200),
      base44.functions.invoke('getProductionPlanningData', {}),
      base44.entities.FulfillmentTask.list('-scheduled_date', 500),
    ]);
    setBatches(batchData);
    setOrders(planData.data?.production_rows || []);
    setFulfillmentTasks(ftData);
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
    setProcessingMode('edit');
    setProcessingBatch(batch);
  };

  // Show pre-production checklist gate before starting a batch
  const handleStartBatch = (batch) => {
    setPreCheckBatch(batch);
  };

  const handleChecklistConfirm = () => {
    if (preCheckBatch) {
      setProcessingMode('start');
      setProcessingBatch(preCheckBatch);
      setPreCheckBatch(null);
    }
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
    setProcessingBatch(null);
    setVerifyingBatch(null);
    await load();
  };

  const today = moment().format("YYYY-MM-DD");

  // Helper: check if batch is fully completed/verified and delivered (hide from active view)
  const isBatchDone = (b) => {
    const completedStatuses = ['verified_logged', 'completed', 'archived', 'fulfilled'];
    return completedStatuses.includes(b.status);
  };

  // Filter
  const filtered = batches.filter(b => {
    if (statusFilter !== "all" && b.status !== statusFilter) return false;
    if (categoryFilter !== "all" && b.product_category !== categoryFilter) return false;
    return true;
  });

  // Active view: always hide completed/verified/archived batches (moved to History)
  const visibleForActiveView = tab === "today"
    ? filtered.filter(b => !isBatchDone(b))
    : filtered;

  // Group by production date (include past 7 days + all future existing batches)
  const sevenDaysAgo = moment(today).subtract(7, 'days').format('YYYY-MM-DD');
  const grouped = _.groupBy(
    visibleForActiveView.filter(b => b.production_date >= sevenDaysAgo),
    b => b.production_date
  );

  const sortedDates = Object.keys(grouped).sort();
  // Active batches: those that still need operational action (not completed/verified)
  const activeBatches = visibleForActiveView.filter(b => b.status !== "completed" && b.production_date >= today);
  const totalUnits = activeBatches.reduce((s, b) => s + (b.planned_units || 0), 0);

  // Build fulfillment tasks lookup map by order_id for efficient rendering
  const fulfillmentTasksByOrderId = {};
  fulfillmentTasks.forEach(task => {
    if (task.order_id) {
      if (!fulfillmentTasksByOrderId[task.order_id]) {
        fulfillmentTasksByOrderId[task.order_id] = [];
      }
      fulfillmentTasksByOrderId[task.order_id].push(task);
    }
  });

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
        <div className="space-y-6 p-4 sm:p-6 lg:p-8 w-full overflow-x-hidden" style={{ paddingBottom: 'calc(110px + env(safe-area-inset-bottom))' }}>
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

            {/* Tabs — horizontally scrollable on mobile */}
            <div className="flex gap-0 border-b overflow-x-auto scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
              {[
                { id: "today", mobileLabel: "📅 Today", desktopLabel: "📅 Today & Upcoming" },
                { id: "in_progress", mobileLabel: "⚙️ In Progress", desktopLabel: "⚙️ In Progress" },
                { id: "verify", mobileLabel: "✓ Verify", desktopLabel: "✓ Needs Verification" },
                { id: "subscription_verify", mobileLabel: "🔐 Sub Verify", desktopLabel: "🔐 Subscription Clearance" },
                { id: "history", mobileLabel: "📋 History", desktopLabel: "📋 History" },
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`shrink-0 whitespace-nowrap px-3 py-2.5 text-xs sm:text-sm font-medium border-b-2 transition-colors ${
                    tab === t.id
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="sm:hidden">{t.mobileLabel}</span>
                  <span className="hidden sm:inline">{t.desktopLabel}</span>
                </button>
              ))}
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
                  {/* Pre-production reminder banner for today's batches */}
                  {grouped[today] && grouped[today].some(b => b.status === 'planned' || b.status === 'ready_for_production') && (
                    <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 flex items-start gap-2.5">
                      <ClipboardCheck className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-amber-800">Production Day Reminders</p>
                        <p className="text-[11px] text-amber-700 mt-0.5">
                          Before starting today's batches: confirm sanitation log, daily checklist, and temperature log are completed.
                          Click <strong>Start</strong> on any batch to see the pre-production checklist.
                        </p>
                      </div>
                      <a href="/compliance" className="shrink-0 text-[10px] font-semibold text-amber-700 underline whitespace-nowrap">Open Logs →</a>
                    </div>
                  )}
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
                                fulfillmentTasksByOrderId={fulfillmentTasksByOrderId}
                                onEdit={handleEditBatch}
                                onDelete={handleDelete}
                                onToggleLock={handleToggleLock}
                                onStart={handleStartBatch}
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
                         onClick={() => handleStartBatch(batch)}
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

              {/* Subscription Clearance Tab */}
              {tab === "subscription_verify" && (
                <SubscriptionLiveVerificationPanel />
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
                            <p className="font-medium">
                              {batch.actual_quantity_produced ?? batch.actual_units ?? batch.actual_quantity ?? '-'}
                            </p>
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



      {preCheckBatch && (
        <PreProductionChecklist
          batch={preCheckBatch}
          onConfirm={handleChecklistConfirm}
          onCancel={() => setPreCheckBatch(null)}
        />
      )}

      {processingBatch && (
        <BatchProcessForm
          batch={processingBatch}
          mode={processingMode}
          onClose={() => setProcessingBatch(null)}
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