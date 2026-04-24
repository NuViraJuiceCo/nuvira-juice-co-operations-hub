import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import AdminGuide from "../components/shared/AdminGuide";
import { Phone, Mail, MapPin, Plus, Star, Trash2, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import SupplierEditForm from "../components/suppliers/SupplierEditForm";
import SupplierCreateForm from "../components/suppliers/SupplierCreateForm";

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(null);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    base44.entities.Supplier.list("-updated_date", 50).then(data => {
      setSuppliers(data);
      setLoading(false);
    });
  }, []);

  const handleSaveEdit = async () => {
    const data = await base44.entities.Supplier.list("-updated_date", 50);
    setSuppliers(data);
    setEditingSupplier(null);
  };

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
      <AdminGuide
        title="Admin Guide — Suppliers"
        steps={[
          "Click 'Add Supplier' to add each of your ingredient and packaging vendors.",
          "Fill in the supplier name, category (e.g. Produce, Packaging), contact name, email, and phone.",
          "Set the Lead Time (days) so you know how far in advance to place orders.",
          "Rate each supplier (1–5 stars) based on reliability and quality for quick reference.",
        ]}
        tips={[
          "Link inventory items to suppliers so you always know who to call when stock is low.",
          "Keep the status updated — Active, Negotiating, or Inactive — so your team knows who to contact.",
          "Purchase Orders reference supplier names, so keep spelling consistent.",
        ]}
      />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Suppliers</h1>
          <p className="text-muted-foreground mt-1">{suppliers.filter(s => s.status === "Active").length} active suppliers</p>
        </div>
        <Button onClick={() => setIsCreating(true)} className="gap-2 self-start sm:self-auto"><Plus className="h-4 w-4" /> Add Supplier</Button>
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {suppliers.map(s => (
          <div key={s.id} className="bg-card border border-border rounded-xl p-4 sm:p-5 hover:shadow-sm transition-shadow relative">
            <input
              type="checkbox"
              checked={selected.has(s.id)}
              onChange={() => toggleSelect(s.id)}
              className="absolute top-2.5 sm:top-3 left-2.5 sm:left-3 w-4 h-4"
            />
            <div className="absolute top-2.5 sm:top-3 right-2.5 sm:right-3 flex gap-1">
              <button
                onClick={() => setEditingSupplier(s)}
                className="text-primary hover:text-primary/80 p-1"
              >
                <Edit2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </button>
              <button
                onClick={() => handleDelete(s.id)}
                disabled={deleting === s.id}
                className="text-red-600 hover:text-red-700 disabled:opacity-50 p-1"
              >
                <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </button>
            </div>
            <div className="flex items-start justify-between mb-3 pl-6">
              <div className="min-w-0">
                <h3 className="font-semibold text-foreground text-sm truncate">{s.name}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{s.category}</p>
              </div>
              <span className={`px-2 sm:px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-medium whitespace-nowrap ml-2 ${statusStyle[s.status] || "bg-gray-50 text-gray-500"}`}>{s.status}</span>
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

      {editingSupplier && (
        <SupplierEditForm
          supplier={editingSupplier}
          onClose={() => setEditingSupplier(null)}
          onSave={handleSaveEdit}
        />
      )}

      {isCreating && (
        <SupplierCreateForm
          onClose={() => setIsCreating(false)}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  );
}