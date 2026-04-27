import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import CalendarGrid from "../components/calendar/CalendarGrid";
import EventCreateForm from "../components/calendar/EventCreateForm";
import moment from "moment";

export default function OperationsCalendar() {
  const [currentMonth, setCurrentMonth] = useState(moment());
  const [orders, setOrders] = useState([]);
  const [batches, setBatches] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creatingEvent, setCreatingEvent] = useState(false);

  useEffect(() => {
    async function load() {
      const [o, b, t, e] = await Promise.all([
        base44.entities.Order.list("-created_date", 100),
        base44.entities.ProductionBatch.list("production_date", 100),
        base44.entities.FulfillmentTask.list("scheduled_date", 100),
        base44.entities.Event.list("date", 100),
      ]);
      setOrders(o);
      setBatches(b);
      setTasks(t);
      setEvents(e);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  // Build calendar events
  const calendarEvents = [];

  batches.forEach((b) => {
    calendarEvents.push({
      date: b.production_date,
      label: b.product_name,
      type: "production",
    });
  });

  tasks.forEach((t) => {
    if (t.fulfillment_type === "Delivery" || t.fulfillment_type === "Pickup") {
      calendarEvents.push({
        date: t.scheduled_date,
        label: t.customer_name,
        type: "delivery",
      });
    } else if (t.fulfillment_type === "Event") {
      calendarEvents.push({
        date: t.scheduled_date,
        label: t.customer_name,
        type: "event",
      });
    }
  });

  events.forEach((e) => {
    calendarEvents.push({
      date: e.date,
      label: e.name,
      type: "event",
    });
  });

  const handleRefresh = async () => {
    const [o, b, t, e] = await Promise.all([
      base44.entities.Order.list("-created_date", 100),
      base44.entities.ProductionBatch.list("production_date", 100),
      base44.entities.FulfillmentTask.list("scheduled_date", 100),
      base44.entities.Event.list("date", 100),
    ]);
    setOrders(o);
    setBatches(b);
    setTasks(t);
    setEvents(e);
  };

  const handleEventCreated = async () => {
    await handleRefresh();
    setCreatingEvent(false);
  };

  const totalEvents = calendarEvents.filter((e) => {
    if (!e.date) return false;
    const [y, m] = e.date.split("-").map(Number);
    return m === currentMonth.month() + 1 && y === currentMonth.year();
  }).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
         <div>
           <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Operations Calendar</h1>
           <p className="text-muted-foreground mt-1">
             {totalEvents} items in {currentMonth.format("MMMM YYYY")} · drag items to reschedule
           </p>
         </div>
         <div className="flex items-center gap-2">
           <Button className="gap-2" onClick={() => setCreatingEvent(true)}><Plus className="h-4 w-4" /> Add Event</Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentMonth(moment())}>
            Today
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(moment(currentMonth).subtract(1, "month"))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[120px] text-center">
            {currentMonth.format("MMMM YYYY")}
          </span>
          <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(moment(currentMonth).add(1, "month"))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6">
        {[
          { color: "bg-amber-400", label: "Production" },
          { color: "bg-cyan-400", label: "Delivery" },
          { color: "bg-purple-400", label: "Event" },
          { color: "bg-rose-400", label: "Follow-up" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <div className={`h-2.5 w-2.5 rounded-full ${item.color}`} />
            <span className="text-xs text-muted-foreground">{item.label}</span>
          </div>
        ))}
      </div>

      <CalendarGrid currentMonth={currentMonth} events={calendarEvents} />

      {creatingEvent && (
        <EventCreateForm
          onClose={() => setCreatingEvent(false)}
          onSave={handleEventCreated}
        />
      )}
    </div>
  );
}