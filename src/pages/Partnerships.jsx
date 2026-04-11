import { Handshake, Globe, Mail, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

const partners = [
  { id: 1, name: "Wellness Studio YVR", type: "Retail Partner", contact: "orders@wellnessyvr.com", status: "Active", since: "Jan 2025", revenue: "$1,240", notes: "Weekly event orders. Growing account." },
  { id: 2, name: "Lululemon HQ Café", type: "Corporate Account", contact: "cafe@lululemon.com", status: "Active", since: "Mar 2025", revenue: "$890", notes: "Bi-weekly standing order for 3 SKUs." },
  { id: 3, name: "Granville Island Market", type: "Market Vendor", contact: "vendors@granvilleisland.ca", status: "Active", since: "Jun 2024", revenue: "$2,100", notes: "Seasonal market booth. Saturdays." },
  { id: 4, name: "GoodFoods Co-op", type: "Wholesale Distributor", contact: "buy@goodfoodscoop.ca", status: "Negotiating", since: "—", revenue: "—", notes: "Proposal sent April 1. Awaiting response." },
  { id: 5, name: "YVR Yoga Studios Network", type: "Referral Partner", contact: "hello@yvryoga.com", status: "Active", since: "Oct 2024", revenue: "$450", notes: "Revenue share model. 8 studios." },
];

const statusStyle = {
  Active: "bg-emerald-50 text-emerald-700",
  Negotiating: "bg-amber-50 text-amber-700",
  Inactive: "bg-gray-50 text-gray-500",
};

export default function Partnerships() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Partnerships</h1>
          <p className="text-muted-foreground mt-1">{partners.filter(p => p.status === "Active").length} active partners</p>
        </div>
        <Button className="gap-2"><Plus className="h-4 w-4" /> Add Partner</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {partners.map((p) => (
          <div key={p.id} className="bg-card border border-border rounded-xl p-5 hover:shadow-sm transition-shadow">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-foreground">{p.name}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{p.type}</p>
              </div>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyle[p.status]}`}>{p.status}</span>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Mail className="h-3 w-3" /><span>{p.contact}</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>Since: <span className="text-foreground font-medium">{p.since}</span></span>
                <span>Revenue: <span className="text-foreground font-medium">{p.revenue}</span></span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border">{p.notes}</p>
          </div>
        ))}
      </div>
    </div>
  );
}