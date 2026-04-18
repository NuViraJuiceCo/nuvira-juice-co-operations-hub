import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Mail, Phone, Plus, TrendingUp, Trash2, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import StatCard from "../components/shared/StatCard";
import PartnershipEditForm from "../components/partnerships/PartnershipEditForm";
import PartnershipCreateForm from "../components/partnerships/PartnershipCreateForm";

const stageStyle = {
  New: "bg-blue-50 text-blue-700",
  Contacted: "bg-cyan-50 text-cyan-700",
  "Proposal Sent": "bg-purple-50 text-purple-700",
  Negotiating: "bg-amber-50 text-amber-700",
  Won: "bg-emerald-50 text-emerald-700",
  Lost: "bg-red-50 text-red-700",
};

const typeColors = {
  Wholesale: "bg-emerald-50 text-emerald-700",
  Retail: "bg-blue-50 text-blue-700",
  Corporate: "bg-purple-50 text-purple-700",
  Event: "bg-amber-50 text-amber-700",
  Distributor: "bg-orange-50 text-orange-700",
  Referral: "bg-cyan-50 text-cyan-700",
  Other: "bg-gray-50 text-gray-700",
};

export default function Partnerships() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(null);
  const [editingLead, setEditingLead] = useState(null);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    base44.entities.Lead.list("-updated_date", 50).then(data => {
      setLeads(data);
      setLoading(false);
    });
  }, []);

  const handleSaveEdit = async () => {
    const data = await base44.entities.Lead.list("-updated_date", 50);
    setLeads(data);
    setEditingLead(null);
  };

  const handleDelete = async (id) => {
    setDeleting(id);
    try {
      await base44.entities.Lead.delete(id);
      setLeads(leads.filter(l => l.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selected.size} lead(s)?`)) return;
    setDeleting(true);
    try {
      await Promise.all(Array.from(selected).map(id => base44.entities.Lead.delete(id)));
      setLeads(leads.filter(l => !selected.has(l.id)));
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

  const active = leads.filter(l => !["Won", "Lost"].includes(l.stage)).length;
  const won = leads.filter(l => l.stage === "Won").length;
  const totalValue = leads.filter(l => l.estimated_value).reduce((s, l) => s + l.estimated_value, 0);

  const stages = ["New", "Contacted", "Proposal Sent", "Negotiating", "Won", "Lost"];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Partnerships & Leads</h1>
          <p className="text-muted-foreground mt-1">CRM pipeline for wholesale and corporate accounts</p>
        </div>
        <Button onClick={() => setIsCreating(true)} className="gap-2 self-start sm:self-auto"><Plus className="h-4 w-4" /> Add Lead</Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Active Pipeline" value={active} icon={TrendingUp} />
        <StatCard label="Won" value={won} icon={TrendingUp} />
        <StatCard label="Pipeline Value" value={`$${totalValue.toLocaleString()}`} icon={TrendingUp} />
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

      {/* Pipeline by stage */}
      <div className="space-y-4">
        {stages.map(stage => {
          const stageLeads = leads.filter(l => l.stage === stage);
          if (stageLeads.length === 0) return null;
          return (
            <div key={stage}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${stageStyle[stage]}`}>{stage}</span>
                <span className="text-xs text-muted-foreground">{stageLeads.length} lead{stageLeads.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {stageLeads.map(lead => (
                  <div key={lead.id} className="bg-card border border-border rounded-xl p-4 hover:shadow-sm transition-shadow relative">
                    <input
                      type="checkbox"
                      checked={selected.has(lead.id)}
                      onChange={() => toggleSelect(lead.id)}
                      className="absolute top-3 left-3"
                    />
                    <div className="absolute top-3 right-3 flex gap-1">
                      <button
                        onClick={() => setEditingLead(lead)}
                        className="text-primary hover:text-primary/80"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(lead.id)}
                        disabled={deleting === lead.id}
                        className="text-red-600 hover:text-red-700 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex items-start justify-between mb-2 pl-6">
                      <div>
                        <p className="font-semibold text-sm text-foreground">{lead.business_name}</p>
                        {lead.contact_name && <p className="text-xs text-muted-foreground">{lead.contact_name}</p>}
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeColors[lead.type] || "bg-gray-50 text-gray-700"}`}>{lead.type}</span>
                    </div>
                    <div className="space-y-1">
                      {lead.email && <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Mail className="h-3 w-3" />{lead.email}</div>}
                      {lead.phone && <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Phone className="h-3 w-3" />{lead.phone}</div>}
                    </div>
                    {lead.notes && <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border">{lead.notes}</p>}
                    {lead.estimated_value && (
                      <p className="text-xs font-medium text-emerald-700 mt-1">Est. value: ${lead.estimated_value.toLocaleString()}/mo</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {editingLead && (
        <PartnershipEditForm
          lead={editingLead}
          onClose={() => setEditingLead(null)}
          onSave={handleSaveEdit}
        />
      )}

      {isCreating && (
        <PartnershipCreateForm
          onClose={() => setIsCreating(false)}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  );
}