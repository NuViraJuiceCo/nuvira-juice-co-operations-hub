import { Factory } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function ProductionThroughputWidget({ batches }) {
  const weekData = [
    { day: "Mon", units: 240 },
    { day: "Tue", units: 380 },
    { day: "Wed", units: 200 },
    { day: "Thu", units: 490 },
    { day: "Fri", units: 300 },
    { day: "Sat", units: 200 },
    { day: "Sun", units: 150 },
  ];

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

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={weekData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="day" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} width={40} />
          <Tooltip />
          <Bar dataKey="units" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}