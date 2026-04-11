import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Search, Download } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import StatusBadge from "../components/shared/StatusBadge";
import moment from "moment";

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");

  useEffect(() => {
    async function load() {
      const data = await base44.entities.Order.list("-created_date", 100);
      setOrders(data);
      setLoading(false);
    }
    load();
  }, []);

  const filtered = orders.filter((o) => {
    const matchSearch =
      !search ||
      o.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
      o.order_id?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || o.status === statusFilter;
    const matchChannel = channelFilter === "all" || o.channel === channelFilter;
    return matchSearch && matchStatus && matchChannel;
  });

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
    <div className="space-y-6">
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
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="New">New</SelectItem>
            <SelectItem value="Confirmed">Confirmed</SelectItem>
            <SelectItem value="Scheduled for Production">Scheduled for Production</SelectItem>
            <SelectItem value="In Production">In Production</SelectItem>
            <SelectItem value="Completed">Completed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={channelFilter} onValueChange={setChannelFilter}>
          <SelectTrigger className="w-full sm:w-44">
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

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {["Order ID", "Customer", "Channel", "Status", "Payment", "Fulfillment", "Total", "Date"].map((h) => (
                  <th key={h} className={`px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider ${h === "Total" ? "text-right" : "text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((order) => (
                <tr key={order.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}