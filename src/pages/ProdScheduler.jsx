import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { AlertTriangle, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import StatusBadge from "../components/shared/StatusBadge";
import moment from "moment";

const RECIPES = {
  "Green Glow Juice": { ingredients: [{ name: "Kale", qty: 3, unit: "kg" }, { name: "Cucumber", qty: 2, unit: "kg" }, { name: "Celery", qty: 1, unit: "kg" }, { name: "Ginger", qty: 0.3, unit: "kg" }], equipment: ["Juicer", "Bottler"], labor: 4 },
  "Berry Blast Juice": { ingredients: [{ name: "Blueberries", qty: 4, unit: "kg" }, { name: "Apple Juice Base", qty: 5, unit: "L" }], equipment: ["Juicer", "Bottler"], labor: 3 },
  "Tropical Cleanse": { ingredients: [{ name: "Pineapple", qty: 4, unit: "kg" }, { name: "Mango", qty: 3, unit: "kg" }, { name: "Ginger", qty: 0.5, unit: "kg" }], equipment: ["Juicer", "Bottler"], labor: 3.5 },
  "Citrus Sunrise": { ingredients: [{ name: "Lemon", qty: 5, unit: "kg" }, { name: "Apple Juice Base", qty: 8, unit: "L" }, { name: "Turmeric", qty: 50, unit: "g" }], equipment: ["Juicer", "Bottler"], labor: 3 },
};

export default function ProdScheduler() {
  const [batches, setBatches] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [weekStart, setWeekStart] = useState(moment().startOf("isoWeek"));
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    Promise.all([
      base44.entities.ProductionBatch.list("production_date", 100),
      base44.entities.InventoryItem.list("-updated_date", 100),
    ]).then(([b, inv]) => {
      setBatches(b);
      setInventory(inv);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  const weekDays = Array.from({ length: 7 }, (_, i) => weekStart.clone().add(i, "days"));
  const today = moment().format("YYYY-MM-DD");

  const checkInventory = (batch) => {
    const recipe = RECIPES[batch.product_name];
    if (!recipe) return [];
    return recipe.ingredients.filter(req => {
      const inv = inventory.find(i => i.ingredient === req.name);
      if (!inv) return true;
      return inv.stock < req.qty;
    });
  };

  const allAlerts = batches.flatMap(b => {
    const missing = checkInventory(b);
    return missing.length > 0 ? [{ batch: b, missing }] : [];
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Production Scheduler</h1>
          <p className="text-muted-foreground mt-1">Weekly view · {weekStart.format("MMMM D")} – {weekStart.clone().add(6, "days").format("D, YYYY")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setWeekStart(weekStart.clone().subtract(1, "week"))}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setWeekStart(moment().startOf("isoWeek"))}>Today</Button>
          <Button variant="outline" size="icon" onClick={() => setWeekStart(weekStart.clone().add(1, "week"))}><ChevronRight className="h-4 w-4" /></Button>
          <Button className="gap-2"><Plus className="h-4 w-4" /> Add Batch</Button>
        </div>
      </div>

      {allAlerts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-1">
          <p className="text-sm font-semibold text-red-800 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Ingredient Alerts ({allAlerts.length} batches)</p>
          {allAlerts.map(({ batch, missing }) => (
            <p key={batch.id} className="text-xs text-red-700">
              <span className="font-medium">{batch.product_name}</span> ({batch.production_date}) — Missing: {missing.map(m => `${m.name}`).join(", ")}
            </p>
          ))}
        </div>
      )}

      {/* Week Grid */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border">
          {weekDays.map(day => (
            <div key={day.format()} className={`px-2 py-3 text-center border-r border-border last:border-0 ${day.format("YYYY-MM-DD") === today ? "bg-primary/5" : "bg-muted/20"}`}>
              <p className="text-xs font-medium text-muted-foreground uppercase">{day.format("ddd")}</p>
              <p className={`text-sm font-bold mt-0.5 ${day.format("YYYY-MM-DD") === today ? "text-primary" : "text-foreground"}`}>{day.format("D")}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 min-h-[240px]">
          {weekDays.map(day => {
            const dateStr = day.format("YYYY-MM-DD");
            const dayBatches = batches.filter(b => b.production_date === dateStr);
            return (
              <div key={dateStr} className="border-r border-border last:border-0 p-1.5 space-y-1.5 min-h-[180px]">
                {dayBatches.map(batch => {
                  const hasAlert = checkInventory(batch).length > 0;
                  return (
                    <button key={batch.id} onClick={() => setSelected(selected?.id === batch.id ? null : batch)}
                      className={`w-full text-left rounded-lg p-2 text-xs border transition-all ${hasAlert ? "bg-red-50 border-red-200 hover:bg-red-100" : "bg-amber-50 border-amber-200 hover:bg-amber-100"}`}>
                      <p className={`font-semibold truncate ${hasAlert ? "text-red-800" : "text-amber-900"}`}>{batch.product_name}</p>
                      <p className={hasAlert ? "text-red-600" : "text-amber-700"}>{batch.planned_units} units {hasAlert && "⚠️"}</p>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail Panel */}
      {selected && (
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="font-semibold text-foreground">{selected.product_name}</h3>
              <p className="text-sm text-muted-foreground">{selected.batch_id} · {moment(selected.production_date).format("MMMM D, YYYY")}</p>
            </div>
            <StatusBadge status={selected.status} />
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-muted-foreground">Planned Units</p><p className="font-medium">{selected.planned_units}</p></div>
            <div><p className="text-muted-foreground">Assigned To</p><p className="font-medium">{selected.assigned_to || "—"}</p></div>
          </div>
          {RECIPES[selected.product_name] && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Ingredient Check</p>
              <div className="space-y-1.5">
                {RECIPES[selected.product_name].ingredients.map(req => {
                  const inv = inventory.find(i => i.ingredient === req.name);
                  const ok = inv && inv.stock >= req.qty;
                  return (
                    <div key={req.name} className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs ${ok ? "bg-emerald-50" : "bg-red-50"}`}>
                      <span className={ok ? "text-emerald-800" : "text-red-800"}>{ok ? "✅" : "❌"} {req.name}</span>
                      <span className={ok ? "text-emerald-600" : "text-red-600"}>Need {req.qty} {req.unit} · Have {inv ? `${inv.stock} ${inv.unit}` : "none"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* All batches list */}
      <div>
        <h2 className="font-semibold text-foreground mb-3">All Scheduled Batches</h2>
        <div className="space-y-2">
          {batches.map(batch => {
            const alerts = checkInventory(batch);
            return (
              <div key={batch.id} className="bg-card border border-border rounded-xl px-5 py-3.5 flex items-center gap-4">
                <div className="flex-1">
                  <p className="font-medium text-sm text-foreground">{batch.product_name}</p>
                  <p className="text-xs text-muted-foreground">{batch.batch_id} · {moment(batch.production_date).format("MMM D, YYYY")}</p>
                </div>
                <p className="text-sm text-muted-foreground">{batch.planned_units} units</p>
                {alerts.length > 0 && <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />}
                <StatusBadge status={batch.status} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}