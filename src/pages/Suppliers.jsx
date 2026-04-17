import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Phone, Mail, MapPin, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    base44.entities.Supplier.list("-updated_date", 50).then(data => {
      setSuppliers(data);
      setLoading(false);
    });
  }, []);

  const handleDelete = async (id) => {
    setDeleting(id);
    try {
      await base44.entities.Supplier.delete(id);
      setSuppliers(suppliers.filter(s => s.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selected.size} supplier(s)?`)) return;
    setDeleting(true);
    try {
      await Promise.all(Array.from(selected).map(id => base44.entities.Supplier.delete(id)));
      setSuppliers(suppliers.filter(s => !selected.has(s.id)));
      setSelected(new Set());
    } finally {
      setDeleting(false);
    }
  };

  const toggleSelect = (id) => {
    const newSelected = new Set(selected);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelected(newSelected);
  };

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

      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <span className="text-sm font-medium text-blue-900">{selected.size} selected</span>
          <button onClick={handleBulkDelete} disabled={deleting} className="text-sm px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
            {deleting ? "Deleting..." : "Delete Selected"}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-sm px-3 py-1.5 rounded border border-blue-200 text-blue-700 hover:bg-blue-100">
            Cancel
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {suppliers.map(s => (
          <div key={s.id} className="bg-card border border-border rounded-xl p-5 hover:shadow-sm transition-shadow relative">
            <input
              type="checkbox"
              checked={selected.has(s.id)}
              onChange={() => toggleSelect(s.id)}
              className="absolute top-3 left-3"
            />
            <button
              onClick={() => handleDelete(s.id)}
              disabled={deleting === s.id}
              className="absolute top-3 right-3 text-red-600 hover:text-red-700 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <div className="flex items-start justify-between mb-3 pl-6">
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