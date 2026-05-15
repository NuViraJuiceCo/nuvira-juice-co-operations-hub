import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { ShoppingCart, Factory, Truck, AlertTriangle, DollarSign, AlertCircle } from "lucide-react";
import StatCard from "../components/shared/StatCard";
import AdminGuide from "../components/shared/AdminGuide";
import HeroBanner from "../components/dashboard/HeroBanner";
import RecentOrders from "../components/dashboard/RecentOrders";
import UpcomingProduction from "../components/dashboard/UpcomingProduction";
import DashboardInsights from "../components/dashboard/DashboardInsights";
import DashboardWidgetSelector from "../components/dashboard/DashboardWidgetSelector";
import ProductionThroughputWidget from "../components/dashboard/ProductionThroughputWidget";
import ActiveOrderStatusWidget from "../components/dashboard/ActiveOrderStatusWidget";
import InventoryAlertsWidget from "../components/dashboard/InventoryAlertsWidget";
import POSMetricsCard from "../components/dashboard/POSMetricsCard";
import PullToRefresh from "../components/shared/PullToRefresh";
import SyncPanel from "../components/dashboard/SyncPanel";
import moment from "moment";

export default function Dashboard() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [batches, setBatches] = useState([]);
  const [items, setItems] = useState([]);
  const [exceptions, setExceptions] = useState(0);
  const [loading, setLoading] = useState(true);
  const [visibleWidgets, setVisibleWidgets] = useState(["production", "orders", "inventory"]);

  useEffect(() => {
    async function load() {
      const [orderData, batchData, inventoryData, reviewQueue] = await Promise.all([
        base44.entities.ShopifyOrder.list("-created_date", 50),
        base44.entities.ProductionBatch.list("-production_date", 50),
        base44.entities.InventoryItem.list("-updated_date", 100),
        base44.entities.OrderReviewQueue.filter({ status: "pending" }),
      ]);
      setOrders(orderData);
      setBatches(batchData);
      setItems(inventoryData);
      setExceptions(reviewQueue?.length || 0);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  // Exclude archived/refunded/canceled orders and test/quarantined records from operational metrics
  const EXCLUDED_TAGS = new Set(['refunded', 'excluded', 'do_not_sync', 'internal_test_owner_override', 'customer_confusion_duplicate_subscription']);
  const activeOrders = orders.filter(o =>
    (o.operational_visibility === 'active' || !o.operational_visibility) && // Default to active if not set
    (o.order_status !== 'refunded' && o.order_status !== 'canceled' && o.order_status !== 'archived') &&
    o.payment_status !== 'refunded' &&
    o.production_status !== 'canceled' &&
    o.production_status !== 'cancelled' &&
    o.data_quality_status !== 'quarantined' &&
    o.sync_status !== 'do_not_sync' &&
    !(Array.isArray(o.tags) && o.tags.some(t => EXCLUDED_TAGS.has(t)))
  );
  
  // Separate count for refunded/canceled orders (for optional display)
  const refundedOrders = orders.filter(o =>
    o.operational_visibility === 'archived' ||
    o.order_status === 'refunded' ||
    o.order_status === 'canceled'
  );
  const refundCount = refundedOrders.length;
  const refundValue = refundedOrders.reduce((sum, o) => sum + (o.total_price || 0), 0);
  const paidOrders = activeOrders.filter((o) => o.payment_status === "paid");
  const newOrders = paidOrders.filter((o) => o.production_status === "new" || o.production_status === "awaiting_production").length;
  const inProduction = paidOrders.filter((o) => o.production_status === "in_production").length;
  const toFulfill = paidOrders.filter((o) => !["fulfilled", "canceled", "refunded"].includes(o.production_status)).length;
  const lowStock = batches.filter((b) => b.status === "ready_for_production" || b.status === "planned").length;
  // Gross sales: sum of paid orders (fully refunded already excluded by activeOrders filter)
  const grossRevenue = paidOrders.reduce((sum, o) => sum + (o.total_price || 0), 0);
  // Subtract any partial refund amounts recorded on individual orders
  const partialRefunds = paidOrders.reduce((sum, o) => sum + (o.refund_amount || 0), 0);
  const revenue = grossRevenue - partialRefunds;

  const handleRefresh = async () => {
    const [orderData, batchData, inventoryData, reviewQueue] = await Promise.all([
      base44.entities.ShopifyOrder.list("-created_date", 50),
      base44.entities.ProductionBatch.list("-production_date", 50),
      base44.entities.InventoryItem.list("-updated_date", 100),
      base44.entities.OrderReviewQueue.filter({ status: "pending" }),
    ]);
    setOrders(orderData);
    setBatches(batchData);
    setItems(inventoryData);
    setExceptions(reviewQueue?.length || 0);
  };

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div className="space-y-6 p-4 sm:p-6 lg:p-8 pb-28 sm:pb-24 lg:pb-6 w-full overflow-x-hidden">
      <AdminGuide
        title="Admin Guide — Dashboard"
        steps={[
          "This page gives you a live overview of NuVira operations.",
          "KPI cards at the top show new orders, in-production batches, fulfillment tasks, low-stock alerts, and revenue.",
          "Use the widget toggles to show/hide the Production Throughput, Active Order Status, and Inventory Alerts charts.",
          "Data here updates automatically as you add orders, batches, and inventory across the hub.",
        ]}
        tips={[
          "Check this page at the start of each day for a quick health check.",
          "Low Stock and Exceptions cards will highlight items needing your attention.",
        ]}
      />
      {/* Header */}
      <div>
        <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">
          Welcome back, {user?.display_name || user?.full_name || "there"}
        </h1>
        <p className="text-muted-foreground mt-1">
          Here's what's happening at NuVira today · {moment().format("dddd, MMMM D")}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-4">
        <StatCard label="New Orders" value={newOrders} icon={ShoppingCart} variant={newOrders > 0 ? "warning" : "default"} />
        <StatCard label="In Production" value={inProduction} icon={Factory} variant="info" />
        <StatCard label="To Fulfill" value={toFulfill} icon={Truck} variant={toFulfill > 0 ? "warning" : "default"} />
        <StatCard label="Low Stock" value={lowStock} icon={AlertTriangle} variant={lowStock > 0 ? "danger" : "default"} />
        <StatCard label="Net Revenue" value={`$${revenue.toFixed(0)}`} icon={DollarSign} variant="success" subtitle="Paid · excl. refunds &amp; cancelled" />
        <StatCard label="Exceptions" value={exceptions} icon={AlertCircle} variant={exceptions > 0 ? "warning" : "default"} />
      </div>



      {/* Sync Panel */}
      <SyncPanel />

      {/* Widget Selector */}
      <DashboardWidgetSelector widgets={visibleWidgets} onToggle={(id) => {
        setVisibleWidgets(prev => 
          prev.includes(id) ? prev.filter(w => w !== id) : [...prev, id]
        );
      }} />

      {/* Widgets Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {visibleWidgets.includes("production") && <ProductionThroughputWidget batches={batches} />}
        {visibleWidgets.includes("orders") && <ActiveOrderStatusWidget orders={orders} />}
        {visibleWidgets.includes("inventory") && <InventoryAlertsWidget items={items} />}
      </div>

      {/* Insights Row — hide if widgets visible to avoid duplication */}
      {visibleWidgets.length === 0 && <DashboardInsights orders={orders} />}

      {/* Orders + Production */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <RecentOrders orders={orders.slice(0, 6)} />
        </div>
        <div>
          <UpcomingProduction batches={batches} />
        </div>
      </div>
    </div>
    </PullToRefresh>
  );
}