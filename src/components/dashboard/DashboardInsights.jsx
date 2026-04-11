import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts";
import moment from "moment";
import _ from "lodash";

function MiniTrendChart({ data, color }) {
  return (
    <ResponsiveContainer width="100%" height={48}>
      <AreaChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} fill={`url(#grad-${color})`} strokeWidth={1.5} dot={false} />
        <Tooltip content={() => null} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function InsightCard({ title, value, subtitle, trend, trendLabel, chartData, color = "#16a34a" }) {
  const TrendIcon = trend > 0 ? TrendingUp : trend < 0 ? TrendingDown : Minus;
  const trendColor = trend > 0 ? "text-emerald-600" : trend < 0 ? "text-red-500" : "text-muted-foreground";

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
      <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
      {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      {chartData && <div className="mt-3"><MiniTrendChart data={chartData} color={color} /></div>}
      {trendLabel && (
        <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${trendColor}`}>
          <TrendIcon className="h-3 w-3" />
          <span>{trendLabel}</span>
        </div>
      )}
    </div>
  );
}

export default function DashboardInsights({ orders }) {
  // Build last 7 days revenue trend
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const day = moment().subtract(6 - i, "days");
    const dayOrders = orders.filter(o => moment(o.created_date).isSame(day, "day"));
    return { label: day.format("ddd"), v: dayOrders.reduce((s, o) => s + (o.total || 0), 0) };
  });

  // Last 7 days vs prior 7 days revenue
  const prev7Revenue = orders
    .filter(o => {
      const d = moment(o.created_date);
      return d.isBefore(moment().subtract(7, "days")) && d.isAfter(moment().subtract(14, "days"));
    })
    .reduce((s, o) => s + (o.total || 0), 0);
  const curr7Revenue = last7.reduce((s, d) => s + d.v, 0);
  const revTrend = prev7Revenue > 0 ? ((curr7Revenue - prev7Revenue) / prev7Revenue) * 100 : 0;

  // Order volume trend
  const last7Count = orders.filter(o => moment(o.created_date).isAfter(moment().subtract(7, "days"))).length;
  const prev7Count = orders.filter(o => {
    const d = moment(o.created_date);
    return d.isBefore(moment().subtract(7, "days")) && d.isAfter(moment().subtract(14, "days"));
  }).length;
  const volTrend = prev7Count > 0 ? ((last7Count - prev7Count) / prev7Count) * 100 : 0;

  // Channel breakdown
  const channelGroups = _.groupBy(orders, "channel");
  const topChannel = Object.entries(channelGroups).sort((a, b) => b[1].length - a[1].length)[0];

  // Avg order value
  const completedOrders = orders.filter(o => o.total > 0);
  const avgOrderValue = completedOrders.length > 0
    ? completedOrders.reduce((s, o) => s + o.total, 0) / completedOrders.length
    : 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <InsightCard
        title="7-Day Revenue"
        value={`$${curr7Revenue.toFixed(0)}`}
        chartData={last7}
        color="#16a34a"
        trend={revTrend}
        trendLabel={`${Math.abs(revTrend).toFixed(1)}% vs prior week`}
      />
      <InsightCard
        title="Order Volume (7d)"
        value={last7Count}
        subtitle={`${prev7Count} prior week`}
        trend={volTrend}
        trendLabel={`${Math.abs(volTrend).toFixed(1)}% vs prior week`}
        color="#2563eb"
        chartData={last7.map(d => ({ v: orders.filter(o => moment(o.created_date).isSame(moment(d.label, "ddd"), "day")).length }))}
      />
      <InsightCard
        title="Avg Order Value"
        value={`$${avgOrderValue.toFixed(2)}`}
        subtitle={`Across ${completedOrders.length} orders`}
        color="#7c3aed"
      />
      <InsightCard
        title="Top Channel"
        value={topChannel ? topChannel[0].split(" ")[0] : "—"}
        subtitle={topChannel ? `${topChannel[1].length} orders` : "No data yet"}
        color="#d97706"
      />
    </div>
  );
}