import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import AdminGuide from "../components/shared/AdminGuide";
import { Clock, MapPin, User, Trash2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import StatusBadge from "../components/shared/StatusBadge";
import moment from "moment";

export default function Fulfillment() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await base44.entities.FulfillmentTask.list("-scheduled_date", 100);
        setTasks(data || []);
      } catch (error) {
        console.error('Failed to load fulfillment tasks:', error);
        setTasks([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleDelete = async (id) => {
    setDeleting(id);
    try {
      await base44.entities.FulfillmentTask.delete(id);
      setTasks(tasks.filter(t => t.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selected.size} task(s)?`)) return;
    setDeleting(true);
    try {
      await Promise.all(Array.from(selected).map(id => base44.entities.FulfillmentTask.delete(id)));
      setTasks(tasks.filter(t => !selected.has(t.id)));
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

  const filtered = tasks.filter(
    (t) => statusFilter === "all" || t.status === statusFilter
  );

  const today = moment().format("YYYY-MM-DD");
  const todayTasks = tasks.filter((t) => t.scheduled_date === today).length;
  const unassigned = tasks.filter((t) => t.status === "Unassigned").length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminGuide
        title="Admin Guide — Fulfillment Queue"
        steps={[
          "Fulfillment tasks represent individual delivery or pickup jobs that need to be completed.",
          "Tasks are created from confirmed orders and assigned to drivers or pickup slots.",
          "Update task status through: Unassigned → Scheduled → Packed → In Transit → Completed.",
          "Assign a driver to each task so the Driver Portal shows the correct delivery queue.",
        ]}
        tips={[
          "Use the status filter to focus on Unassigned tasks that still need a driver.",
          "The Driver Portal is what drivers use on their phones — tasks need to be assigned and active there.",
          "Today's task count in the subtitle helps you quickly see today's workload.",
        ]}
      />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Fulfillment Queue</h1>
          <p className="text-muted-foreground mt-1">
            {todayTasks} tasks today · {unassigned} unassigned
          </p>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="Unassigned">Unassigned</SelectItem>
            <SelectItem value="Scheduled">Scheduled</SelectItem>
            <SelectItem value="Packed">Packed</SelectItem>
            <SelectItem value="In Transit">In Transit</SelectItem>
            <SelectItem value="Completed">Completed</SelectItem>
          </SelectContent>
        </Select>
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

      {/* Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((task) => (
          <div
            key={task.id}
            className="bg-card border border-border rounded-xl p-5 hover:shadow-sm transition-shadow relative"
          >
            <input
              type="checkbox"
              checked={selected.has(task.id)}
              onChange={() => toggleSelect(task.id)}
              className="absolute top-3 left-3"
            />
            <button
              onClick={() => handleDelete(task.id)}
              disabled={deleting === task.id}
              className="absolute top-3 right-3 text-red-600 hover:text-red-700 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <div className="flex items-start justify-between mb-3 pl-6">
              <div>
                <h4 className="font-semibold text-foreground">{task.customer_name}</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {task.fulfillment_type} · {task.time_window || "No window"}
                </p>
              </div>
              <StatusBadge status={task.status} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                <span>{moment(task.scheduled_date).format("MMM D, YYYY")}</span>
              </div>
              {task.address && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                  <span>{task.address}</span>
                </div>
              )}
              {task.assigned_driver && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <User className="h-3.5 w-3.5 flex-shrink-0" />
                  <span>{task.assigned_driver}</span>
                </div>
              )}
            </div>

            {task.items_summary && (
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground bg-muted rounded-md px-3 py-2">
                  {task.items_summary}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}