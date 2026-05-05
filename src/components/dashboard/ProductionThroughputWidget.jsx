import { Factory } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { format, parseISO, startOfDay } from "date-fns";

export default function ProductionThroughputWidget({ batches }) {
  // Group batches by production_date, summing planned and actual units
  const dateMap = {};
  (batches || []).forEach((b) => {
    const date = b.production_date;
    if (!date) return;
    if (!dateMap[date]) dateMap[date] = { date, planned: 0, actual: 0 };
    dateMap[date].planned += b.planned_units || 0;
    dateMap[date].actual += b.actual_units || 0;
  });

  const weekData = Object.values(dateMap)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-7)
    .map((d) => ({
      day: format(parseISO(d.date), "MMM d"),
      planned: d.planned,
      actual: d.actual,
    }));

  const totalPlanned = batches.reduce((sum, b) => sum + (b.planned_units || 0), 0);
  const totalActual = batches.reduce((sum, b) => sum + (b.actual_units || 0), 0);
  const efficiency = totalPlanned > 0 ? ((totalActual / totalPlanned) * 100).toFixed(1) : 0;

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Factory className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-foreground">Production Throughput</h3>
        </div>
        <span className="text-sm font-medium text-emerald-600">{efficiency}% Efficiency</span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <p className="text-xs text-muted-foreground">Planned Units</p>
          <p className="text-2xl font-bold text-foreground">{totalPlanned}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Actual Units</p>
          <p className="text-2xl font-bold text-primary">{totalActual}</p>
        </div>
      </div>

      {weekData.length === 0 ? (
        <div className="flex items-center justify-center h-[220px] text-sm text-muted-foreground">
          No production batch data available.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={weekData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="day" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 12 }} width={35} />
            <Tooltip />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="planned" name="Planned" fill="hsl(var(--muted-foreground))" radius={[3, 3, 0, 0]} opacity={0.5} />
            <Bar dataKey="actual" name="Actual" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}