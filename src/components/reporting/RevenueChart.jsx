import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import _ from "lodash";
import moment from "moment";

export default function RevenueChart({ orders }) {
  const grouped = _.groupBy(orders, (o) =>
    moment(o.created_date).format("MMM D")
  );

  const data = Object.entries(grouped).map(([date, dateOrders]) => ({
    date,
    revenue: _.sumBy(dateOrders, "total"),
  }));

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h3 className="font-semibold text-foreground mb-4">Revenue Trend</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="revGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(153, 50%, 28%)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(153, 50%, 28%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(140, 10%, 90%)" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="hsl(150, 5%, 45%)" />
            <YAxis tick={{ fontSize: 12 }} stroke="hsl(150, 5%, 45%)" />
            <Tooltip
              contentStyle={{
                borderRadius: "8px",
                border: "1px solid hsl(140, 10%, 90%)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              }}
              formatter={(val) => [`$${val.toFixed(2)}`, "Revenue"]}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="hsl(153, 50%, 28%)"
              strokeWidth={2}
              fill="url(#revGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}