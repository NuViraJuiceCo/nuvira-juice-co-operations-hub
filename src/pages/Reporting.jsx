import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { DollarSign, ShoppingCart, TrendingUp, Receipt, Tag, RotateCcw, Download } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import StatCard from "../components/shared/StatCard";
import RevenueChart from "../components/reporting/RevenueChart";
import ChannelChart from "../components/reporting/ChannelChart";
import moment from "moment";

export default function Reporting() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(moment().subtract(30, "days").format("YYYY-MM-DD"));
  const [dateTo, setDateTo] = useState(moment().format("YYYY-MM-DD"));
  const [channelFilter, setChannelFilter] = useState("all");

  useEffect(() => {
    async function load() {
      const data = await base44.entities.Order.list("-created_date", 500);
      setOrders(data);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = orders.filter((o) => {
    const matchChannel = channelFilter === "all" || o.channel === channelFilter;
    const orderDate = moment(o.created_date).format("YYYY-MM-DD");
    const matchDate = orderDate >= dateFrom && orderDate <= dateTo;
    return matchChannel && matchDate;
  });

  const totalRevenue = filtered.reduce((s, o) => s + (o.total || 0), 0);
  const totalTax = filtered.reduce((s, o) => s + (o.tax || 0), 0);
  const totalDiscount = filtered.reduce((s, o) => s + (o.discount || 0), 0);
  const avgOrder = filtered.length > 0 ? totalRevenue / filtered.length : 0;

  const exportCSV = () => {
    const headers = "Metric,Value\n";
    const rows = [
      `Total Revenue,$${totalRevenue.toFixed(2)}`,
      `Orders,${filtered.length}`,
      `Average Order,$${avgOrder.toFixed(2)}`,
      `Tax Collected,$${totalTax.toFixed(2)}`,
      `Discounts,$${totalDiscount.toFixed(2)}`,
    ].join("\n");
    const blob = new Blob([headers + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nuvira-report.csv";
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Reporting</h1>
          <p className="text-muted-foreground mt-1">Financial summaries and operational analytics</p>
        </div>
        <Button onClick={exportCSV} className="gap-2">
          <Download className="h-4 w-4" /> Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">From</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-lg bg-background"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">To</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-1.5 text-sm border border-border rounded-lg bg-background"
          />
        </div>
        <Select value={channelFilter} onValueChange={setChannelFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All Channels" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Channels</SelectItem>
            <SelectItem value="Shopify Web Store">Shopify Web Store</SelectItem>
            <SelectItem value="Instagram">Instagram</SelectItem>
            <SelectItem value="NuVira Juice App">NuVira Juice App</SelectItem>
            <SelectItem value="Facebook">Facebook</SelectItem>
            <SelectItem value="Event Order">Event Order</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label="Total Revenue" value={`$${totalRevenue.toFixed(2)}`} icon={DollarSign} />
        <StatCard label="Orders" value={filtered.length} icon={ShoppingCart} />
        <StatCard label="Avg Order" value={`$${avgOrder.toFixed(2)}`} icon={TrendingUp} />
        <StatCard label="Tax Collected" value={`$${totalTax.toFixed(2)}`} icon={Receipt} />
        <StatCard label="Discounts" value={`$${totalDiscount.toFixed(2)}`} icon={Tag} />
        <StatCard label="Refunds" value={0} icon={RotateCcw} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RevenueChart orders={filtered} />
        <ChannelChart orders={filtered} />
      </div>
    </div>
  );
}