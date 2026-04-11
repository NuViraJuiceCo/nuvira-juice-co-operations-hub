import { useState } from "react";
import { CalendarDays, MapPin, Users, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import moment from "moment";

const events = [
  { id: 1, name: "Wellness Studio YVR Pop-Up", date: "2026-04-12", location: "456 Wellness Ave, Vancouver, BC", type: "Pop-Up", attendees: 40, status: "Confirmed", notes: "24 bottles Berry Blast. Setup at 9am." },
  { id: 2, name: "Granville Island Farmers Market", date: "2026-04-19", location: "Granville Island, Vancouver, BC", type: "Market", attendees: 200, status: "Confirmed", notes: "Bring full product line. 6 cases each SKU." },
  { id: 3, name: "Corporate Wellness Day — TechCorp", date: "2026-04-25", location: "123 Tech Blvd, Burnaby, BC", type: "Corporate", attendees: 80, status: "Pending", notes: "Pending product selection from client." },
  { id: 4, name: "Lululemon HQ Tasting", date: "2026-05-03", location: "1818 Cornwall Ave, Vancouver, BC", type: "Tasting", attendees: 30, status: "Confirmed", notes: "Showcase Aura and Oasis lines." },
  { id: 5, name: "EAT! Vancouver Food Festival", date: "2026-05-15", location: "BC Place, Vancouver, BC", type: "Festival", attendees: 1500, status: "Applied", notes: "Awaiting booth confirmation." },
];

const typeColors = {
  "Pop-Up": "bg-cyan-50 text-cyan-700",
  Market: "bg-emerald-50 text-emerald-700",
  Corporate: "bg-blue-50 text-blue-700",
  Tasting: "bg-purple-50 text-purple-700",
  Festival: "bg-amber-50 text-amber-700",
};

const statusStyle = {
  Confirmed: "bg-emerald-50 text-emerald-700",
  Pending: "bg-amber-50 text-amber-700",
  Applied: "bg-blue-50 text-blue-700",
};

export default function Events() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Events</h1>
          <p className="text-muted-foreground mt-1">{events.length} upcoming events</p>
        </div>
        <Button className="gap-2"><Plus className="h-4 w-4" /> Add Event</Button>
      </div>

      <div className="space-y-4">
        {events.map((event) => (
          <div key={event.id} className="bg-card border border-border rounded-xl p-5 hover:shadow-sm transition-shadow">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 text-center bg-muted rounded-xl p-3 min-w-[56px]">
                <p className="text-xs font-medium text-muted-foreground uppercase">{moment(event.date).format("MMM")}</p>
                <p className="text-2xl font-bold text-foreground leading-tight">{moment(event.date).format("D")}</p>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground">{event.name}</h3>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeColors[event.type]}`}>{event.type}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusStyle[event.status]}`}>{event.status}</span>
                </div>
                <div className="flex flex-wrap gap-4 mt-2">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" /><span>{event.location}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Users className="h-3.5 w-3.5" /><span>{event.attendees} attendees</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" /><span>{moment(event.date).format("dddd, MMMM D, YYYY")}</span>
                  </div>
                </div>
                {event.notes && (
                  <p className="text-xs text-muted-foreground mt-2 bg-muted px-3 py-1.5 rounded-lg">{event.notes}</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}