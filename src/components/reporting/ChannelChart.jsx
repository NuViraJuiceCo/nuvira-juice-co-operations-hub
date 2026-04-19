import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import _ from "lodash";

const COLORS = [
  "hsl(153, 50%, 28%)",
  "hsl(43, 74%, 56%)",
  "hsl(210, 60%, 55%)",
  "hsl(280, 50%, 60%)",
  "hsl(350, 65%, 55%)",
];

export default function ChannelChart({ orders }) {
  const grouped = _.groupBy(orders, "source_channel");
  const data = Object.entries(grouped)
    .map(([channel, channelOrders]) => ({
      name: channel,
      value: Math.round(_.sumBy(channelOrders, "total_price")),
    }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h3 className="font-semibold text-foreground mb-4">Sales by Channel</h3>
      <div className="flex items-center gap-6">
        <div className="h-52 w-52 flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={85}
                paddingAngle={3}
                dataKey="value"
              >
                {data.map((_, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(val) => [`$${val}`, "Revenue"]}
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid hsl(140, 10%, 90%)",
                  fontSize: "12px",
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-3 flex-1">
          {data.map((entry, idx) => (
            <div key={entry.name} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                />
                <span className="text-sm text-foreground">{entry.name}</span>
              </div>
              <span className="text-sm font-medium text-foreground">${entry.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}