import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { ChevronLeft, ChevronRight, Plus, List, Calendar, LayoutGrid, Factory, Truck, Star, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import CalendarGrid from "../components/calendar/CalendarGrid";
import EventCreateForm from "../components/calendar/EventCreateForm";
import moment from "moment";

// ── Type config ──────────────────────────────────────────────────────────────
const TYPE_CONFIG = {
  production: {
    label: "Production",
    icon: Factory,
    pill: "bg-status-info-bg text-status-info border border-status-info-border",
    dot: "bg-status-info",
    accent: "border-l-status-info",
  },
  delivery: {
    label: "Delivery",
    icon: Truck,
    pill: "bg-status-success-bg text-status-success border border-status-success-border",
    dot: "bg-status-success",
    accent: "border-l-status-success",
  },
  event: {
    label: "Event",
    icon: Star,
    pill: "bg-status-admin-bg text-status-admin border border-status-admin-border",
    dot: "bg-status-admin",
    accent: "border-l-status-admin",
  },
  compliance: {
    label: "Compliance",
    icon: ShieldCheck,
    pill: "bg-status-warning-bg text-status-warning border border-status-warning-border",
    dot: "bg-status-warning",
    accent: "border-l-status-warning",
  },
  followup: {
    label: "Follow-Up",
    icon: ShieldCheck,
    pill: "bg-status-danger-bg text-status-danger border border-status-danger-border",
    dot: "bg-status-danger",
    accent: "border-l-status-danger",
  },
};

const FILTERS = ["All", "Production", "Delivery", "Event", "Compliance"];

// ── Agenda Card ──────────────────────────────────────────────────────────────
function AgendaCard({ event }) {
  const cfg = TYPE_CONFIG[event.type] || TYPE_CONFIG.event;
  const Icon = cfg.icon;
  return (
    <div className={`bg-card border border-border border-l-4 ${cfg.accent} rounded-xl px-4 py-3.5 flex items-start gap-3`}>
      <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${cfg.pill}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-sm text-foreground leading-tight">{event.label}</p>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${cfg.pill}`}>
            {cfg.label}
          </span>
        </div>
        {event.location && (
          <p className="text-xs text-muted-foreground mt-0.5">📍 {event.location}</p>
        )}
        {event.status && (
          <p className="text-xs text-muted-foreground mt-0.5">Status: {event.status}</p>
        )}
      </div>
    </div>
  );
}

// ── Agenda Day Group ─────────────────────────────────────────────────────────
function AgendaDayGroup({ dateStr, events }) {
  const m = moment(dateStr);
  const isToday = dateStr === moment().format("YYYY-MM-DD");
  return (
    <div>
      <div className={`flex items-center gap-3 mb-2 sticky top-0 z-10 py-1 bg-background`}>
        <div className={`h-10 w-10 rounded-xl flex flex-col items-center justify-center shrink-0 ${isToday ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
          <span className="text-[10px] font-bold uppercase leading-none">{m.format("ddd")}</span>
          <span className="text-base font-bold leading-none">{m.format("D")}</span>
        </div>
        <div>
          <p className={`text-sm font-bold ${isToday ? "text-primary" : "text-foreground"}`}>
            {isToday ? "Today" : m.format("dddd")}
          </p>
          <p className="text-xs text-muted-foreground">{m.format("MMMM D, YYYY")}</p>
        </div>
      </div>
      <div className="space-y-2 ml-2 pl-11 border-l-2 border-border mb-5">
        {events.map((e, i) => <AgendaCard key={i} event={e} />)}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function OperationsCalendar() {
  const [currentMonth, setCurrentMonth] = useState(moment());
  const [orders, setOrders] = useState([]);
  const [batches, setBatches] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [view, setView] = useState("agenda"); // "agenda" | "month"
  const [activeFilter, setActiveFilter] = useState("All");

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

  // Build all calendar events
  const allCalendarEvents = [];

  batches.forEach((b) => {
    if (b.production_date) allCalendarEvents.push({ date: b.production_date, label: b.product_name, type: "production", status: b.status });
  });

  tasks.forEach((t) => {
    if (!t.scheduled_date) return;
    const type = t.fulfillment_type === "Delivery" || t.fulfillment_type === "Pickup" ? "delivery" : "event";
    allCalendarEvents.push({ date: t.scheduled_date, label: t.customer_name, type, status: t.status });
  });

  events.forEach((e) => {
    if (e.date) allCalendarEvents.push({ date: e.date, label: e.name, type: "event", location: e.location, status: e.status });
  });

  // Filter by type
  const filteredEvents = activeFilter === "All"
    ? allCalendarEvents
    : allCalendarEvents.filter(e => e.type === activeFilter.toLowerCase());

  // Filter to current month
  const monthStr = currentMonth.format("YYYY-MM");
  const monthEvents = filteredEvents.filter(e => e.date && e.date.startsWith(monthStr));

  // Group by date for agenda view
  const grouped = {};
  monthEvents.forEach(e => {
    if (!grouped[e.date]) grouped[e.date] = [];
    grouped[e.date].push(e);
  });
  const sortedDates = Object.keys(grouped).sort();

  const handleRefresh = async () => {
    const [o, b, t, e] = await Promise.all([
      base44.entities.Order.list("-created_date", 100),
      base44.entities.ProductionBatch.list("production_date", 100),
      base44.entities.FulfillmentTask.list("scheduled_date", 100),
      base44.entities.Event.list("date", 100),
    ]);
    setOrders(o); setBatches(b); setTasks(t); setEvents(e);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground">Operations Calendar</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {monthEvents.length} items in {currentMonth.format("MMMM YYYY")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button className="gap-2" onClick={() => setCreatingEvent(true)}>
            <Plus className="h-4 w-4" /> Add Event
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentMonth(moment())}>Today</Button>
          <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(moment(currentMonth).subtract(1, "month"))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold min-w-[110px] text-center text-foreground">
            {currentMonth.format("MMMM YYYY")}
          </span>
          <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(moment(currentMonth).add(1, "month"))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* View toggle + Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        {/* Type Filters */}
        <div className="flex gap-2 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all min-h-touch ${
                activeFilter === f
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-card border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          <button
            onClick={() => setView("agenda")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${view === "agenda" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            <List className="h-3.5 w-3.5" /> Agenda
          </button>
          <button
            onClick={() => setView("month")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${view === "month" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Month
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4">
        {Object.entries(TYPE_CONFIG).filter(([k]) => k !== 'followup').map(([key, cfg]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className={`h-2.5 w-2.5 rounded-full ${cfg.dot}`} />
            <span className="text-xs text-muted-foreground">{cfg.label}</span>
          </div>
        ))}
      </div>

      {/* Content */}
      {view === "month" ? (
        <CalendarGrid currentMonth={currentMonth} events={filteredEvents} />
      ) : (
        <div className="space-y-1">
          {sortedDates.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Calendar className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No items in {currentMonth.format("MMMM YYYY")}</p>
              <p className="text-sm mt-1">Try changing the filter or month.</p>
            </div>
          ) : (
            sortedDates.map(date => (
              <AgendaDayGroup key={date} dateStr={date} events={grouped[date]} />
            ))
          )}
        </div>
      )}

      {creatingEvent && (
        <EventCreateForm
          onClose={() => setCreatingEvent(false)}
          onSave={async () => { await handleRefresh(); setCreatingEvent(false); }}
        />
      )}
    </div>
  );
}