import { ShoppingBag, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import moment from "moment";

const pos = [
  { id: "PO-001", supplier: "Fresh Farms", items: "Kale 20kg, Spinach 15kg, Celery 12kg", amount: 185.00, status: "Delivered", ordered: "2026-04-01", eta: "2026-04-03" },
  { id: "PO-002", supplier: "Tropical Imports", items: "Pineapple 10kg, Mango 8kg", amount: 124.50, status: "In Transit", ordered: "2026-04-09", eta: "2026-04-13" },
  { id: "PO-003", supplier: "Fresh Farms", items: "Blueberries 15kg", amount: 97.50, status: "Ordered", ordered: "2026-04-11", eta: "2026-04-14" },
  { id: "PO-004", supplier: "AgroCo", items: "Apple Juice Base 50L", amount: 210.00, status: "Delivered", ordered: "2026-03-28", eta: "2026-04-01" },
  { id: "PO-005", supplier: "Spice World", items: "Turmeric 1kg, Ginger Powder 500g", amount: 42.00, status: "Draft", ordered: "2026-04-11", eta: "—" },
];

const statusStyle = {
  Delivered: "bg-emerald-50 text-emerald-700",
  "In Transit": "bg-blue-50 text-blue-700",
  Ordered: "bg-cyan-50 text-cyan-700",
  Draft: "bg-gray-50 text-gray-500",
  Cancelled: "bg-red-50 text-red-700",
};

export default function PurchaseOrders() {
  const totalSpend = pos.filter(p => p.status !== "Draft").reduce((s, p) => s + p.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Purchase Orders</h1>
          <p className="text-muted-foreground mt-1">{pos.length} orders · ${totalSpend.toFixed(2)} total spend</p>
        </div>
        <Button className="gap-2"><Plus className="h-4 w-4" /> New PO</Button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["PO #", "Supplier", "Items", "Amount", "Status", "Ordered", "ETA"].map(h => (
                  <th key={h} className={`px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider ${h === "Amount" ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pos.map((po) => (
                <tr key={po.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-3.5 font-medium text-sm text-primary">{po.id}</td>
                  <td className="px-5 py-3.5 text-sm font-medium text-foreground">{po.supplier}</td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground max-w-xs truncate">{po.items}</td>
                  <td className="px-5 py-3.5 text-sm font-semibold text-foreground text-right">${po.amount.toFixed(2)}</td>
                  <td className="px-5 py-3.5">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyle[po.status]}`}>{po.status}</span>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">{moment(po.ordered).format("MMM D")}</td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">{po.eta !== "—" ? moment(po.eta).format("MMM D") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}