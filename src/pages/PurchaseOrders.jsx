import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { ShoppingBag, Plus, AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import moment from "moment";
import StatCard from "../components/shared/StatCard";
import AdminGuide from "../components/shared/AdminGuide";

const PurchaseOrderCreateForm = ({ onClose, onSave }) => {
  const [formData, setFormData] = useState({
    po_number: '',
    supplier: '',
    total_amount: '',
    status: 'Draft',
    order_date: moment().format('YYYY-MM-DD'),
    expected_date: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await base44.entities.PurchaseOrder.create(formData);
      onSave();
    } catch (err) {
      setError(err.message || 'Failed to create PO');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-card rounded-xl shadow-lg max-w-md w-full p-6 my-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Create Purchase Order</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">PO Number</label>
            <input
              type="text"
              value={formData.po_number}
              onChange={(e) => handleChange('po_number', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              required
            />
          </div>

          <div>
            <label className="text-sm font-medium">Supplier</label>
            <input
              type="text"
              value={formData.supplier}
              onChange={(e) => handleChange('supplier', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Amount</label>
              <input
                type="number"
                value={formData.total_amount}
                onChange={(e) => handleChange('total_amount', e.target.value ? parseFloat(e.target.value) : '')}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Status</label>
              <select
                value={formData.status}
                onChange={(e) => handleChange('status', e.target.value)}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              >
                <option>Draft</option>
                <option>Ordered</option>
                <option>In Transit</option>
                <option>Delivered</option>
                <option>Cancelled</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Order Date</label>
              <input
                type="date"
                value={formData.order_date}
                onChange={(e) => handleChange('order_date', e.target.value)}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              />
            </div>
            <div>
              <label className="text-sm font-medium">ETA</label>
              <input
                type="date"
                value={formData.expected_date}
                onChange={(e) => handleChange('expected_date', e.target.value)}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

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

  const handleSaveCreate = async () => {
    const data = await base44.entities.PurchaseOrder.list("-order_date", 50);
    setPos(data);
    setIsCreating(false);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  const getStatus = (item) => item.stock <= item.reorder_point ? "Low" : "OK";
  const lowStockItems = inventory.filter(i => getStatus(i) === "Low");
  const totalSpend = pos.filter(p => p.status !== "Draft").reduce((s, p) => s + (p.total_amount || 0), 0);
  const pending = pos.filter(p => ["Ordered", "In Transit"].includes(p.status)).length;

  return (
    <div className="space-y-6">
      <AdminGuide
        title="Admin Guide — Purchase Orders"
        steps={[
          "Click 'New PO' to create a purchase order when you need to reorder ingredients or supplies.",
          "Fill in the PO number, supplier name, total amount, order date, and expected delivery date.",
          "Update the status as the order progresses: Draft → Ordered → In Transit → Delivered.",
          "Low-stock items from Inventory are automatically suggested as reorders at the top of this page.",
        ]}
        tips={[
          "Use a consistent PO numbering format (e.g. PO-2026-001) for easy tracking.",
          "Mark POs as Delivered when stock arrives and then manually update Inventory stock levels.",
          "The 'Pending Arrival' stat card shows how many orders are currently Ordered or In Transit.",
        ]}
      />
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

      {isCreating && (
        <PurchaseOrderCreateForm
          onClose={() => setIsCreating(false)}
          onSave={handleSaveCreate}
        />
      )}
    </div>
  );
}