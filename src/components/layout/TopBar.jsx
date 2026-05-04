import { useState, useEffect, useRef } from "react";
import { Bell, X, AlertTriangle, CheckCircle2, Clock, Info, ArrowLeft, Menu } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import moment from "moment";
import AdminProfileMenu from "./AdminProfileMenu";
import GlobalSearch from "@/components/search/GlobalSearch";

const alertIcon = { warning: AlertTriangle, success: CheckCircle2, info: Info, urgent: AlertTriangle };
const alertStyle = {
  warning: "bg-amber-50 border-amber-200 text-amber-800",
  urgent: "bg-red-50 border-red-200 text-red-800",
  success: "bg-emerald-50 border-emerald-200 text-emerald-800",
  info: "bg-blue-50 border-blue-200 text-blue-800",
};
const iconStyle = {
  warning: "text-amber-500",
  urgent: "text-red-500",
  success: "text-emerald-500",
  info: "text-blue-500",
};

export default function TopBar({ onMenuClick }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isRootPage = location.pathname === "/";
  const [alerts, setAlerts] = useState([]);
  const [showPanel, setShowPanel] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const panelRef = useRef(null);

  useEffect(() => {
    // Subscribe to real-time Order changes
    const unsubOrder = base44.entities.Order.subscribe((event) => {
      if (event.type === "create") {
        addAlert({
          id: `order-${event.id}-${Date.now()}`,
          type: "info",
          title: "New Order Received",
          message: `Order ${event.data?.order_id || event.id} from ${event.data?.customer_name || "a customer"} — $${(event.data?.total || 0).toFixed(2)}`,
          time: new Date(),
        });
      } else if (event.type === "update" && event.data?.status === "Cancelled") {
        addAlert({
          id: `order-cancel-${event.id}-${Date.now()}`,
          type: "urgent",
          title: "Order Cancelled",
          message: `Order ${event.data?.order_id || event.id} has been cancelled.`,
          time: new Date(),
        });
      }
    });

    // Subscribe to real-time ProductionBatch changes
    const unsubBatch = base44.entities.ProductionBatch.subscribe((event) => {
      if (event.type === "update" && event.data?.status === "Completed") {
        addAlert({
          id: `batch-${event.id}-${Date.now()}`,
          type: "success",
          title: "Production Batch Complete",
          message: `${event.data?.product_name || "Batch"} (${event.data?.batch_id || ""}) has been completed — ${event.data?.actual_units || event.data?.planned_units || 0} units.`,
          time: new Date(),
        });
      }
    });

    // Subscribe to FulfillmentTask changes
    const unsubFulfill = base44.entities.FulfillmentTask.subscribe((event) => {
      if (event.type === "create") {
        addAlert({
          id: `fulfill-${event.id}-${Date.now()}`,
          type: "info",
          title: "New Fulfillment Task",
          message: `${event.data?.fulfillment_type || "Task"} for ${event.data?.customer_name || "customer"} on ${event.data?.scheduled_date || "TBD"}.`,
          time: new Date(),
        });
      }
    });

    // Check inventory for low stock on mount
    base44.entities.InventoryItem.list("-updated_date", 100).then(items => {
      const low = items.filter(i => i.stock <= i.reorder_point);
      if (low.length > 0) {
        addAlert({
          id: `inventory-low-${Date.now()}`,
          type: "warning",
          title: `${low.length} Low Stock Alert${low.length > 1 ? "s" : ""}`,
          message: `${low.map(i => i.ingredient).join(", ")} need${low.length === 1 ? "s" : ""} reordering.`,
          time: new Date(),
        });
      }
    });

    // Check compliance overdue
    base44.entities.ComplianceDoc.list("-expiry_date", 50).then(docs => {
      const overdue = docs.filter(d => d.status === "Overdue" || d.status === "Expired");
      const dueSoon = docs.filter(d => d.status === "Due Soon");
      if (overdue.length > 0) {
        addAlert({
          id: `compliance-overdue-${Date.now()}`,
          type: "urgent",
          title: `${overdue.length} Compliance Item${overdue.length > 1 ? "s" : ""} Overdue`,
          message: overdue.map(d => d.name).join(", "),
          time: new Date(),
        });
      }
      if (dueSoon.length > 0) {
        addAlert({
          id: `compliance-soon-${Date.now()}`,
          type: "warning",
          title: `${dueSoon.length} Compliance Item${dueSoon.length > 1 ? "s" : ""} Due Soon`,
          message: dueSoon.map(d => d.name).join(", "),
          time: new Date(),
        });
      }
    });

    return () => {
      unsubOrder();
      unsubBatch();
      unsubFulfill();
    };
  }, []);

  // Close panel on outside click
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setShowPanel(false);
    };
    if (showPanel) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPanel]);

  const addAlert = (alert) => {
    setAlerts(prev => [alert, ...prev].slice(0, 50));
    setUnreadCount(prev => prev + 1);
  };

  const openPanel = () => {
    setShowPanel(v => !v);
    setUnreadCount(0);
  };

  const dismiss = (id) => setAlerts(prev => prev.filter(a => a.id !== id));
  const clearAll = () => setAlerts([]);

  return (
    <header className="sticky top-0 z-30 h-14 bg-background/95 backdrop-blur border-b border-border flex items-center px-3 gap-2">
      {/* Back button — mobile, non-root pages */}
      {!isRootPage ? (
        <button
          onClick={() => {
            if (window.history.length > 1) {
              navigate(-1);
            } else {
              navigate("/");
            }
          }}
          className="lg:hidden flex items-center justify-center h-12 w-12 min-h-touch min-w-touch rounded-xl hover:bg-muted active:bg-muted/80 transition-colors text-muted-foreground -ml-1"
          aria-label="Go back"
        >
          <ArrowLeft className="h-7 w-7" />
        </button>
      ) : (
        /* Desktop hamburger — hidden on mobile since bottom nav handles it */
        <button
          onClick={onMenuClick}
          className="hidden lg:flex items-center justify-center h-9 w-9 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}

      {/* Brand — mobile */}
      <span className="lg:hidden font-display font-bold text-primary text-lg">nuVira</span>

      {/* Global Search — desktop inline bar (hidden on mobile, handled by icon below) */}
      <GlobalSearch mobile={false} />

      <div className="flex-1" />

      {/* Mobile Search icon */}
      <div className="lg:hidden">
        <GlobalSearch mobile={true} />
      </div>

      {/* Alerts Bell */}
      <div className="relative" ref={panelRef}>
        <button
          onClick={openPanel}
          className="relative p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          aria-label="Alerts"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>

        {/* Alerts Panel */}
        {showPanel && (
          <div className="absolute right-0 top-10 w-80 sm:w-96 bg-card border border-border rounded-xl shadow-xl z-50 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="font-semibold text-foreground text-sm">Alerts & Notifications</h3>
              <div className="flex items-center gap-2">
                {alerts.length > 0 && (
                  <button onClick={clearAll} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                    Clear all
                  </button>
                )}
                <button onClick={() => setShowPanel(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1">
              {alerts.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <CheckCircle2 className="h-8 w-8 text-muted mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">All clear! No alerts.</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {alerts.map(alert => {
                    const Icon = alertIcon[alert.type] || Info;
                    return (
                      <div key={alert.id} className={`flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors`}>
                        <Icon className={`h-4 w-4 flex-shrink-0 mt-0.5 ${iconStyle[alert.type]}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">{alert.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{alert.message}</p>
                          <p className="text-[10px] text-muted-foreground/60 mt-1 flex items-center gap-1">
                            <Clock className="h-2.5 w-2.5" />{moment(alert.time).fromNow()}
                          </p>
                        </div>
                        <button onClick={() => dismiss(alert.id)} className="text-muted-foreground/50 hover:text-muted-foreground flex-shrink-0">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Admin profile menu */}
      <AdminProfileMenu onOpenAlerts={openPanel} />
    </header>
  );
}