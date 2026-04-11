import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { ShieldCheck, AlertTriangle, Clock, CheckCircle2, Plus, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import StatCard from "../components/shared/StatCard";
import moment from "moment";

const statusStyle = {
  Valid: "bg-emerald-50 text-emerald-700",
  "Due Soon": "bg-amber-50 text-amber-700",
  Overdue: "bg-red-50 text-red-700",
  Expired: "bg-red-100 text-red-800",
  Pending: "bg-blue-50 text-blue-700",
};
const statusIcon = { Valid: CheckCircle2, "Due Soon": Clock, Overdue: AlertTriangle, Expired: AlertTriangle, Pending: Clock };

export default function Compliance() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.entities.ComplianceDoc.list("-expiry_date", 50).then(data => {
      setDocs(data);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  const valid = docs.filter(d => d.status === "Valid").length;
  const dueSoon = docs.filter(d => d.status === "Due Soon").length;
  const overdue = docs.filter(d => d.status === "Overdue" || d.status === "Expired").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Compliance</h1>
          <p className="text-muted-foreground mt-1">Certifications, permits and regulatory requirements</p>
        </div>
        <Button className="gap-2 self-start sm:self-auto"><Plus className="h-4 w-4" /> Add Document</Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Valid" value={valid} icon={ShieldCheck} />
        <StatCard label="Due Soon" value={dueSoon} icon={Clock} />
        <StatCard label="Overdue" value={overdue} icon={AlertTriangle} />
      </div>

      <div className="space-y-3">
        {docs.map(doc => {
          const Icon = statusIcon[doc.status] || CheckCircle2;
          return (
            <div key={doc.id} className="bg-card border border-border rounded-xl p-4 flex items-center gap-4 hover:shadow-sm transition-shadow">
              <div className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 ${statusStyle[doc.status] || "bg-gray-50 text-gray-700"}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-foreground">{doc.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{doc.type} · {doc.owner || doc.issuing_body || "—"}</p>
              </div>
              <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyle[doc.status] || "bg-gray-50 text-gray-700"}`}>{doc.status}</span>
                {doc.expiry_date && <p className="text-xs text-muted-foreground">Expires {moment(doc.expiry_date).format("MMM D, YYYY")}</p>}
                {doc.file_url && (
                  <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline">
                    <FileText className="h-3 w-3" /> View
                  </a>
                )}
              </div>
            </div>
          );
        })}
        {docs.length === 0 && <p className="text-center text-muted-foreground py-12">No compliance documents yet.</p>}
      </div>
    </div>
  );
}