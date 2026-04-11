import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import StatusBadge from "../components/shared/StatusBadge";
import moment from "moment";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function ProdScheduler() {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.entities.ProductionBatch.list("production_date", 50).then(data => {
      setBatches(data);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;
  }

  // Build week grid — current week
  const startOfWeek = moment().startOf("isoWeek");
  const weekDays = DAYS.map((_, i) => startOfWeek.clone().add(i, "days"));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Production Scheduler</h1>
          <p className="text-muted-foreground mt-1">Week of {startOfWeek.format("MMMM D, YYYY")}</p>
        </div>
        <Button className="gap-2"><Plus className="h-4 w-4" /> Schedule Batch</Button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="grid grid-cols-6 border-b border-border">
          {weekDays.map((day) => (
            <div key={day.format()} className={`px-4 py-3 border-r border-border last:border-0 ${day.format("YYYY-MM-DD") === moment().format("YYYY-MM-DD") ? "bg-primary/5" : "bg-muted/20"}`}>
              <p className="text-xs font-medium text-muted-foreground uppercase">{day.format("ddd")}</p>
              <p className={`text-sm font-semibold mt-0.5 ${day.format("YYYY-MM-DD") === moment().format("YYYY-MM-DD") ? "text-primary" : "text-foreground"}`}>
                {day.format("MMM D")}
              </p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-6 min-h-[300px]">
          {weekDays.map((day) => {
            const dateStr = day.format("YYYY-MM-DD");
            const dayBatches = batches.filter(b => b.production_date === dateStr);
            return (
              <div key={dateStr} className="border-r border-border last:border-0 p-2 space-y-2 min-h-[200px]">
                {dayBatches.map(batch => (
                  <div key={batch.id} className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs">
                    <p className="font-semibold text-amber-900 truncate">{batch.product_name}</p>
                    <p className="text-amber-700 mt-0.5">{batch.planned_units} units</p>
                    <div className="mt-1">
                      <StatusBadge status={batch.status} />
                    </div>
                  </div>
                ))}
                {dayBatches.length === 0 && (
                  <div className="h-full flex items-center justify-center">
                    <p className="text-xs text-muted-foreground/50">No batches</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* All batches list */}
      <div>
        <h2 className="font-semibold text-foreground mb-3">All Scheduled Batches</h2>
        <div className="space-y-2">
          {batches.map(batch => (
            <div key={batch.id} className="bg-card border border-border rounded-xl px-5 py-3.5 flex items-center gap-4">
              <div className="flex-1">
                <p className="font-medium text-sm text-foreground">{batch.product_name}</p>
                <p className="text-xs text-muted-foreground">{batch.batch_id} · {moment(batch.production_date).format("MMM D, YYYY")}</p>
              </div>
              <p className="text-sm text-muted-foreground">{batch.planned_units} units</p>
              {batch.assigned_to && <p className="text-xs text-muted-foreground">{batch.assigned_to}</p>}
              <StatusBadge status={batch.status} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}