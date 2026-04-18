import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { ShoppingBag, Plus, AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import moment from "moment";
import StatCard from "../components/shared/StatCard";

const statusStyle = {
  Delivered: "bg-emerald-50 text-emerald-700",
  "In Transit": "bg-blue-50 text-blue-700",
  Ordered: "bg-cyan-50 text-cyan-700",
  Draft: "bg-gray-50 text-gray-500",
  Cancelled: "bg-red-50 text-red-700",
};

export default function PurchaseOrders() {
  const [pos, setPos] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(null);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    Promise.all([
      base44.entities.PurchaseOrder.list("-order_date", 50),
      base44.entities.InventoryItem.list("-updated_date", 100),
    ]).then(([poData, invData]) => {
      setPos(poData);
      setInventory(invData);
      setLoading(false);
    });
  }, []);

  const handleDelete = async (id) => {
    setDeleting(id);
    try {
      await base44.entities.PurchaseOrder.delete(id);
      setPos(pos.filter(p => p.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selected.size} PO(s)?`)) return;
    setDeleting(true);
    try {
      await Promise.all(Array.from(selected).map(id => base44.entities.PurchaseOrder.delete(id)));
      setPos(pos.filter(p => !selected.has(p.id)));
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

  const getStatus = (item) => item.stock <= item.reorder_point ? "Low" : "OK";
  const lowStockItems = inventory.filter(i => getStatus(i) === "Low");
  const totalSpend = pos.filter(p => p.status !== "Draft").reduce((s, p) => s + (p.total_amount || 0), 0);
  const pending = pos.filter(p => ["Ordered", "In Transit"].includes(p.status)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Purchase Orders</h1>
          <p className="text-muted-foreground mt-1">{pos.length} orders this month</p>
        </div>
        <Button onClick={() => setIsCreating(true)} className="gap-2 self-start sm:self-auto"><Plus className="h-4 w-4" /> New PO</Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Spend" value={`$${totalSpend.toFixed(0)}`} icon={ShoppingBag} />
        <StatCard label="Pending Arrival" value={pending} icon={ShoppingBag} />
        <StatCard label="Low Stock Alerts" value={lowStockItems.length} icon={AlertTriangle} />
      </div>

      {lowStockItems.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-amber-800 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Suggested Reorders</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {lowStockItems.map(item => (
              <span key={item.id} className="px-2.5 py-1 bg-white border border-amber-200 rounded-lg text-xs text-amber-800 font-medium">
                {item.ingredient} — {item.stock} {item.unit} (reorder at {item.reorder_point})
              </span>
            ))}
          </div>
        </div>
      )}

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

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Select</th>
                {["PO #", "Supplier", "Amount", "Status", "Ordered", "ETA"].map(h => (
                  <th key={h} className={`px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider ${h === "Amount" ? "text-right" : "text-left"}`}>{h}</th>
                ))}
                <th className="px-5 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody>
              {pos.map(po => (
                <tr key={po.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-3.5">
                    <input
                      type="checkbox"
                      checked={selected.has(po.id)}
                      onChange={() => toggleSelect(po.id)}
                    />
                  </td>
                  <td className="px-5 py-3.5 font-medium text-sm text-primary">{po.po_number}</td>
                  <td className="px-5 py-3.5 text-sm font-medium text-foreground">{po.supplier}</td>
                  <td className="px-5 py-3.5 text-sm font-semibold text-foreground text-right">${(po.total_amount || 0).toFixed(2)}</td>
                  <td className="px-5 py-3.5"><span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyle[po.status]}`}>{po.status}</span></td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">{po.order_date ? moment(po.order_date).format("MMM D") : "—"}</td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">{po.expected_date ? moment(po.expected_date).format("MMM D") : "—"}</td>
                  <td className="px-5 py-3.5 text-center">
                    <button
                      onClick={() => handleDelete(po.id)}
                      disabled={deleting === po.id}
                      className="text-red-600 hover:text-red-700 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                  </tr>
                  ))}
                  </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}