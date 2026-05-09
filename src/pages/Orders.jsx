import React, { useState, useEffect } from "react";
import OrderEditForm from "../components/orders/OrderEditForm";
import { base44 } from "@/api/base44Client";
import { Search, Download, Archive, Edit2, RefreshCw, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SelectContent, SelectItem } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import StatusBadge from "../components/shared/StatusBadge";
import AdminGuide from "../components/shared/AdminGuide";
import BulkActionsBar from "../components/shared/BulkActionsBar";
import ColumnSorter from "../components/shared/ColumnSorter";
import PullToRefresh from "../components/shared/PullToRefresh";
import SelectMobile from "../components/SelectMobile";
import { getDisplayPaymentStatus } from "../lib/paymentStatusHelper";
import moment from "moment";

// Returns a display-friendly price string for subscription vs one-time orders
function getOrderTotalDisplay(order) {
  const isSubscription = order.order_type === 'subscription' || order.source_type === 'subscription_fulfillment' || order.fulfillment_mode === 'multi_delivery';
  if (isSubscription) {
    const planName = order.customer_notes?.match(/^([^|—]+)/)?.[1]?.trim() || order.source_channel === 'subscription' ? 'Subscription' : null;
    return planName ? `${planName} · $144/mo` : '$144/mo';
  }
  return `$${(order.total_price || 0).toFixed(2)}`;
}

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
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

  const handleRecalculateBatches = async () => {
   setSyncing(true);
   try {
     await base44.functions.invoke('recalculateProductionBatches', {});
     await new Promise(resolve => setTimeout(resolve, 500));
     alert('Production batches recalculated successfully');
   } catch (error) {
     console.error('Recalculation failed:', error.message);
     alert('Recalculation failed: ' + error.message);
   } finally {
     setSyncing(false);
   }
  };

  const handleSaveEdit = async () => {
    await handleRefresh();
    setEditingOrder(null);
  };

  const CANCELED_STATUSES = ["canceled", "cancelled", "refunded"];
  const INACTIVE_PAYMENT_STATUSES = ["refunded", "canceled", "cancelled"];
  const EXCLUDED_TAGS = ["test_order", "archived", "excluded", "duplicate", "do_not_sync", "not_for_production", "internal_test_owner_override"];
  const INACTIVE_FULFILLMENT_STATUSES = ["cancelled", "canceled", "completed", "archived"];

  const isActiveOrder = (o) => {
    if (CANCELED_STATUSES.includes(o.production_status)) return false;
    if (INACTIVE_PAYMENT_STATUSES.includes(o.payment_status)) return false;
    if (INACTIVE_FULFILLMENT_STATUSES.includes(o.fulfillment_status)) return false;
    if (o.sync_status === "do_not_sync") return false;
    if (o.data_quality_status === "quarantined") return false;
    if (o.do_not_recover === true) return false;
    if (Array.isArray(o.tags) && o.tags.some(t => EXCLUDED_TAGS.includes(t))) return false;
    return true;
  };

  const filtered = orders.filter((o) => {
    if (!o) return false;
    const matchSearch =
      !search ||
      (o.shopify_order_number && o.shopify_order_number.toLowerCase().includes(search.toLowerCase())) ||
      (o.customer_email && o.customer_email.toLowerCase().includes(search.toLowerCase()));

    // "active" tab hides canceled/quarantined/do_not_recover orders
    // "canceled" tab shows only canceled/refunded/quarantined
    // "all" tab shows everything
    let matchStatus;
    if (statusFilter === "active") {
      matchStatus = isActiveOrder(o);
    } else if (statusFilter === "canceled") {
      matchStatus = !isActiveOrder(o);
    } else if (statusFilter === "all") {
      matchStatus = true;
    } else {
      matchStatus = o.production_status === statusFilter;
    }

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

  const handleArchive = async (order) => {
    if (!window.confirm(`Archive order ${order.shopify_order_number}? This sets it to canceled/excluded and logs the action. It will NOT be hard-deleted.`)) return;
    setDeleting(order.id);
    const now = new Date().toISOString();
    const archiveData = {
      production_status: 'canceled',
      fulfillment_status: 'cancelled',
      sync_status: 'do_not_sync',
      data_quality_status: 'quarantined',
      manual_override: true,
      manual_override_at: now,
      manual_override_by: 'admin-ui',
      tags: [...new Set([...(order.tags || []), 'archived', 'excluded', 'do_not_sync'])],
      internal_notes: (order.internal_notes ? order.internal_notes + '\n' : '') + `[Archived by admin on ${now}]`,
    };
    try {
      await base44.entities.ShopifyOrder.update(order.id, archiveData);
      await base44.entities.RepairAuditLog.create({
        timestamp: now,
        executed_by: 'admin-ui',
        repair_function: 'cleanupOrphanedAndDuplicateRecords',
        action: 'cleanup',
        records_affected: 1,
        reason: `Admin archived order ${order.shopify_order_number} from Orders UI`,
        changes: { order_id: order.id, order_number: order.shopify_order_number, previous_status: order.production_status, new_status: 'canceled' },
      });
      setOrders(orders.map(o => o.id === order.id ? { ...o, ...archiveData } : o));
    } finally {
      setDeleting(null);
    }
  };

  const handleBulkArchive = async () => {
    if (!window.confirm(`Archive ${selected.size} order(s)? They will be set to canceled/excluded with an audit log entry. No hard deletes.`)) return;
    setDeleting(true);
    const now = new Date().toISOString();
    try {
      const selectedOrders = orders.filter(o => selected.has(o.id));
      await Promise.all(selectedOrders.map(async (order) => {
        const archiveData = {
          production_status: 'canceled',
          fulfillment_status: 'cancelled',
          sync_status: 'do_not_sync',
          data_quality_status: 'quarantined',
          manual_override: true,
          manual_override_at: now,
          manual_override_by: 'admin-ui',
          tags: [...new Set([...(order.tags || []), 'archived', 'excluded', 'do_not_sync'])],
          internal_notes: (order.internal_notes ? order.internal_notes + '\n' : '') + `[Bulk archived by admin on ${now}]`,
        };
        await base44.entities.ShopifyOrder.update(order.id, archiveData);
        await base44.entities.RepairAuditLog.create({
          timestamp: now,
          executed_by: 'admin-ui',
          repair_function: 'cleanupOrphanedAndDuplicateRecords',
          action: 'cleanup',
          records_affected: 1,
          reason: `Admin bulk-archived order ${order.shopify_order_number} from Orders UI`,
          changes: { order_id: order.id, order_number: order.shopify_order_number, previous_status: order.production_status, new_status: 'canceled' },
        });
      }));
      setOrders(orders.map(o => selected.has(o.id) ? { ...o, production_status: 'canceled', sync_status: 'do_not_sync', data_quality_status: 'quarantined' } : o));
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
         <div>
           <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Orders</h1>
           <p className="text-muted-foreground mt-1">{orders.length} synced orders</p>
         </div>
         <div className="flex flex-wrap gap-2">
           <Button variant="outline" onClick={handleSync} disabled={syncing} className="gap-2 flex-1 sm:flex-none">
             <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
             {syncing ? 'Syncing...' : 'Sync'}
           </Button>
           <Button variant="outline" onClick={handleRecalculateBatches} disabled={syncing} className="gap-2 flex-1 sm:flex-none text-xs sm:text-sm">
             <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
             <span className="hidden sm:inline">{syncing ? 'Recalc...' : 'Recalc Batches'}</span>
             <span className="sm:hidden">{syncing ? 'Recalc...' : 'Recalc'}</span>
           </Button>
           <Button variant="outline" onClick={exportCSV} className="gap-2 flex-1 sm:flex-none">
             <Download className="h-4 w-4" /> Export
           </Button>
         </div>
       </div>

      {/* Filters */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search orders..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 w-full"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-3">
          <SelectMobile value={statusFilter} onValueChange={setStatusFilter} placeholder="Active Orders" triggerClassName="w-full">
            <SelectContent>
              <SelectItem value="active">Active Orders</SelectItem>
              <SelectItem value="all">All Orders</SelectItem>
              <SelectItem value="canceled">Canceled / Refunded</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="awaiting_production">Awaiting Production</SelectItem>
              <SelectItem value="in_production">In Production</SelectItem>
              <SelectItem value="bottled">Bottled</SelectItem>
              <SelectItem value="labeled">Labeled</SelectItem>
              <SelectItem value="packed">Packed</SelectItem>
              <SelectItem value="fulfilled">Fulfilled</SelectItem>
            </SelectContent>
          </SelectMobile>
          <SelectMobile value={channelFilter} onValueChange={setChannelFilter} placeholder="All Channels" triggerClassName="w-full">
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
      </div>

      {/* Bulk Actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <span className="text-sm font-medium text-blue-900">{selected.size} selected</span>
          <button onClick={handleBulkArchive} disabled={deleting} className="text-sm px-3 py-1.5 rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 flex items-center gap-1.5">
            <Archive className="h-3.5 w-3.5" />
            {deleting ? "Archiving..." : "Archive Selected"}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-sm px-3 py-1.5 rounded border border-blue-200 text-blue-700 hover:bg-blue-100">
            Cancel
          </button>
        </div>
      )}


      {/* Desktop Table — visible on sm+ screens ONLY (hidden on mobile) */}
      <div className="hidden sm:block bg-card border border-border rounded-xl overflow-hidden" style={{display: 'none'}}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
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
                { label: "Name", col: "customer_name" },
                { label: "Email", col: "customer_email" },
                { label: "Channel", col: "source_channel" },
                { label: "Status", col: "production_status" },
                { label: "Payment", col: "payment_status" },
                { label: "Fulfillment", col: "fulfillment_method" },
                { label: "Total", col: "total_price" },
                { label: "Date", col: "created_date" },
                ].map((h) => (
                <th key={h.col} className="px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:bg-muted/50 text-left" onClick={() => handleSort(h.col)}>
                 <ColumnSorter column={h.label} sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                </th>
                ))}
                <th className="px-5 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider w-20">Action</th>
                  </tr>
            </thead>
            <tbody>
              {sorted.map((order) => [
                  <tr key={`${order.id}-main`} className="border-b border-border/50 hover:bg-muted/30 transition-colors min-h-touch cursor-pointer" onClick={() => setExpandedOrderId(expandedOrderId === order.id ? null : order.id)}>
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
                      <p className="text-sm font-medium text-foreground">{order.customer_name || '—'}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm text-muted-foreground">{order.customer_email}</p>
                      <p className="text-xs text-muted-foreground">{order.customer_phone}</p>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-muted-foreground">{order.source_channel}</td>
                    <td className="px-5 py-3.5"><StatusBadge status={order.production_status} /></td>
                    <td className="px-5 py-3.5"><StatusBadge status={getDisplayPaymentStatus(order)} /></td>
                    <td className="px-5 py-3.5 text-sm text-muted-foreground">
                      {order.fulfillment_method}{order.address_line1 ? ` · ${order.address_line1.substring(0, 20)}...` : (order.delivery_address ? ` · ${order.delivery_address.substring(0, 20)}...` : " · -")}
                    </td>
                    <td className="px-5 py-3.5 text-sm font-semibold text-foreground text-right">
                     {getOrderTotalDisplay(order)}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-muted-foreground whitespace-nowrap">
                      {moment(order.customer_order_date).utcOffset(-5).format("MMM D, h:mm A")} CT
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
                         onClick={() => handleArchive(order)}
                         disabled={deleting === order.id}
                         className="text-amber-600 hover:text-amber-700 disabled:opacity-50"
                         title="Archive order (sets to canceled with audit log)"
                       >
                         <Archive className="h-4 w-4" />
                       </button>
                      </div>
                    </td>
                  </tr>,
                  expandedOrderId === order.id && order.line_items && order.line_items.length > 0 && (
                    <tr key={`${order.id}-expanded`} className="border-b border-border/50 last:border-0 bg-muted/20">
                      <td colSpan="11" className="px-5 py-4">
                        <div className="space-y-4">
                          {order.address_line1 && (
                            <div>
                              <p className="text-sm font-semibold text-foreground mb-2">Delivery Address</p>
                              <p className="text-xs text-muted-foreground">
                                {order.address_line1}{order.address_line2 ? `, ${order.address_line2}` : ''}<br />
                                {order.address_city}, {order.address_state} {order.address_postal_code}
                              </p>
                            </div>
                          )}
                          <div>
                            <p className="text-sm font-semibold text-foreground mb-3">
                              {order.fulfillments && order.fulfillments.length > 0 ? 'Subscription Fulfillments' : 'Products in this order'}
                            </p>
                            {order.fulfillments && order.fulfillments.length > 0 ? (
                              <div className="space-y-2">
                                {order.fulfillments.map((f, fi) => (
                                  <div key={fi} className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                                    <p className="text-xs font-semibold text-blue-700 mb-2">Week {f.fulfillment_number} · {f.delivery_date}</p>
                                    <div className="space-y-1">
                                      {f.items?.map((item, ii) => (
                                        <p key={ii} className="text-xs text-blue-600">{item.title} × {item.quantity}</p>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {order.line_items.filter(item => !['delivery fee','delivery charge','shipping fee','shipping charge','tip','service fee'].some(kw => (item.title||'').toLowerCase().includes(kw))).map((item, idx) => (
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
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                    ),
                    ].filter(Boolean))}
                    </tbody>
          </table>
          </div>
          </div>

          {/* Mobile Cards — ONLY LAYOUT BELOW 768px */}
          <div className="sm:hidden space-y-3 w-full" style={{display: 'block'}}>
          {sorted.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No orders match your filters.</p>
          </div>
          ) : (
          sorted.map((order) => (
            <div
              key={order.id}
              className="bg-card border border-border rounded-lg p-4 space-y-3 cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setExpandedOrderId(expandedOrderId === order.id ? null : order.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-primary text-sm">{order.shopify_order_number}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{order.customer_name}</p>
                  <p className="text-xs text-muted-foreground truncate">{order.customer_email}</p>
                </div>
                <input
                  type="checkbox"
                  checked={selected.has(order.id)}
                  onChange={(e) => { e.stopPropagation(); toggleSelect(order.id); }}
                  className="cursor-pointer flex-shrink-0 mt-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-muted-foreground">Channel</p>
                <p className="font-medium">{order.source_channel}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Payment</p>
                <StatusBadge status={getDisplayPaymentStatus(order)} />
                </div>
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <StatusBadge status={order.production_status} />
                </div>
                <div>
                  <p className="text-muted-foreground">Total</p>
                  <p className="font-semibold">{getOrderTotalDisplay(order)}</p>
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                {moment(order.customer_order_date).utcOffset(-5).format("MMM D, h:mm A")} CT
              </div>

              <div className="flex gap-2 pt-2" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setEditingOrder(order)}
                  className="flex-1 px-3 py-2 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100 transition-colors"
                >
                  Edit
                </button>
                <button
                   onClick={() => handleArchive(order)}
                   disabled={deleting === order.id}
                   className="flex-1 px-3 py-2 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                 >
                   <Archive className="h-3 w-3" />
                   {deleting === order.id ? 'Archiving...' : 'Archive'}
                 </button>
              </div>

              {/* Expandable Items */}
              {expandedOrderId === order.id && (
                <div className="pt-3 border-t border-border space-y-3">
                  {order.address_line1 && (
                    <div>
                      <p className="text-xs font-semibold text-foreground mb-1">Delivery Address</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {order.address_line1}{order.address_line2 ? `, ${order.address_line2}` : ''}<br />
                        {order.address_city}, {order.address_state} {order.address_postal_code}
                      </p>
                    </div>
                  )}
                  {order.line_items && order.line_items.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-foreground mb-2">Items</p>
                      <div className="space-y-1">
                        {order.line_items.filter(item => !['delivery fee','delivery charge','shipping fee','shipping charge','tip','service fee'].some(kw => (item.title||'').toLowerCase().includes(kw))).map((item, idx) => (
                          <div key={idx} className="flex items-center justify-between bg-muted/20 rounded px-2 py-1.5">
                            <p className="text-xs font-medium text-foreground truncate flex-1">{item.title}</p>
                            <p className="text-xs text-muted-foreground ml-2 flex-shrink-0">×{item.quantity}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
          )}
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