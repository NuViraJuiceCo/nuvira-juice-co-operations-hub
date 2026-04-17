import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Calendar, Trash2, Edit2 } from "lucide-react";
import { SelectContent, SelectItem } from "@/components/ui/select";
import StatusBadge from "../components/shared/StatusBadge";
import PullToRefresh from "../components/shared/PullToRefresh";
import SelectMobile from "../components/SelectMobile";
import BatchEditForm from "../components/production/BatchEditForm";
import moment from "moment";
import _ from "lodash";

export default function Production() {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(null);
  const [editingBatch, setEditingBatch] = useState(null);

  useEffect(() => {
    async function load() {
      const data = await base44.entities.ProductionBatch.list("production_date", 100);
      setBatches(data);
      setLoading(false);
    }
    load();
  }, []);

  const handleRefresh = async () => {
    const data = await base44.entities.ProductionBatch.list("production_date", 100);
    setBatches(data);
  };

  const handleSaveEdit = async () => {
    setEditingBatch(null);
    const data = await base44.entities.ProductionBatch.list("production_date", 100);
    setBatches(data);
  };

  const handleDelete = async (id) => {
    setDeleting(id);
    try {
      await base44.entities.ProductionBatch.delete(id);
      setBatches(batches.filter(b => b.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selected.size} batch(es)?`)) return;
    setDeleting(true);
    try {
      await Promise.all(Array.from(selected).map(id => base44.entities.ProductionBatch.delete(id)));
      setBatches(batches.filter(b => !selected.has(b.id)));
      setSelected(new Set());
    } finally {
      setDeleting(false);
    }
  };

  const toggleSelect = (id) => {
    const newSelected = new Set(selected);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelected(newSelected);
  };

  const filtered = batches.filter(
    (b) => statusFilter === "all" || b.status === statusFilter
  );

  const grouped = _.groupBy(filtered, (b) => b.production_date);
  const activeBatches = batches.filter((b) => b.status !== "Completed").length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const today = moment().format("YYYY-MM-DD");

  return (
    <>
    <PullToRefresh onRefresh={handleRefresh}>
      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Production Planning</h1>
          <p className="text-muted-foreground mt-1">
            {batches.length} batches · {activeBatches} active
          </p>
        </div>
        <SelectMobile value={statusFilter} onValueChange={setStatusFilter} placeholder="All Statuses" triggerClassName="w-44">
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="Planned">Planned</SelectItem>
            <SelectItem value="Awaiting Ingredients">Awaiting Ingredients</SelectItem>
            <SelectItem value="In Production">In Production</SelectItem>
            <SelectItem value="In Packing">In Packing</SelectItem>
            <SelectItem value="Completed">Completed</SelectItem>
          </SelectContent>
        </SelectMobile>
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <span className="text-sm font-medium text-blue-900">{selected.size} selected</span>
            <button onClick={handleBulkDelete} disabled={deleting} className="text-sm px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
              {deleting ? "Deleting..." : "Delete Selected"}
            </button>
            <button onClick={() => setSelected(new Set())} className="text-sm px-3 py-1.5 rounded border border-blue-200 text-blue-700 hover:bg-blue-100">
              Cancel
            </button>
          </div>
        )}

        {/* Grouped by Date */}
      <div className="space-y-8">
        {Object.entries(grouped)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, dateBatches]) => {
            const isToday = date === today;
            const dateLabel = isToday
              ? `Today — ${moment(date).format("dddd, MMM D")}`
              : moment(date).format("dddd, MMM D, YYYY");

            return (
              <div key={date}>
                <div className="flex items-center gap-2 mb-4">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground">{dateLabel}</h3>
                  <span className="text-xs text-muted-foreground">
                    ({dateBatches.length} batches)
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {dateBatches.map((batch) => (
                    <div
                      key={batch.id}
                      className="bg-card border border-border rounded-xl p-5 hover:shadow-sm transition-shadow relative"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(batch.id)}
                        onChange={() => toggleSelect(batch.id)}
                        className="absolute top-3 left-3"
                      />
                      <button
                        onClick={() => handleDelete(batch.id)}
                        disabled={deleting === batch.id}
                        className="absolute top-3 right-3 text-red-600 hover:text-red-700 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      <div className="flex items-start justify-between pl-6">
                        <div>
                          <h4 className="font-semibold text-foreground">{batch.product_name}</h4>
                          <p className="text-xs text-muted-foreground mt-0.5">{batch.batch_id}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setEditingBatch(batch)}
                            className="text-primary hover:text-primary/80"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <StatusBadge status={batch.status} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 mt-4">
                        <div>
                          <p className="text-xs text-muted-foreground">Planned</p>
                          <p className="text-lg font-semibold text-foreground">{batch.planned_units} units</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Actual</p>
                          <p className="text-lg font-semibold text-foreground">
                            {batch.actual_units || "—"}
                          </p>
                        </div>
                      </div>
                      {(batch.assigned_to || batch.notes) && (
                        <div className="mt-3 pt-3 border-t border-border space-y-1">
                          {batch.assigned_to && (
                            <p className="text-xs text-muted-foreground">
                              Assigned: {batch.assigned_to}
                            </p>
                          )}
                          {batch.notes && (
                            <p className="text-xs text-muted-foreground">{batch.notes}</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
            })}
      </div>
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