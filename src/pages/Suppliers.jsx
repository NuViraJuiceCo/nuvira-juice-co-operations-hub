import { Phone, Mail, MapPin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

const suppliers = [
  { id: 1, name: "Fresh Farms", contact: "Dave Ruiz", email: "dave@freshfarms.ca", phone: "+1 604-555-0182", location: "Abbotsford, BC", category: "Produce", status: "Active", lead: "2 days" },
  { id: 2, name: "Local Market Co", contact: "Jenny Park", email: "jenny@localmarket.ca", phone: "+1 604-555-0247", location: "Vancouver, BC", category: "Produce", status: "Active", lead: "1 day" },
  { id: 3, name: "Tropical Imports", contact: "Sam Torres", email: "sam@tropicalimports.ca", phone: "+1 604-555-0331", location: "Richmond, BC", category: "Exotic Produce", status: "Active", lead: "4 days" },
  { id: 4, name: "AgroCo", contact: "Mike Bell", email: "mike@agroco.ca", phone: "+1 604-555-0412", location: "Langley, BC", category: "Juice Base", status: "Active", lead: "3 days" },
  { id: 5, name: "Spice World", contact: "Ravi Mehta", email: "ravi@spiceworld.ca", phone: "+1 604-555-0598", location: "Surrey, BC", category: "Spices & Herbs", status: "Active", lead: "2 days" },
  { id: 6, name: "Citrus Co", contact: "Laura Chen", email: "laura@citrusco.ca", phone: "+1 604-555-0641", location: "Delta, BC", category: "Citrus", status: "Inactive", lead: "5 days" },
];

export default function Suppliers() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Suppliers</h1>
          <p className="text-muted-foreground mt-1">{suppliers.filter(s => s.status === "Active").length} active suppliers</p>
        </div>
        <Button className="gap-2"><Plus className="h-4 w-4" /> Add Supplier</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {suppliers.map((s) => (
          <div key={s.id} className="bg-card border border-border rounded-xl p-5 hover:shadow-sm transition-shadow">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-foreground">{s.name}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{s.category}</p>
              </div>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${s.status === "Active" ? "bg-emerald-50 text-emerald-700" : "bg-gray-50 text-gray-500"}`}>
                {s.status}
              </span>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-foreground font-medium">{s.contact}</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Mail className="h-3 w-3" /><span>{s.email}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Phone className="h-3 w-3" /><span>{s.phone}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" /><span>{s.location}</span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-xs text-muted-foreground">Lead time: <span className="font-medium text-foreground">{s.lead}</span></p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}