import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Package, AlertTriangle, TrendingDown, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import StatCard from "../components/shared/StatCard";
import PullToRefresh from "../components/shared/PullToRefresh";

export default function Inventory() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    base44.entities.InventoryItem.list("-updated_date", 100).then(data => {
      setItems(data);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  const getStatus = (item) => {
    if (item.stock <= 0) return "Out of Stock";
    if (item.stock <= item.reorder_point * 0.5) return "Critical";
    if (item.stock <= item.reorder_point) return "Low";
    return "OK";
  };

  const filtered = items.filter(i => i.ingredient?.toLowerCase().includes(search.toLowerCase()) || i.supplier?.toLowerCase().includes(search.toLowerCase()));
  const low = items.filter(i => getStatus(i) === "Low").length;
  const critical = items.filter(i => getStatus(i) === "Critical" || getStatus(i) === "Out of Stock").length;

  const statusStyle = {
    OK: "bg-emerald-50 text-emerald-700",
    Low: "bg-amber-50 text-amber-700",
    Critical: "bg-red-50 text-red-700",
    "Out of Stock": "bg-red-100 text-red-800",
  };

  const handleRefresh = async () => {
    const data = await base44.entities.InventoryItem.list("-updated_date", 100);
    setItems(data);
  };

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Inventory</h1>
          <p className="text-muted-foreground mt-1">Track ingredient stock levels and reorder points</p>
        </div>
        <Button className="gap-2 self-start sm:self-auto"><Plus className="h-4 w-4" /> Add Item</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Items" value={items.length} icon={Package} />
        <StatCard label="Low Stock" value={low} icon={TrendingDown} />
        <StatCard label="Critical / Out" value={critical} icon={AlertTriangle} />
        <StatCard label="Categories" value={[...new Set(items.map(i => i.category).filter(Boolean))].length} icon={Package} />
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search ingredients..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Ingredient", "Category", "Stock", "Unit", "Reorder At", "Status", "Supplier", "Location"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => {
                const status = getStatus(item);
                return (
                  <tr key={item.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3.5 font-medium text-sm text-foreground">{item.ingredient}</td>
                    <td className="px-4 py-3.5 text-sm text-muted-foreground">{item.category || "—"}</td>
                    <td className="px-4 py-3.5 text-sm font-semibold text-foreground">{item.stock}</td>
                    <td className="px-4 py-3.5 text-sm text-muted-foreground">{item.unit}</td>
                    <td className="px-4 py-3.5 text-sm text-muted-foreground">{item.reorder_point}</td>
                    <td className="px-4 py-3.5">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyle[status]}`}>{status}</span>
                    </td>
                    <td className="px-4 py-3.5 text-sm text-muted-foreground">{item.supplier || "—"}</td>
                    <td className="px-4 py-3.5 text-sm text-muted-foreground">{item.location || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    </PullToRefresh>
  );
}