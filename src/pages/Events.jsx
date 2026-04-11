import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { CalendarDays, MapPin, Users, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import moment from "moment";

const typeColors = {
  "Pop-Up": "bg-cyan-50 text-cyan-700",
  Market: "bg-emerald-50 text-emerald-700",
  Corporate: "bg-blue-50 text-blue-700",
  Tasting: "bg-purple-50 text-purple-700",
  Festival: "bg-amber-50 text-amber-700",
  "Wholesale Meeting": "bg-orange-50 text-orange-700",
  Other: "bg-gray-50 text-gray-700",
};
const statusStyle = {
  Confirmed: "bg-emerald-50 text-emerald-700",
  Pending: "bg-amber-50 text-amber-700",
  Applied: "bg-blue-50 text-blue-700",
  Cancelled: "bg-red-50 text-red-700",
  Completed: "bg-gray-50 text-gray-700",
};

export default function Events() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.entities.Event.list("date", 50).then(data => {
      setEvents(data);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Events</h1>
          <p className="text-muted-foreground mt-1">{events.length} total events</p>
        </div>
        <Button className="gap-2 self-start sm:self-auto"><Plus className="h-4 w-4" /> Add Event</Button>
      </div>

      <div className="space-y-4">
        {events.map(event => (
          <div key={event.id} className="bg-card border border-border rounded-xl p-5 hover:shadow-sm transition-shadow">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 text-center bg-muted rounded-xl p-3 min-w-[56px]">
                <p className="text-xs font-medium text-muted-foreground uppercase">{moment(event.date).format("MMM")}</p>
                <p className="text-2xl font-bold text-foreground leading-tight">{moment(event.date).format("D")}</p>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground">{event.name}</h3>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeColors[event.type] || "bg-gray-50 text-gray-700"}`}>{event.type}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusStyle[event.status] || "bg-gray-50 text-gray-700"}`}>{event.status}</span>
                </div>
                <div className="flex flex-wrap gap-4 mt-2">
                  {event.location && <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5" /><span>{event.location}</span></div>}
                  {event.expected_attendees && <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" /><span>{event.expected_attendees} attendees</span></div>}
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" /><span>{moment(event.date).format("dddd, MMMM D, YYYY")}</span></div>
                </div>
                {event.products && <p className="text-xs text-muted-foreground mt-2 bg-muted px-3 py-1.5 rounded-lg">📦 {event.products}</p>}
                {event.notes && <p className="text-xs text-muted-foreground mt-1 px-3 py-1.5">📝 {event.notes}</p>}
              </div>
            </div>
          </div>
        ))}
        {events.length === 0 && <p className="text-center text-muted-foreground py-12">No events scheduled.</p>}
      </div>
    </div>
  );
}