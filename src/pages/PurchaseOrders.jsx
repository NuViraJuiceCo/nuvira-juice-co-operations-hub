import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { ShoppingBag, Plus, AlertTriangle } from "lucide-react";
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
        <Button className="gap-2 self-start sm:self-auto"><Plus className="h-4 w-4" /> New PO</Button>
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

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["PO #", "Supplier", "Amount", "Status", "Ordered", "ETA"].map(h => (
                  <th key={h} className={`px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider ${h === "Amount" ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pos.map(po => (
                <tr key={po.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-3.5 font-medium text-sm text-primary">{po.po_number}</td>
                  <td className="px-5 py-3.5 text-sm font-medium text-foreground">{po.supplier}</td>
                  <td className="px-5 py-3.5 text-sm font-semibold text-foreground text-right">${(po.total_amount || 0).toFixed(2)}</td>
                  <td className="px-5 py-3.5"><span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyle[po.status]}`}>{po.status}</span></td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">{po.order_date ? moment(po.order_date).format("MMM D") : "—"}</td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">{po.expected_date ? moment(po.expected_date).format("MMM D") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}