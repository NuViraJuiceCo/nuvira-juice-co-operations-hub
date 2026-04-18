import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { MapPin, Clock, Route, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import moment from "moment";

export default function RouteOptimizer() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [optimizing, setOptimizing] = useState(false);

  useEffect(() => {
    base44.entities.FulfillmentTask.list("scheduled_date", 50).then(data => {
      setTasks(data);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;
  }

  const deliveries = tasks.filter(t => ["Delivery", "Pickup"].includes(t.fulfillment_type) && ["Unassigned", "Scheduled", "Packed", "In Transit"].includes(t.status));
  const today = moment().format("YYYY-MM-DD");
  const todayDeliveries = deliveries.filter(t => t.scheduled_date === today);
  const upcomingDeliveries = deliveries.filter(t => t.scheduled_date > today);

  const totalAddresses = deliveries.filter(t => t.address).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Route Optimizer</h1>
          <p className="text-muted-foreground mt-1">{deliveries.length} pending stops · {totalAddresses} with addresses</p>
        </div>
        <Button onClick={() => setOptimizing(true)} className="gap-2"><Route className="h-4 w-4" /> Optimize Route</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Today's Stops", value: todayDeliveries.length, icon: Truck },
          { label: "Upcoming", value: upcomingDeliveries.length, icon: Clock },
          { label: "Total Pending", value: deliveries.length, icon: MapPin },
        ].map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <p className="text-2xl font-semibold text-foreground mt-1">{s.value}</p>
            </div>
            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-primary">
              <s.icon className="h-5 w-5" />
            </div>
          </div>
        ))}
      </div>

      {/* Today's Route */}
      {todayDeliveries.length > 0 && (
        <div>
          <h2 className="font-semibold text-foreground mb-3">Today's Route</h2>
          <div className="space-y-2">
            {todayDeliveries.map((task, i) => (
              <div key={task.id} className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
                <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold flex-shrink-0">{i + 1}</div>
                <div className="flex-1">
                  <p className="font-medium text-sm text-foreground">{task.customer_name}</p>
                  {task.address && <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><MapPin className="h-3 w-3" />{task.address}</p>}
                  {task.time_window && <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><Clock className="h-3 w-3" />{task.time_window}</p>}
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">{task.fulfillment_type}</p>
                  {task.items_summary && <p className="text-xs text-muted-foreground mt-0.5">{task.items_summary}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming */}
      <div>
        <h2 className="font-semibold text-foreground mb-3">Upcoming Deliveries</h2>
        <div className="space-y-2">
          {upcomingDeliveries.map((task) => (
            <div key={task.id} className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
              <div className="text-center bg-muted rounded-xl p-2 min-w-[52px]">
                <p className="text-xs text-muted-foreground">{moment(task.scheduled_date).format("MMM")}</p>
                <p className="text-lg font-bold text-foreground leading-tight">{moment(task.scheduled_date).format("D")}</p>
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm text-foreground">{task.customer_name}</p>
                {task.address && <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><MapPin className="h-3 w-3" />{task.address}</p>}
              </div>
              <p className="text-xs text-muted-foreground">{task.fulfillment_type}{task.time_window ? ` · ${task.time_window}` : ""}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}