import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Package, AlertTriangle, TrendingDown, Plus, Search, Trash2, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import StatCard from "../components/shared/StatCard";
import AdminGuide from "../components/shared/AdminGuide";
import BulkActionsBar from "../components/shared/BulkActionsBar";
import ColumnSorter from "../components/shared/ColumnSorter";
import PullToRefresh from "../components/shared/PullToRefresh";
import InventoryEditForm from "../components/inventory/InventoryEditForm";
import InventoryCreateForm from "../components/inventory/InventoryCreateForm";

export default function Inventory() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("category");
  const [sortDir, setSortDir] = useState("asc");
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    base44.entities.InventoryItem.list("-updated_date", 100).then(data => {
      setItems(data);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  const getStatus = (item) => {
    if (item.stock <= 0) return "Out of Stock";
    if (!item.reorder_point) return "OK";
    if (item.stock <= item.reorder_point * 0.5) return "Critical";
    if (item.stock <= item.reorder_point) return "Low";
    return "OK";
  };

  const filtered = items.filter(i => {
    const matchSearch = i.ingredient?.toLowerCase().includes(search.toLowerCase()) || i.supplier?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || getStatus(i) === statusFilter;
    return matchSearch && matchStatus;
  });

  const sorted = [...filtered].sort((a, b) => {
    // Primary sort: Packaging category first, then by category, then by ingredient
    if (sortBy === "ingredient") {
      // Packaging items first
      if (a.category === "Packaging" && b.category !== "Packaging") return -1;
      if (a.category !== "Packaging" && b.category === "Packaging") return 1;
      // Then sort by category, then by ingredient name alphabetically
      if (a.category !== b.category) {
        return (a.category || "").localeCompare(b.category || "");
      }
      return (a.ingredient || "").localeCompare(b.ingredient || "");
    }
    // Standard column sort
    let aVal = a[sortBy];
    let bVal = b[sortBy];
    if (["stock", "reorder_point", "max_stock", "cost_per_unit"].includes(sortBy)) {
      aVal = parseFloat(aVal) || 0;
      bVal = parseFloat(bVal) || 0;
    }
    const cmp = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });

  const handleSort = (col) => {
    if (sortBy === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
  };

  const toggleSelect = (id) => {
    const newSelected = new Set(selected);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelected(newSelected);
  };

  const toggleSelectAll = () => {
    if (selected.size === sorted.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sorted.map(i => i.id)));
    }
  };
  const low = items.filter(i => getStatus(i) === "Low").length;
  const critical = items.filter(i => getStatus(i) === "Critical" || getStatus(i) === "Out of Stock").length;

  const statusStyle = {
    OK: "bg-emerald-50 text-emerald-700",
    Low: "bg-amber-50 text-amber-700",
    Critical: "bg-red-50 text-red-700",
    "Out of Stock": "bg-red-100 text-red-800",
  };

  const statusOptions = ["all", "OK", "Low", "Critical", "Out of Stock"];

  const handleRefresh = async () => {
    const data = await base44.entities.InventoryItem.list("-updated_date", 100);
    setItems(data);
  };

  const handleSaveEdit = async () => {
    await handleRefresh();
    setEditingItem(null);
  };

  const handleDelete = async (id) => {
    setDeleting(id);
    try {
      await base44.entities.InventoryItem.delete(id);
      setItems(items.filter(i => i.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selected.size} ingredient(s)?`)) return;
    setDeleting(true);
    try {
      await Promise.all(Array.from(selected).map(id => base44.entities.InventoryItem.delete(id)));
      setItems(items.filter(i => !selected.has(i.id)));
      setSelected(new Set());
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
    <PullToRefresh onRefresh={handleRefresh}>
      <div className="space-y-6">
      <AdminGuide
        title="Admin Guide — Inventory"
        steps={[
          "Click 'Add Item' to add each ingredient or supply you use in production.",
          "For each item, fill in: name, category, unit (kg/L/units/etc.), current stock, and reorder point.",
          "The reorder point is the stock level at which you want to be alerted to reorder.",
          "Update stock levels regularly — especially after production runs or new deliveries arrive.",
          "Assign a supplier to each item so you know who to contact when stock gets low.",
        ]}
        tips={[
          "Items with stock at or below the reorder point show as 'Low' — keep an eye on these before production runs.",
          "Use the Location field (e.g. Cold Room, Dry Store) to know where each item is physically stored.",
          "The Purchase Orders page will flag low-stock items automatically as suggested reorders.",
        ]}
      />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Inventory</h1>
          <p className="text-muted-foreground mt-1">Track ingredient stock levels and reorder points</p>
        </div>
        <Button onClick={() => setIsCreating(true)} className="gap-2 self-start sm:self-auto"><Plus className="h-4 w-4" /> Add Item</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Items" value={items.length} icon={Package} />
        <StatCard label="Low Stock" value={low} icon={TrendingDown} />
        <StatCard label="Critical / Out" value={critical} icon={AlertTriangle} />
        <StatCard label="Categories" value={[...new Set(items.map(i => i.category).filter(Boolean))].length} icon={Package} />
      </div>

      <div className="space-y-3">
         <div className="relative">
           <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
           <Input className="pl-9 text-sm w-full" placeholder="Search ingredients..." value={search} onChange={e => setSearch(e.target.value)} />
         </div>
         <select
           value={statusFilter}
           onChange={(e) => setStatusFilter(e.target.value)}
           className="w-full px-3 py-2 rounded-lg border border-input bg-background text-xs sm:text-sm"
         >
           {statusOptions.map(s => (
             <option key={s} value={s}>{s === "all" ? "All Statuses" : s}</option>
           ))}
         </select>
       </div>

      {/* Bulk Actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <span className="text-sm font-medium text-blue-900">{selected.size} selected</span>
          <button
            onClick={handleBulkDelete}
            disabled={deleting}
            className="text-sm px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
          >
            {deleting ? "Deleting..." : "Delete Selected"}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-sm px-3 py-1.5 rounded border border-blue-200 text-blue-700 hover:bg-blue-100"
          >
            Cancel
          </button>
        </div>
      )}
      <BulkActionsBar
        selectedCount={selected.size}
        onClearSelection={() => setSelected(new Set())}
      />

      {/* Desktop Table — ONLY 768px+ (HIDDEN on mobile) */}
      <div className="hidden sm:block bg-card border border-border rounded-xl overflow-hidden" style={{display: 'none'}}>
         <div className="overflow-x-auto">
           <table className="w-full text-sm">
             <thead>
               <tr className="border-b border-border bg-muted/30">
                 <th className="px-3 sm:px-4 py-3 text-left w-10">
                   <input
                     type="checkbox"
                     checked={selected.size === sorted.length && sorted.length > 0}
                     onChange={toggleSelectAll}
                     className="cursor-pointer"
                   />
                 </th>
                 <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:bg-muted/50" onClick={() => handleSort("ingredient")}>
                   <ColumnSorter column="Ingredient" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                 </th>
                 <th className="hidden sm:table-cell px-3 sm:px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:bg-muted/50" onClick={() => handleSort("category")}>
                   <ColumnSorter column="Category" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                 </th>
                 <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:bg-muted/50" onClick={() => handleSort("stock")}>
                   <ColumnSorter column="Stock" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                 </th>
                 <th className="hidden md:table-cell px-3 sm:px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:bg-muted/50" onClick={() => handleSort("reorder_point")}>
                   <ColumnSorter column="Reorder At" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                 </th>
                 <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:bg-muted/50" onClick={() => handleSort("status")}>
                   <ColumnSorter column="Status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                 </th>
                 <th className="hidden lg:table-cell px-3 sm:px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:bg-muted/50" onClick={() => handleSort("supplier")}>
                   <ColumnSorter column="Supplier" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                 </th>
                 <th className="px-3 sm:px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider w-20">Action</th>
               </tr>
             </thead>
             <tbody>
               {sorted.map(item => {
                 const status = getStatus(item);
                 return (
                   <tr key={item.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                     <td className="px-3 sm:px-4 py-3.5 w-10">
                       <input
                         type="checkbox"
                         checked={selected.has(item.id)}
                         onChange={() => toggleSelect(item.id)}
                         className="cursor-pointer"
                       />
                     </td>
                     <td className="px-3 sm:px-4 py-3.5 font-medium text-foreground">{item.ingredient}</td>
                     <td className="hidden sm:table-cell px-3 sm:px-4 py-3.5 text-muted-foreground">{item.category || "—"}</td>
                     <td className="px-3 sm:px-4 py-3.5 font-semibold text-foreground">{item.stock} {item.unit}</td>
                     <td className="hidden md:table-cell px-3 sm:px-4 py-3.5 text-muted-foreground">{item.reorder_point}</td>
                     <td className="px-3 sm:px-4 py-3.5">
                       <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyle[status]}`}>{status}</span>
                     </td>
                     <td className="hidden lg:table-cell px-3 sm:px-4 py-3.5 text-muted-foreground truncate">{item.supplier || "—"}</td>
                     <td className="px-3 sm:px-4 py-3.5 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => setEditingItem(item)}
                            className="text-primary hover:text-primary/80"
                            title="Edit ingredient"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(item.id)}
                            disabled={deleting === item.id}
                            className="text-red-600 hover:text-red-700 disabled:opacity-50"
                            title="Delete ingredient"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                   </tr>
                 );
               })}
             </tbody>
           </table>
         </div>
       </div>

      {/* Mobile Cards — ONLY LAYOUT <768px (FORCED) */}
      <div className="sm:hidden space-y-3 w-full" style={{display: 'block'}}>
        {sorted.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No ingredients found.</p>
          </div>
        ) : (
          sorted.map(item => {
            const status = getStatus(item);
            return (
              <div key={item.id} className="bg-card border border-border rounded-lg p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground">{item.ingredient}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.category || "Uncategorized"}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggleSelect(item.id)}
                    className="cursor-pointer flex-shrink-0 mt-1"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Stock</p>
                    <p className="font-semibold">{item.stock} {item.unit}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Reorder At</p>
                    <p className="font-semibold">{item.reorder_point}</p>
                  </div>
                  {item.supplier && (
                    <div className="col-span-2">
                      <p className="text-muted-foreground">Supplier</p>
                      <p className="text-xs truncate">{item.supplier}</p>
                    </div>
                  )}
                  <div className="col-span-2">
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyle[status]}`}>{status}</span>
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setEditingItem(item)}
                    className="flex-1 px-3 py-2 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    disabled={deleting === item.id}
                    className="flex-1 px-3 py-2 text-xs bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100 transition-colors disabled:opacity-50"
                  >
                    {deleting === item.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      </div>
    </PullToRefresh>

    {editingItem && (
      <InventoryEditForm
        item={editingItem}
        onClose={() => setEditingItem(null)}
        onSave={handleSaveEdit}
      />
    )}

    {isCreating && (
      <InventoryCreateForm
        onClose={() => setIsCreating(false)}
        onSave={handleSaveEdit}
      />
    )}
    </>
  );
}