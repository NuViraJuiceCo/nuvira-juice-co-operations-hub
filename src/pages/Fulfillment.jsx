import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Clock, MapPin, User } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import StatusBadge from "../components/shared/StatusBadge";
import moment from "moment";

export default function Fulfillment() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    async function load() {
      const data = await base44.entities.FulfillmentTask.list("-scheduled_date", 100);
      setTasks(data);
      setLoading(false);
    }
    load();
  }, []);

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

      {/* Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((task) => (
          <div
            key={task.id}
            className="bg-card border border-border rounded-xl p-5 hover:shadow-sm transition-shadow"
          >
            <div className="flex items-start justify-between mb-3">
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