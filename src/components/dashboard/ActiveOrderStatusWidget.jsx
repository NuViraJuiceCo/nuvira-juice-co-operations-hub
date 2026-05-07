import { ShoppingCart, TrendingUp } from "lucide-react";
import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from "recharts";

export default function ActiveOrderStatusWidget({ orders }) {
  // Only count PAID orders to exclude abandoned/pending checkouts
  const paidOrders = orders.filter(o => o.payment_status === "paid");
  
  const statusCounts = {
    New: paidOrders.filter(o => o.production_status === "new").length,
    "In Production": paidOrders.filter(o => o.production_status === "in_production").length,
    Packed: paidOrders.filter(o => o.production_status === "packed").length,
    Fulfilled: paidOrders.filter(o => o.production_status === "fulfilled").length,
  };

  const totalRevenue = paidOrders.reduce((sum, o) => sum + (o.total_price || 0), 0);
  const avgOrderValue = paidOrders.length > 0 ? (totalRevenue / paidOrders.length).toFixed(2) : 0;

  const chartData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));
  const colors = ["#991b1b", "#ea580c", "#2563eb", "#059669"];

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-foreground">Active Order Status</h3>
        </div>
        <span className="text-sm font-medium text-blue-600 flex items-center gap-1">
         <TrendingUp className="h-4 w-4" /> {paidOrders.length} Orders
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <p className="text-xs text-muted-foreground">Total Revenue</p>
          <p className="text-2xl font-bold text-foreground">${totalRevenue.toFixed(0)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Avg Order Value</p>
          <p className="text-2xl font-bold text-primary">${avgOrderValue}</p>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <PieChart margin={{ top: 10, right: 20, bottom: 20, left: 20 }}>
          <Pie
            data={chartData}
            cx="50%"
            cy="45%"
            innerRadius={45}
            outerRadius={75}
            paddingAngle={2}
            dataKey="value"
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend verticalAlign="bottom" height={48} wrapperStyle={{ fontSize: "12px", paddingTop: "16px" }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}