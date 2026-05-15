import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Search, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import StatusBadge from "../components/shared/StatusBadge";
import { isPOSOrder } from "../lib/utils";
import moment from "moment";

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [view, setView] = useState("all"); // all, online, pos

  useEffect(() => {
    async function load() {
      try {
        const data = await base44.entities.ShopifyOrder.list("-created_date", 100);
        setOrders(data || []);
      } catch (err) {
        console.error('Orders load error:', err);
      }
      setLoading(false);
    }
    load();
  }, []);

  const handleRefresh = async () => {
    try {
      const data = await base44.entities.ShopifyOrder.list("-created_date", 100);
      setOrders(data || []);
    } catch (err) {
      console.error('Refresh error:', err);
    }
  };

  const filtered = orders.filter((o) => {
    if (!o) return false;
    const matchesSearch = !search ||
      (o.shopify_order_number && o.shopify_order_number.toLowerCase().includes(search.toLowerCase())) ||
      (o.customer_email && o.customer_email.toLowerCase().includes(search.toLowerCase()));
    
    if (!matchesSearch) return false;
    
    if (view === "pos") return isPOSOrder(o);
    if (view === "online") return !isPOSOrder(o);
    return true;
  });

  const posCount = orders.filter(o => isPOSOrder(o)).length;
  const onlineCount = orders.filter(o => !isPOSOrder(o)).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Orders</h1>
          <p className="text-muted-foreground mt-1">{orders.length} total orders</p>
        </div>
        <Button variant="outline" onClick={handleRefresh} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* View Tabs */}
      <div className="flex gap-2 border-b border-border">
        <button
          onClick={() => setView("all")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            view === "all"
              ? "text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          All Orders ({orders.length})
        </button>
        <button
          onClick={() => setView("online")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            view === "online"
              ? "text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Online ({onlineCount})
        </button>
        <button
          onClick={() => setView("pos")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            view === "pos"
              ? "text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          POS/Event Sales ({posCount})
        </button>
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search orders..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 w-full"
          />
        </div>
      </div>

      {/* Desktop Table */}
      <div className="hidden sm:block bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-5 py-3 text-left">Order ID</th>
                <th className="px-5 py-3 text-left">Type</th>
                <th className="px-5 py-3 text-left">Customer</th>
                <th className="px-5 py-3 text-left">Email</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-left">Total</th>
                <th className="px-5 py-3 text-left">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((order) => (
                <tr key={order.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-5 py-3.5 font-medium text-primary">{order.shopify_order_number || '—'}</td>
                  <td className="px-5 py-3.5">
                    {isPOSOrder(order) ? (
                      <Badge className="bg-orange-500/20 text-orange-700">POS/Event</Badge>
                    ) : (
                      <Badge variant="outline">Online</Badge>
                    )}
                  </td>
                  <td className="px-5 py-3.5">{order.customer_name || '—'}</td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">{order.customer_email || '—'}</td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={order.production_status} />
                  </td>
                  <td className="px-5 py-3.5 font-semibold text-right">${(order.total_price || 0).toFixed(2)}</td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">
                    {moment(order.created_date).format("MMM D, h:mm A")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Cards */}
      <div className="sm:hidden space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No orders match your search.</p>
          </div>
        ) : (
          filtered.map((order) => (
            <div key={order.id} className="bg-card border border-border rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-medium text-primary text-sm">{order.shopify_order_number || '—'}</p>
                {isPOSOrder(order) ? (
                  <Badge className="bg-orange-500/20 text-orange-700 text-xs">POS/Event</Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">Online</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{order.customer_name || '—'}</p>
              <p className="text-xs text-muted-foreground">{order.customer_email || '—'}</p>
              <div className="pt-2 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <StatusBadge status={order.production_status} />
                </div>
                <div>
                  <p className="text-muted-foreground">Total</p>
                  <p className="font-semibold">${(order.total_price || 0).toFixed(2)}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground pt-2">
                {moment(order.created_date).format("MMM D, h:mm A")}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}