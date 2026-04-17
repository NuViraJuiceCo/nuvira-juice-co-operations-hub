import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Search, Download, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SelectContent, SelectItem } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import StatusBadge from "../components/shared/StatusBadge";
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

  useEffect(() => {
    async function load() {
      const data = await base44.entities.Order.list("-created_date", 100);
      setOrders(data);
      setLoading(false);
    }
    load();
  }, []);

  const handleRefresh = async () => {
    const data = await base44.entities.Order.list("-created_date", 100);
    setOrders(data);
  };

  const filtered = orders.filter((o) => {
    const matchSearch =
      !search ||
      o.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
      o.order_id?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || o.status === statusFilter;
    const matchChannel = channelFilter === "all" || o.channel === channelFilter;
    return matchSearch && matchStatus && matchChannel;
  });

  const sorted = [...filtered].sort((a, b) => {
    let aVal = a[sortBy];
    let bVal = b[sortBy];
    if (sortBy === "total") {
      aVal = parseFloat(aVal) || 0;
      bVal = parseFloat(bVal) || 0;
    } else if (sortBy === "created_date") {
      aVal = new Date(aVal);
      bVal = new Date(bVal);
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
      await base44.entities.Order.delete(id);
      setOrders(orders.filter(o => o.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selected.size} order(s)?`)) return;
    setDeleting(true);
    try {
      await Promise.all(Array.from(selected).map(id => base44.entities.Order.delete(id)));
      setOrders(orders.filter(o => !selected.has(o.id)));
      setSelected(new Set());
    } finally {
      setDeleting(false);
    }
  };

  const exportCSV = () => {
    const headers = "Order ID,Customer,Email,Channel,Status,Payment,Fulfillment,Total,Date\n";
    const rows = filtered
      .map((o) =>
        `${o.order_id},${o.customer_name},${o.customer_email || ""},${o.channel},${o.status},${o.payment_status},${o.fulfillment_type},${o.total},${moment(o.created_date).format("MMM D, h:mm A")}`
      )
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
    <PullToRefresh onRefresh={handleRefresh}>
      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Orders</h1>
          <p className="text-muted-foreground mt-1">{orders.length} total orders</p>
        </div>
        <Button variant="outline" onClick={exportCSV} className="gap-2">
          <Download className="h-4 w-4" /> Export
        </Button>
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
            <SelectItem value="Scheduled for Production">Scheduled for Production</SelectItem>
            <SelectItem value="In Production">In Production</SelectItem>
            <SelectItem value="Completed">Completed</SelectItem>
          </SelectContent>
        </SelectMobile>
        <SelectMobile value={channelFilter} onValueChange={setChannelFilter} placeholder="All Channels" triggerClassName="w-full sm:w-44">
          <SelectContent>
            <SelectItem value="all">All Channels</SelectItem>
            <SelectItem value="Shopify Web Store">Shopify Web Store</SelectItem>
            <SelectItem value="Instagram">Instagram</SelectItem>
            <SelectItem value="NuVira Juice App">NuVira Juice App</SelectItem>
            <SelectItem value="Facebook">Facebook</SelectItem>
            <SelectItem value="Event Order">Event Order</SelectItem>
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
      <BulkActionsBar
        selectedCount={selected.size}
        onClearSelection={() => setSelected(new Set())}
      />

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-5 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={selected.size === sorted.length && sorted.length > 0}
                    onChange={toggleSelectAll}
                    className="cursor-pointer"
                  />
                </th>
                {[
                  { label: "Order ID", col: "order_id" },
                  { label: "Customer", col: "customer_name" },
                  { label: "Channel", col: "channel" },
                  { label: "Status", col: "status" },
                  { label: "Payment", col: "payment_status" },
                  { label: "Fulfillment", col: "fulfillment_type" },
                  { label: "Total", col: "total" },
                  { label: "Date", col: "created_date" },
                  ].map((h) => (
                  <th key={h.col} className={`px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:bg-muted/50 ${h.col === "total" ? "text-right" : "text-left"}`} onClick={() => handleSort(h.col)}>
                    <ColumnSorter column={h.label} sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                  </th>
                  ))}
                  <th className="px-5 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">Action</th>
                  </tr>
            </thead>
            <tbody>
              {sorted.map((order) => (
                <tr key={order.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors min-h-touch">
                  <td className="px-5 py-3.5">
                    <input
                      type="checkbox"
                      checked={selected.has(order.id)}
                      onChange={() => toggleSelect(order.id)}
                      className="cursor-pointer"
                    />
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-sm font-medium text-primary">{order.order_id}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-sm font-medium text-foreground">{order.customer_name}</p>
                    <p className="text-xs text-muted-foreground">{order.customer_email}</p>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">{order.channel}</td>
                  <td className="px-5 py-3.5"><StatusBadge status={order.status} /></td>
                  <td className="px-5 py-3.5"><StatusBadge status={order.payment_status} /></td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">
                    {order.fulfillment_type}{order.fulfillment_window ? ` · ${order.fulfillment_window}` : " · -"}
                  </td>
                  <td className="px-5 py-3.5 text-sm font-semibold text-foreground text-right">
                    ${order.total?.toFixed(2)}
                  </td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground whitespace-nowrap">
                    {moment(order.created_date).format("MMM D, h:mm A")}
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <button
                      onClick={() => handleDelete(order.id)}
                      disabled={deleting === order.id}
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
    </PullToRefresh>
  );
}