import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { ShoppingCart, Factory, Truck, AlertTriangle, DollarSign, AlertCircle } from "lucide-react";
import StatCard from "../components/shared/StatCard";
import HeroBanner from "../components/dashboard/HeroBanner";
import RecentOrders from "../components/dashboard/RecentOrders";
import UpcomingProduction from "../components/dashboard/UpcomingProduction";
import moment from "moment";

export default function Dashboard() {
  const [orders, setOrders] = useState([]);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [orderData, batchData] = await Promise.all([
        base44.entities.Order.list("-created_date", 50),
        base44.entities.ProductionBatch.list("-production_date", 50),
      ]);
      setOrders(orderData);
      setBatches(batchData);
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

  const newOrders = orders.filter((o) => o.status === "New").length;
  const inProduction = orders.filter((o) => o.status === "In Production").length;
  const toFulfill = orders.filter((o) => !["Completed", "Cancelled"].includes(o.status)).length;
  const lowStock = batches.filter((b) => b.status === "Awaiting Ingredients").length;
  const revenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">
          Welcome back, there
        </h1>
        <p className="text-muted-foreground mt-1">
          Here's what's happening at NuVira today · {moment().format("dddd, MMMM D")}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label="New Orders" value={newOrders} icon={ShoppingCart} />
        <StatCard label="In Production" value={inProduction} icon={Factory} />
        <StatCard label="To Fulfill" value={toFulfill} icon={Truck} />
        <StatCard label="Low Stock" value={lowStock} icon={AlertTriangle} />
        <StatCard label="Revenue" value={`$${revenue.toFixed(2)}`} icon={DollarSign} />
        <StatCard label="Exceptions" value={0} icon={AlertCircle} />
      </div>

      {/* Hero Banner */}
      <HeroBanner />

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
  );
}