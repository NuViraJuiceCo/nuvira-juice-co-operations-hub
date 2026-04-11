import { Users, Wrench, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

const team = [
  { id: 1, name: "Amar Kahlon", role: "Production Lead", shift: "Mon–Fri, 6am–2pm", status: "Active" },
  { id: 2, name: "Kirandeep Kahlon", role: "Production Staff", shift: "Mon–Fri, 6am–2pm", status: "Active" },
  { id: 3, name: "Preet Singh", role: "Delivery Driver", shift: "Tue/Thu/Sat, 10am–4pm", status: "Active" },
  { id: 4, name: "Maya Torres", role: "Packing & QC", shift: "Mon–Wed–Fri, 8am–2pm", status: "Active" },
];

const equipment = [
  { id: 1, name: "Cold Press Juicer #1", type: "Juicer", status: "Operational", lastService: "2026-03-15" },
  { id: 2, name: "Cold Press Juicer #2", type: "Juicer", status: "Maintenance", lastService: "2026-04-08" },
  { id: 3, name: "Walk-In Refrigerator", type: "Cold Storage", status: "Operational", lastService: "2026-02-20" },
  { id: 4, name: "Bottle Labeller", type: "Packaging", status: "Operational", lastService: "2026-03-01" },
  { id: 5, name: "Delivery Van", type: "Vehicle", status: "Operational", lastService: "2026-04-01" },
];

export default function Resources() {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Resources</h1>
          <p className="text-muted-foreground mt-1">Team members and equipment management</p>
        </div>
        <Button className="gap-2"><Plus className="h-4 w-4" /> Add Resource</Button>
      </div>

      {/* Team */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold text-foreground">Team</h2>
          <span className="text-xs text-muted-foreground">({team.length} members)</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {team.map((member) => (
            <div key={member.id} className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm flex-shrink-0">
                {member.name.split(" ").map(n => n[0]).join("")}
              </div>
              <div>
                <p className="font-medium text-sm text-foreground">{member.name}</p>
                <p className="text-xs text-muted-foreground">{member.role}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{member.shift}</p>
              </div>
              <div className="ml-auto">
                <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">{member.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Equipment */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Wrench className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold text-foreground">Equipment</h2>
          <span className="text-xs text-muted-foreground">({equipment.length} items)</span>
        </div>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Equipment", "Type", "Status", "Last Service"].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {equipment.map((eq) => (
                <tr key={eq.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-3.5 font-medium text-sm text-foreground">{eq.name}</td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">{eq.type}</td>
                  <td className="px-5 py-3.5">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${eq.status === "Operational" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                      {eq.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">{eq.lastService}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}