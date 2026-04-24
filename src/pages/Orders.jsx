import { useState, useEffect } from "react";
import OrderEditForm from "../components/orders/OrderEditForm";
import { base44 } from "@/api/base44Client";
import { Search, Download, Trash2, Edit2, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SelectContent, SelectItem } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import StatusBadge from "../components/shared/StatusBadge";
import AdminGuide from "../components/shared/AdminGuide";
import BulkActionsBar from "../components/shared/BulkActionsBar";
import ColumnSorter from "../components/shared/ColumnSorter";
import PullToRefresh from "../components/shared/PullToRefresh";
import SelectMobile from "../components/SelectMobile";
import moment from "moment";

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [sortBy, setSortBy] = useState("created_date");
  const [sortDir, setSortDir] = useState("desc");
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState(null);

  useEffect(() => {
    async function load() {
      const data = await base44.entities.ShopifyOrder.list("-created_date", 100);
      setOrders(data);
      setLoading(false);
    }
    load();
  }, []);

  const handleRefresh = async () => {
    const data = await base44.entities.ShopifyOrder.list("-created_date", 100);
    setOrders(data);
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await base44.functions.invoke('pullOrdersFromCustomerApp', {});
      // Wait for database to commit before refreshing
      await new Promise(resolve => setTimeout(resolve, 1000));
      await handleRefresh();
    } catch (error) {
      console.error('Sync failed:', error.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveEdit = async () => {
    await handleRefresh();
    setEditingOrder(null);
  };

  const filtered = orders.filter((o) => {
    if (!o) return false;
    const matchSearch =
      !search ||
      (o.shopify_order_number && o.shopify_order_number.toLowerCase().includes(search.toLowerCase())) ||
      (o.customer_email && o.customer_email.toLowerCase().includes(search.toLowerCase()));
    const matchStatus = statusFilter === "all" || o.production_status === statusFilter;
    const matchChannel = channelFilter === "all" || o.source_channel === channelFilter;
    return matchSearch && matchStatus && matchChannel;
  });

  const sorted = [...filtered].sort((a, b) => {
    let aVal = a[sortBy];
    let bVal = b[sortBy];
    if (!aVal && !bVal) return 0;
    if (!aVal) return sortDir === "asc" ? 1 : -1;
    if (!bVal) return sortDir === "asc" ? -1 : 1;
    if (sortBy === "total_price") {
      aVal = parseFloat(aVal) || 0;
      bVal = parseFloat(bVal) || 0;
    } else if (sortBy === "created_date") {
      aVal = new Date(aVal).getTime();
      bVal = new Date(bVal).getTime();
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
      setSelected(new Set(sorted.map(o => o.id)));
    }
  };

  const handleDelete = async (id) => {
    setDeleting(id);
    try {
      await base44.entities.ShopifyOrder.delete(id);
      setOrders(orders.filter(o => o.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selected.size} order(s)?`)) return;
    setDeleting(true);
    try {
      await Promise.all(Array.from(selected).map(id => base44.entities.ShopifyOrder.delete(id)));
      setOrders(orders.filter(o => !selected.has(o.id)));
      setSelected(new Set());
    } finally {
      setDeleting(false);
    }
  };

  const exportCSV = () => {
    const headers = "Order ID,Customer,Email,Channel,Status,Payment,Fulfillment,Total,Date\n";
    const rows = filtered
      .map((o) => {
        if (!o) return "";
        return `"${(o.shopify_order_number || "").replace(/"/g, '""')}","${(o.customer_email || "").replace(/"/g, '""')}","${(o.source_channel || "").replace(/"/g, '""')}","${(o.production_status || "").replace(/"/g, '""')}","${(o.payment_status || "").replace(/"/g, '""')}","${(o.fulfillment_method || "").replace(/"/g, '""')}",${(o.total_price || 0).toFixed(2)},"${moment(o.created_date).format("MMM D, h:mm A")}"`;
      })
      .filter(r => r)
      .join("\n");
    const blob = new Blob([headers + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nuvira-orders.csv";
    a.click();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <>
    <PullToRefresh onRefresh={handleRefresh}>
      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <AdminGuide
        title="Admin Guide — Orders"
        steps={[
          "Orders sync automatically from the NuVira customer app via the Pull Orders function.",
          "Use the search bar to find orders by order number, and filters to narrow by status or channel.",
          "Click the edit (pencil) icon on any order to update its production status, payment status, or notes.",
          "Export a CSV of the current filtered view using the Export button in the top right.",
        ]}
        tips={[
          "Orders from the customer app arrive with status 'New' — update them as they move through production.",
          "Use the production_status field to track an order from New → In Production → Packed → Fulfilled.",
        ]}
      />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Orders</h1>
          <p className="text-muted-foreground mt-1">{orders.length} synced orders</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSync} disabled={syncing} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync'}
          </Button>
          <Button variant="outline" onClick={exportCSV} className="gap-2">
            <Download className="h-4 w-4" /> Export
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 bg-card border border-border rounded-xl p-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search orders..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <SelectMobile value={statusFilter} onValueChange={setStatusFilter} placeholder="All Statuses" triggerClassName="w-full sm:w-44">
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="New">New</SelectItem>
            <SelectItem value="Confirmed">Confirmed</SelectItem>
            <SelectItem value="awaiting_production">Awaiting Production</SelectItem>
            <SelectItem value="in_production">In Production</SelectItem>
            <SelectItem value="packed">Packed</SelectItem>
          </SelectContent>
        </SelectMobile>
        <SelectMobile value={channelFilter} onValueChange={setChannelFilter} placeholder="All Channels" triggerClassName="w-full sm:w-44">
          <SelectContent>
            <SelectItem value="all">All Channels</SelectItem>
            <SelectItem value="online">Online</SelectItem>
            <SelectItem value="pos">POS</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="subscription">Subscription</SelectItem>
            <SelectItem value="wholesale">Wholesale</SelectItem>
          </SelectContent>
        </SelectMobile>
      </div>

      {/* Bulk Actions */}
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


      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-5 py-3 text-left w-10">
                <input
                 type="checkbox"
                 checked={selected.size === sorted.length && sorted.length > 0}
                 onChange={toggleSelectAll}
                 className="cursor-pointer"
                />
                </th>
                {[
                { label: "Order ID", col: "shopify_order_number" },
                { label: "Customer", col: "customer_email" },
                { label: "Channel", col: "source_channel" },
                { label: "Status", col: "production_status" },
                { label: "Payment", col: "payment_status" },
                { label: "Fulfillment", col: "fulfillment_method" },
                { label: "Total", col: "total_price" },
                { label: "Date", col: "created_date" },
                ].map((h) => (
                <th key={h.col} className={`px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:bg-muted/50 ${h.col === "total" ? "text-right" : "text-left"}`} onClick={() => handleSort(h.col)}>
                 <ColumnSorter column={h.label} sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                </th>
                ))}
                <th className="px-5 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider w-20">Action</th>
                  </tr>
            </thead>
            <tbody>
              {sorted.map((order) => (
                <tbody key={order.id}>
                  <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors min-h-touch cursor-pointer" onClick={() => setExpandedOrderId(expandedOrderId === order.id ? null : order.id)}>
                    <td className="px-5 py-3.5 w-10">
                      <input
                        type="checkbox"
                        checked={selected.has(order.id)}
                        onChange={(e) => { e.stopPropagation(); toggleSelect(order.id); }}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-sm font-medium text-primary">{order.shopify_order_number}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-medium text-foreground">{order.customer_email}</p>
                      <p className="text-xs text-muted-foreground">{order.customer_phone}</p>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-muted-foreground">{order.source_channel}</td>
                    <td className="px-5 py-3.5"><StatusBadge status={order.production_status} /></td>
                    <td className="px-5 py-3.5"><StatusBadge status={order.payment_status} /></td>
                    <td className="px-5 py-3.5 text-sm text-muted-foreground">
                      {order.fulfillment_method}{order.delivery_address ? ` · ${order.delivery_address.substring(0, 20)}...` : " · -"}
                    </td>
                    <td className="px-5 py-3.5 text-sm font-semibold text-foreground text-right">
                      ${order.total_price?.toFixed(2)}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-muted-foreground whitespace-nowrap">
                      {moment(order.created_date).format("MMM D, h:mm A")}
                    </td>
                    <td className="px-5 py-3.5 text-center w-20">
                     <div className="flex items-center justify-center gap-2 flex-nowrap" onClick={(e) => e.stopPropagation()}>
                       <button
                         onClick={() => setEditingOrder(order)}
                         className="text-primary hover:text-primary/80"
                       >
                         <Edit2 className="h-4 w-4" />
                       </button>
                       <button
                         onClick={() => handleDelete(order.id)}
                         disabled={deleting === order.id}
                         className="text-red-600 hover:text-red-700 disabled:opacity-50"
                       >
                         <Trash2 className="h-4 w-4" />
                       </button>
                     </div>
                    </td>
                  </tr>
                  {expandedOrderId === order.id && order.line_items && order.line_items.length > 0 && (
                    <tr className="border-b border-border/50 last:border-0 bg-muted/20">
                      <td colSpan="10" className="px-5 py-4">
                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-foreground mb-3">Products in this order:</p>
                          <div className="space-y-2">
                            {order.line_items.map((item, idx) => (
                              <div key={idx} className="flex items-center justify-between bg-card border border-border rounded-lg px-4 py-2.5">
                                <div className="flex-1">
                                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                                  <p className="text-xs text-muted-foreground mt-0.5">Qty: {item.quantity} @ ${item.price?.toFixed(2) || '0.00'} each</p>
                                </div>
                                <div className="text-sm font-semibold text-foreground text-right">
                                  ${(item.quantity * (item.price || 0)).toFixed(2)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    </PullToRefresh>

    {editingOrder && (
      <OrderEditForm
        order={editingOrder}
        onClose={() => setEditingOrder(null)}
        onSave={handleSaveEdit}
      />
    )}
    </>
  );
}