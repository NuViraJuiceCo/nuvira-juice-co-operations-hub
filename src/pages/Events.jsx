import { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import AdminGuide from "../components/shared/AdminGuide";
import { CalendarDays, MapPin, Users, Plus, Trash2, Edit2, Search, DollarSign, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import moment from "moment";
import EventEditForm from "../components/events/EventEditForm";

// ── Color maps ────────────────────────────────────────────────────────────────
const TYPE_PILL = {
  "Pop-Up":           "bg-status-info-bg text-status-info border border-status-info-border",
  "Market":           "bg-status-success-bg text-status-success border border-status-success-border",
  "Corporate":        "bg-status-info-bg text-status-info border border-status-info-border",
  "Tasting":          "bg-status-admin-bg text-status-admin border border-status-admin-border",
  "Festival":         "bg-status-warning-bg text-status-warning border border-status-warning-border",
  "Wholesale Meeting":"bg-status-warning-bg text-status-warning border border-status-warning-border",
  "Other":            "bg-muted text-muted-foreground border border-border",
};
const STATUS_PILL = {
  "Confirmed": "bg-status-success-bg text-status-success border border-status-success-border",
  "Pending":   "bg-status-warning-bg text-status-warning border border-status-warning-border",
  "Applied":   "bg-status-info-bg text-status-info border border-status-info-border",
  "Cancelled": "bg-status-danger-bg text-status-danger border border-status-danger-border",
  "Completed": "bg-muted text-muted-foreground border border-border",
};
const STATUS_ACCENT = {
  "Confirmed": "border-l-status-success",
  "Pending":   "border-l-status-warning",
  "Applied":   "border-l-status-info",
  "Cancelled": "border-l-status-danger",
  "Completed": "border-l-border",
};

const STATUS_FILTERS = ["All", "Upcoming", "Confirmed", "Pending", "Applied", "Completed", "Cancelled"];

// ── Event Card ────────────────────────────────────────────────────────────────
function EventCard({ event, onEdit, onDelete, deleting }) {
  const [expanded, setExpanded] = useState(false);
  const accent = STATUS_ACCENT[event.status] || "border-l-border";
  const isPast = event.date && moment(event.date).isBefore(moment(), "day");

  return (
    <div className={`bg-card border border-border border-l-4 ${accent} rounded-xl overflow-hidden transition-shadow hover:shadow-md ${isPast ? "opacity-80" : ""}`}>
      {/* Main row */}
      <div className="flex items-start gap-3 p-4">
        {/* Date block */}
        <div className={`shrink-0 flex flex-col items-center justify-center rounded-xl px-3 py-2 min-w-[52px] ${event.status === "Confirmed" ? "bg-status-success-bg" : event.status === "Cancelled" ? "bg-status-danger-bg" : "bg-muted"}`}>
          <span className={`text-[10px] font-bold uppercase tracking-wider leading-none ${event.status === "Confirmed" ? "text-status-success" : event.status === "Cancelled" ? "text-status-danger" : "text-muted-foreground"}`}>
            {moment(event.date).format("MMM")}
          </span>
          <span className={`text-2xl font-bold leading-tight ${event.status === "Confirmed" ? "text-status-success" : event.status === "Cancelled" ? "text-status-danger" : "text-foreground"}`}>
            {moment(event.date).format("D")}
          </span>
          {event.end_date && event.end_date !== event.date && (
            <span className="text-[9px] text-muted-foreground leading-none">→ {moment(event.end_date).format("D")}</span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-start gap-1.5 mb-1">
            <h3 className="font-bold text-foreground text-sm leading-tight">{event.name}</h3>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TYPE_PILL[event.type] || "bg-muted text-muted-foreground border border-border"}`}>{event.type}</span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_PILL[event.status] || "bg-muted text-muted-foreground border border-border"}`}>{event.status}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {event.location && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3 shrink-0" />
                <span>{event.location}</span>
              </div>
            )}
            {event.expected_attendees && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="h-3 w-3 shrink-0" />
                <span>{event.expected_attendees} expected</span>
              </div>
            )}
            {event.revenue > 0 && (
              <div className="flex items-center gap-1 text-xs text-status-success font-medium">
                <DollarSign className="h-3 w-3 shrink-0" />
                <span>${Number(event.revenue).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1 shrink-0">
          <button
            onClick={() => onEdit(event)}
            className="h-9 w-9 min-h-touch min-w-touch flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground hover:text-primary transition-colors"
            aria-label="Edit event"
          >
            <Edit2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => onDelete(event.id)}
            disabled={deleting === event.id}
            className="h-9 w-9 min-h-touch min-w-touch flex items-center justify-center rounded-lg hover:bg-status-danger-bg text-muted-foreground hover:text-status-danger transition-colors disabled:opacity-40"
            aria-label="Delete event"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Expandable notes/products */}
      {(event.notes || event.products || event.contact_name) && (
        <>
          <button
            onClick={() => setExpanded(e => !e)}
            className="w-full flex items-center justify-between px-4 py-2 border-t border-border text-xs text-muted-foreground hover:bg-muted/30 transition-colors"
          >
            <span>{expanded ? "Hide details" : "Show details"}</span>
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {expanded && (
            <div className="px-4 pb-4 space-y-2 border-t border-border bg-muted/10">
              {event.contact_name && (
                <div className="pt-3">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Contact</p>
                  <p className="text-sm text-foreground">{event.contact_name}</p>
                  {event.contact_email && <p className="text-xs text-muted-foreground">{event.contact_email}</p>}
                </div>
              )}
              {event.products && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Products</p>
                  <p className="text-sm text-foreground">{event.products}</p>
                </div>
              )}
              {event.notes && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Notes</p>
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{event.notes}</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function Events() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  useEffect(() => {
    base44.entities.Event.list("date", 50).then(data => {
      setEvents(data);
      setLoading(false);
    });
  }, []);

  const handleSaveEdit = async () => {
    const data = await base44.entities.Event.list("date", 50);
    setEvents(data);
    setEditingEvent(null);
    setIsCreating(false);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this event?")) return;
    setDeleting(id);
    try {
      await base44.entities.Event.delete(id);
      setEvents(prev => prev.filter(e => e.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  const filtered = useMemo(() => {
    const today = moment().format("YYYY-MM-DD");
    return events.filter(e => {
      if (search) {
        const q = search.toLowerCase();
        if (!((e.name || "").toLowerCase().includes(q) ||
              (e.location || "").toLowerCase().includes(q) ||
              (e.contact_name || "").toLowerCase().includes(q))) return false;
      }
      if (statusFilter === "Upcoming") return e.date >= today && e.status !== "Cancelled" && e.status !== "Completed";
      if (statusFilter !== "All") return e.status === statusFilter;
      return true;
    });
  }, [events, search, statusFilter]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-5">
      <AdminGuide
        title="Admin Guide — Events"
        steps={[
          "Click 'Add Event' to log an upcoming pop-up, market, corporate event, tasting, or wholesale meeting.",
          "Set the event type, status (Confirmed/Pending/Applied), date, and location.",
          "Use the Products field to note which items and quantities you plan to bring.",
          "Update the status to Completed after the event and log actual revenue in the Revenue field.",
        ]}
        tips={[
          "Events sync to the customer app so customers can see upcoming appearances.",
          "Use the Notes field for setup logistics, parking info, or contact instructions.",
          "Confirmed events appear on the Operations Calendar for team visibility.",
        ]}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-foreground">Events</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Sampling, pop-ups, and community activations · {events.length} total</p>
        </div>
        <Button onClick={() => setIsCreating(true)} className="gap-2 self-start sm:self-auto">
          <Plus className="h-4 w-4" /> Add Event
        </Button>
      </div>

      {/* Search + Filters */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name, location, or contact…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-card border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {STATUS_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all min-h-touch ${
                statusFilter === f
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-card border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Events list */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground border border-border rounded-xl bg-card">
            <CalendarDays className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No events found</p>
            <p className="text-sm mt-1">Try adjusting your search or filter.</p>
          </div>
        ) : (
          filtered.map(event => (
            <EventCard
              key={event.id}
              event={event}
              onEdit={setEditingEvent}
              onDelete={handleDelete}
              deleting={deleting}
            />
          ))
        )}
      </div>

      {(editingEvent || isCreating) && (
        <EventEditForm
          event={editingEvent}
          selectedDate={isCreating ? moment().format("YYYY-MM-DD") : null}
          onClose={() => { setEditingEvent(null); setIsCreating(false); }}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  );
}