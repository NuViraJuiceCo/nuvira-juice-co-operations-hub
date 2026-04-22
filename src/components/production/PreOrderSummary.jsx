import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { RefreshCw, TrendingUp, Users, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PreOrderSummary({ preOrders, dateStart, dateEnd, onRefresh }) {
  const totalOrders = preOrders.length;
  const totalRevenue = preOrders.reduce((sum, o) => sum + (o.total_price || 0), 0);
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // Count by product
  const productCounts = {};
  preOrders.forEach(order => {
    if (order.line_items) {
      order.line_items.forEach(item => {
        const key = item.title || "Unknown";
        productCounts[key] = (productCounts[key] || 0) + item.quantity;
      });
    }
  });

  const chartData = Object.entries(productCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Total Pre-Orders</p>
              <p className="text-2xl font-bold text-foreground">{totalOrders}</p>
            </div>
            <ShoppingBag className="h-8 w-8 text-primary/20" />
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Revenue</p>
              <p className="text-2xl font-bold text-foreground">${totalRevenue.toFixed(2)}</p>
            </div>
            <TrendingUp className="h-8 w-8 text-primary/20" />
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Avg Order Value</p>
              <p className="text-2xl font-bold text-foreground">${avgOrderValue.toFixed(2)}</p>
            </div>
            <Users className="h-8 w-8 text-primary/20" />
          </div>
        </div>
      </div>

      {/* Product Breakdown Chart */}
      {chartData.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-foreground">Product Demand</h3>
            <Button 
              variant="ghost" 
              size="sm"
              onClick={onRefresh}
              className="h-8 w-8 p-0"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip contentStyle={{ backgroundColor: "var(--color-card)", border: "1px solid var(--color-border)" }} />
              <Bar dataKey="count" fill="var(--color-primary)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Date Range Info */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-xs text-amber-900">
          <strong>Pre-Order Window:</strong> April 23–30, 2026 · Payments process April 30 · Production batches due before May 1
        </p>
      </div>
    </div>
  );
}