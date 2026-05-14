import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { getTodayDateString } from "@/lib/timezoneUtils";
import AdminGuide from "../components/shared/AdminGuide";
import { Trash2, Edit2, Package } from "lucide-react";
import { SelectContent, SelectItem } from "@/components/ui/select";
import SelectMobile from "../components/SelectMobile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import StatusBadge from "../components/shared/StatusBadge";
import PullToRefresh from "../components/shared/PullToRefresh";
import moment from "moment";
import { resolveDeliveryAddress } from "@/lib/resolveDeliveryAddress";

export default function Fulfillment() {
  const [tasks, setTasks] = useState([]);
  const [orders, setOrders] = useState([]);
  const [manualBatches, setManualBatches] = useState([]);
  const [internalFilter, setInternalFilter] = useState('active'); // 'active' | 'history' | 'all'
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const [editDriver, setEditDriver] = useState("");
  const [savingDriver, setSavingDriver] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [view, setView] = useState("orders"); // "orders" | "tasks" | "internal"

  // Multi-guard exclusion: never show stale/canceled/refunded orders even if canonical fields are wrong
  const isOrderProduction = (o) => {
    if (!o) return false;
    const tags = o.tags || [];
    if (tags.includes('refunded') || tags.includes('excluded') || tags.includes('do_not_sync') || tags.includes('not_for_production')) return false;
    if (o.sync_status === 'do_not_sync') return false;
    if (o.fulfillment_status === 'cancelled' || o.fulfillment_status === 'canceled') return false;
    const deadStatuses = ['fulfilled', 'canceled', 'refunded', 'canceled', 'excluded'];
    if (deadStatuses.includes(o.production_status)) return false;
    if (o.data_quality_status === 'quarantined') return false;
    return true;
  };

  const handleRefresh = async () => {
    const [taskData, orderData, batchData] = await Promise.all([
      base44.entities.FulfillmentTask.list("-scheduled_date", 100),
      base44.entities.ShopifyOrder.filter({ payment_status: "paid" }, "-created_date", 200),
      base44.entities.ManualProductionBatch.list("-production_date", 100),
    ]);
    setTasks(taskData || []);
    setOrders((orderData || []).filter(isOrderProduction));
    setManualBatches((batchData || []).filter(b => b.status !== 'cancelled'));
  };

  useEffect(() => {
    async function load() {
      const [taskData, orderData, batchData] = await Promise.all([
        base44.entities.FulfillmentTask.list("-scheduled_date", 100),
        base44.entities.ShopifyOrder.filter({ payment_status: "paid" }, "-created_date", 200),
        base44.entities.ManualProductionBatch.list("-production_date", 100),
      ]);
      setTasks(taskData || []);
      setOrders((orderData || []).filter(isOrderProduction));
      setManualBatches(batchData || []);
      setLoading(false);
    }
    load();
  }, []);

  const handleDelete = async (id) => {
    setDeleting(id);
    try {
      await base44.entities.FulfillmentTask.delete(id);
      setTasks(tasks.filter(t => t.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selected.size} task(s)?`)) return;
    setDeleting(true);
    try {
      await Promise.all(Array.from(selected).map(id => base44.entities.FulfillmentTask.delete(id)));
      setTasks(tasks.filter(t => !selected.has(t.id)));
      setSelected(new Set());
    } finally {
      setDeleting(false);
    }
  };

  const handleEditDriver = (task) => {
    setEditingTask(task);
    setEditDriver(task.assigned_driver || "");
  };

  const handleSaveDriver = async () => {
    if (!editingTask) return;
    setSavingDriver(true);
    setSaveError("");
    try {
      await base44.entities.FulfillmentTask.update(editingTask.id, {
        assigned_driver: editDriver || null,
        status: editDriver ? "Scheduled" : "Unassigned",
      });
      setTasks(
        tasks.map((t) =>
          t.id === editingTask.id
            ? { 
                ...t, 
                assigned_driver: editDriver || null,
                status: editDriver ? "Scheduled" : "Unassigned",
              }
            : t
        )
      );
      setEditingTask(null);
      setEditDriver("");
    } catch (error) {
      console.error("Failed to update driver:", error);
      setSaveError("Failed to save driver assignment. Please try again.");
    } finally {
      setSavingDriver(false);
    }
  };

  const toggleSelect = (id) => {
    const newSelected = new Set(selected);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelected(newSelected);
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(t => t.id)));
    }
  };

  const filtered = tasks.filter(
    (t) => statusFilter === "all" || t.status === statusFilter
  );

  const today = getTodayDateString();
  const todayTasks = tasks.filter((t) => t.scheduled_date === today).length;
  const unassigned = tasks.filter((t) => t.status === "Unassigned").length;

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

        {/* View Toggle */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setView("orders")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${view === "orders" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}
          >
            Orders ({orders.length})
          </button>
          <button
            onClick={() => setView("tasks")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${view === "tasks" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}
          >
            Fulfillment Tasks ({tasks.length})
          </button>
          <button
            onClick={() => setView("internal")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${view === "internal" ? "bg-purple-700 text-white" : "bg-purple-100 text-purple-800"}`}
          >
            Internal Batches ({manualBatches.length})
          </button>
        </div>

        {/* Orders View */}
        {view === "orders" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{orders.length} paid orders · not yet fulfilled</p>
            {orders.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">No paid orders found.</div>
            ) : (
              orders.map(order => (
                <div key={order.id} className="bg-card border border-border rounded-xl p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-foreground">{order.shopify_order_number}</p>
                      <p className="text-sm text-muted-foreground">{order.customer_name} · {order.customer_email}</p>
                    </div>
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap ${
                      order.production_status === 'new' ? 'bg-blue-50 text-blue-700' :
                      order.production_status === 'awaiting_production' ? 'bg-amber-50 text-amber-700' :
                      'bg-green-50 text-green-700'
                    }`}>{order.production_status?.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span><span className="font-medium text-foreground">Total:</span> {
                      (order.order_type === 'subscription' || order.source_type === 'subscription_fulfillment' || order.fulfillment_mode === 'multi_delivery')
                        ? '$144/mo'
                        : `$${(order.total_price || 0).toFixed(2)}`
                    }</span>
                    <span><span className="font-medium text-foreground">Payment:</span> {order.payment_status}</span>
                    <span><span className="font-medium text-foreground">Delivery:</span> {order.requested_delivery_date || order.assigned_delivery_date || '—'}</span>
                    <span><span className="font-medium text-foreground">Method:</span> {order.fulfillment_mode === 'multi_delivery' ? `${order.fulfillments?.length || 4} weekly deliveries` : (order.fulfillment_method || '—')}</span>
                  </div>
                  {(order.order_type === 'subscription' || order.fulfillment_mode === 'multi_delivery') && order.fulfillments?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {order.fulfillments.map((f, i) => (
                        <span key={i} className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded px-2 py-0.5">
                          #{f.fulfillment_number} · {f.delivery_date}
                        </span>
                      ))}
                    </div>
                  )}
                  {(() => {
                    const matchingTask = tasks.find(t => t.order_id === order.id);
                    const addr = resolveDeliveryAddress(order, matchingTask);
                    if (addr.isComplete) {
                      return <p className="text-xs text-muted-foreground">{addr.formatted}</p>;
                    }
                    if (order.fulfillment_method === 'delivery' && order.fulfillment_mode !== 'multi_delivery') {
                      return <p className="text-xs text-red-500 font-semibold">⚠ Missing delivery address</p>;
                    }
                    return null;
                  })()}
                  <div className="text-xs text-muted-foreground">
                    {(order.line_items || []).map((item, i) => (
                      <span key={i}>{item.quantity}× {item.title}{i < order.line_items.length - 1 ? ', ' : ''}</span>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Internal Batches View */}
        {view === "internal" && (
          <div className="space-y-3">
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-xs text-purple-800">
              <Package className="h-3.5 w-3.5 inline mr-1" />
              <strong>Internal production only.</strong> These batches do not have customer orders, Stripe charges, driver routing, or customer notifications. Manage them in Production Planning → Manual Batches.
            </div>
            {/* Filter tabs */}
            <div className="flex gap-1 border-b border-border">
              {[{k:'active',l:'Active'},{k:'history',l:'History'},{k:'all',l:'All'}].map(tab => {
                const count = tab.k === 'active'
                  ? manualBatches.filter(b => ['draft','active','included_in_planning','in_production'].includes(b.status)).length
                  : tab.k === 'history'
                  ? manualBatches.filter(b => ['produced','completed','cancelled'].includes(b.status)).length
                  : manualBatches.length;
                return (
                  <button key={tab.k} onClick={() => setInternalFilter(tab.k)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${internalFilter === tab.k ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                    {tab.l} {count > 0 && <span className="ml-1 text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{count}</span>}
                  </button>
                );
              })}
            </div>
            {(() => {
              const ACTIVE_S = new Set(['draft','active','included_in_planning','in_production']);
              const TERMINAL_S = new Set(['produced','completed','cancelled']);
              const filtered = manualBatches.filter(b =>
                internalFilter === 'active' ? ACTIVE_S.has(b.status) :
                internalFilter === 'history' ? TERMINAL_S.has(b.status) : true
              );
              if (filtered.length === 0) return <div className="text-center py-10 text-muted-foreground">No batches in this view.</div>;
              return filtered.map(b => (
                <div key={b.id} className="bg-card border border-purple-200 rounded-xl p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full">INTERNAL</span>
                        <p className="font-semibold text-foreground">{b.title}</p>
                      </div>
                      {b.purpose && <p className="text-xs text-muted-foreground mt-0.5">{b.purpose}</p>}
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${
                      b.status === 'active' ? 'bg-green-100 text-green-800' :
                      b.status === 'produced' ? 'bg-blue-100 text-blue-800' :
                      'bg-gray-100 text-gray-700'
                    }`}>{(b.status || '').replace(/_/g, ' ').toUpperCase()}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span><span className="font-medium text-foreground">Production:</span> {b.production_date}</span>
                    {b.use_date && <span><span className="font-medium text-foreground">Use/Deliver:</span> {b.use_date}</span>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(b.items || []).map((item, i) => (
                      <span key={i} className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded font-medium">
                        {item.quantity}× {item.product_name}
                      </span>
                    ))}
                  </div>
                  {b.notes && <p className="text-xs text-muted-foreground italic">{b.notes}</p>}
                  <p className="text-[10px] text-muted-foreground">No driver routing · No customer notification · No payment</p>
                </div>
              ));
            })()}
          </div>
        )}

        {/* Tasks View */}
        {view === "tasks" && <>
        <AdminGuide
          title="Admin Guide — Fulfillment Queue"
          steps={[
            "Fulfillment tasks represent individual delivery or pickup jobs that need to be completed.",
            "Tasks are created from confirmed orders and assigned to drivers or pickup slots.",
            "Update task status through: Unassigned → Scheduled → Packed → In Transit → Completed.",
            "Assign a driver to each task so the Driver Portal shows the correct delivery queue.",
          ]}
          tips={[
            "Use the status filter to focus on Unassigned tasks that still need a driver.",
            "The Driver Portal is what drivers use on their phones — tasks need to be assigned and active there.",
            "Today's task count in the subtitle helps you quickly see today's workload.",
          ]}
        />
        
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
           <div>
             <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Fulfillment Queue</h1>
             <p className="text-muted-foreground mt-1">
               {todayTasks} tasks today · {unassigned} unassigned
             </p>
           </div>
           <SelectMobile value={statusFilter} onValueChange={setStatusFilter} placeholder="All Statuses" triggerClassName="w-full sm:w-44">
             <SelectContent>
               <SelectItem value="all">All Statuses</SelectItem>
               <SelectItem value="Unassigned">Unassigned</SelectItem>
               <SelectItem value="Scheduled">Scheduled</SelectItem>
               <SelectItem value="Packed">Packed</SelectItem>
               <SelectItem value="In Transit">In Transit</SelectItem>
               <SelectItem value="Completed">Completed</SelectItem>
             </SelectContent>
           </SelectMobile>
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

        {/* Desktop Table — ONLY 768px+ (HIDDEN on mobile) */}
        <div className="hidden sm:block bg-card border border-border rounded-xl overflow-hidden" style={{display: 'none'}}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 sm:px-5 py-3 text-left w-10">
                    <input
                      type="checkbox"
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onChange={toggleSelectAll}
                      className="cursor-pointer"
                    />
                  </th>
                  <th className="px-3 sm:px-5 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Customer</th>
                  <th className="px-3 sm:px-5 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Fulfillment</th>
                  <th className="hidden lg:table-cell px-3 sm:px-5 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Items</th>
                  <th className="hidden md:table-cell px-3 sm:px-5 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Type</th>
                  <th className="px-3 sm:px-5 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="hidden lg:table-cell px-3 sm:px-5 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Driver</th>
                  <th className="px-3 sm:px-5 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider w-20">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((task) => (
                    <tr key={task.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="px-3 sm:px-5 py-3.5 w-10">
                        <input
                          type="checkbox"
                          checked={selected.has(task.id)}
                          onChange={() => toggleSelect(task.id)}
                          className="cursor-pointer"
                        />
                      </td>
                      <td className="px-3 sm:px-5 py-3.5">
                        <p className="text-sm font-medium text-foreground">{task.customer_name}</p>
                        {task.address && <p className="text-xs text-muted-foreground truncate">{task.address}</p>}
                      </td>
                      <td className="px-3 sm:px-5 py-3.5 text-sm font-medium text-primary whitespace-nowrap">
                        {moment(task.scheduled_date).format("MMM D")}
                      </td>
                      <td className="hidden lg:table-cell px-3 sm:px-5 py-3.5 text-sm text-muted-foreground truncate">{task.items_summary || '—'}</td>
                      <td className="hidden md:table-cell px-3 sm:px-5 py-3.5 text-sm text-muted-foreground">{task.fulfillment_type || '—'}</td>
                      <td className="px-3 sm:px-5 py-3.5"><StatusBadge status={task.status} /></td>
                      <td className="hidden lg:table-cell px-3 sm:px-5 py-3.5 text-sm">
                        <button
                          onClick={() => handleEditDriver(task)}
                          className="text-primary hover:text-primary/80 hover:underline"
                        >
                          {task.assigned_driver || 'Unassigned'}
                        </button>
                      </td>
                      <td className="px-3 sm:px-5 py-3.5 text-center">
                        <div className="flex gap-2 justify-center">
                          <button
                            onClick={() => handleEditDriver(task)}
                            className="text-blue-600 hover:text-blue-700"
                            title="Assign driver"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(task.id)}
                            disabled={deleting === task.id}
                            className="text-red-600 hover:text-red-700 disabled:opacity-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mobile Cards — ONLY LAYOUT <768px (FORCED) */}
        <div className="sm:hidden space-y-3 w-full" style={{display: 'block'}}>
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No fulfillment tasks match your filter.</p>
            </div>
          ) : (
            filtered.map((task) => (
              <div key={task.id} className="bg-card border border-border rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground">{task.customer_name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{task.address || 'No address'}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={selected.has(task.id)}
                    onChange={() => toggleSelect(task.id)}
                    className="cursor-pointer mt-1"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Date</p>
                    <p className="font-medium text-primary">{moment(task.scheduled_date).format("MMM D")}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Type</p>
                    <p className="text-sm">{task.fulfillment_type || '—'}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Items</p>
                    <p className="text-xs text-foreground line-clamp-2">{task.items_summary || '—'}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground mb-1">Status</p>
                    <StatusBadge status={task.status} />
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground mb-2">Driver</p>
                    <button
                      onClick={() => handleEditDriver(task)}
                      className="text-xs px-3 py-1.5 w-full bg-blue-50 text-blue-700 rounded hover:bg-blue-100 transition-colors"
                    >
                      {task.assigned_driver || 'Assign Driver'}
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(task.id)}
                  disabled={deleting === task.id}
                  className="w-full text-xs px-3 py-1.5 text-red-600 border border-red-200 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  {deleting === task.id ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            ))
          )}
        </div>

        </>}

        {/* Edit Driver Modal */}
        <Dialog open={!!editingTask} onOpenChange={() => setEditingTask(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Assign Driver</DialogTitle>
            </DialogHeader>
            {editingTask && (
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Customer</p>
                  <p className="font-medium">{editingTask.customer_name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Scheduled Date</p>
                  <p className="font-medium">
                    {moment(editingTask.scheduled_date).format("MMM D, YYYY")}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Items</p>
                  <p className="text-sm">{editingTask.items_summary}</p>
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Driver Name</label>
                  <Input
                    value={editDriver}
                    onChange={(e) => setEditDriver(e.target.value)}
                    placeholder="Enter driver name"
                    className="w-full"
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              {saveError && <p className="text-sm text-red-600 col-span-2">{saveError}</p>}
              <Button variant="outline" onClick={() => setEditingTask(null)} disabled={savingDriver}>
                Cancel
              </Button>
              <Button onClick={handleSaveDriver} disabled={savingDriver}>
                {savingDriver ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PullToRefresh>
  );
}