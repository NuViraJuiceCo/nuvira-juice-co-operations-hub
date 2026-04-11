import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Phone, Mail, MapPin, Plus, Star } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.entities.Supplier.list("-updated_date", 50).then(data => {
      setSuppliers(data);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  const statusStyle = {
    Active: "bg-emerald-50 text-emerald-700",
    Negotiating: "bg-amber-50 text-amber-700",
    Inactive: "bg-gray-50 text-gray-500",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Suppliers</h1>
          <p className="text-muted-foreground mt-1">{suppliers.filter(s => s.status === "Active").length} active suppliers</p>
        </div>
        <Button className="gap-2 self-start sm:self-auto"><Plus className="h-4 w-4" /> Add Supplier</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {suppliers.map(s => (
          <div key={s.id} className="bg-card border border-border rounded-xl p-5 hover:shadow-sm transition-shadow">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-foreground">{s.name}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{s.category}</p>
              </div>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyle[s.status] || "bg-gray-50 text-gray-500"}`}>{s.status}</span>
            </div>
            <div className="space-y-1.5">
              {s.contact_name && <p className="text-sm font-medium text-foreground">{s.contact_name}</p>}
              {s.email && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Mail className="h-3 w-3" /><span>{s.email}</span></div>}
              {s.phone && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Phone className="h-3 w-3" /><span>{s.phone}</span></div>}
              {s.location && <div className="flex items-center gap-2 text-xs text-muted-foreground"><MapPin className="h-3 w-3" /><span>{s.location}</span></div>}
            </div>
            <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Lead: <span className="font-medium text-foreground">{s.lead_time_days ? `${s.lead_time_days} days` : "—"}</span></p>
              {s.rating && (
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className={`h-3 w-3 ${i < s.rating ? "text-amber-400 fill-amber-400" : "text-muted"}`} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}