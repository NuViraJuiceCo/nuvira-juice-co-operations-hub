import { ShieldCheck, AlertTriangle, Clock, CheckCircle2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import StatCard from "../components/shared/StatCard";
import moment from "moment";

const items = [
  { id: 1, name: "Food Handler Certification — Amar Kahlon", type: "Certification", status: "Valid", expires: "2026-09-15", owner: "Amar Kahlon" },
  { id: 2, name: "Food Handler Certification — Kirandeep Kahlon", type: "Certification", status: "Valid", expires: "2027-02-20", owner: "Kirandeep Kahlon" },
  { id: 3, name: "Commercial Kitchen Permit", type: "Permit", status: "Valid", expires: "2026-12-31", owner: "NuVira" },
  { id: 4, name: "HACCP Plan Review", type: "Audit", status: "Due Soon", expires: "2026-04-30", owner: "NuVira" },
  { id: 5, name: "BC Health Inspection", type: "Inspection", status: "Valid", expires: "2026-10-01", owner: "NuVira" },
  { id: 6, name: "Product Allergen Labels Review", type: "Review", status: "Overdue", expires: "2026-03-01", owner: "NuVira" },
  { id: 7, name: "Cold Chain Log — April", type: "Log", status: "Valid", expires: "2026-04-30", owner: "Ops Team" },
];

const statusStyle = {
  Valid: "bg-emerald-50 text-emerald-700",
  "Due Soon": "bg-amber-50 text-amber-700",
  Overdue: "bg-red-50 text-red-700",
};

const statusIcon = {
  Valid: CheckCircle2,
  "Due Soon": Clock,
  Overdue: AlertTriangle,
};

export default function Compliance() {
  const valid = items.filter(i => i.status === "Valid").length;
  const dueSoon = items.filter(i => i.status === "Due Soon").length;
  const overdue = items.filter(i => i.status === "Overdue").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Compliance</h1>
          <p className="text-muted-foreground mt-1">Track certifications, permits, and regulatory requirements</p>
        </div>
        <Button className="gap-2"><Plus className="h-4 w-4" /> Add Item</Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Valid" value={valid} icon={ShieldCheck} />
        <StatCard label="Due Soon" value={dueSoon} icon={Clock} />
        <StatCard label="Overdue" value={overdue} icon={AlertTriangle} />
      </div>

      <div className="space-y-3">
        {items.map((item) => {
          const Icon = statusIcon[item.status] || CheckCircle2;
          return (
            <div key={item.id} className="bg-card border border-border rounded-xl p-4 flex items-center gap-4 hover:shadow-sm transition-shadow">
              <div className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 ${statusStyle[item.status]}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-foreground">{item.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{item.type} · {item.owner}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyle[item.status]}`}>
                  {item.status}
                </span>
                <p className="text-xs text-muted-foreground mt-1">
                  Expires {moment(item.expires).format("MMM D, YYYY")}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}