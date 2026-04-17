import { useState } from "react";
import { Users, Wrench, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import ResourceAddForm from "../components/resources/ResourceAddForm";

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
  const [teamData, setTeamData] = useState(team);
  const [equipmentData, setEquipmentData] = useState(equipment);
  const [selectedTeam, setSelectedTeam] = useState(new Set());
  const [selectedEquip, setSelectedEquip] = useState(new Set());
  const [deleting, setDeleting] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const handleDeleteTeam = async (id) => {
    setDeleting(id);
    try {
      setTeamData(teamData.filter(m => m.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  const handleBulkDeleteTeam = async () => {
    if (!window.confirm(`Delete ${selectedTeam.size} team member(s)?`)) return;
    setDeleting(true);
    try {
      setTeamData(teamData.filter(m => !selectedTeam.has(m.id)));
      setSelectedTeam(new Set());
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteEquip = async (id) => {
    setDeleting(id);
    try {
      setEquipmentData(equipmentData.filter(e => e.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  const handleBulkDeleteEquip = async () => {
    if (!window.confirm(`Delete ${selectedEquip.size} equipment item(s)?`)) return;
    setDeleting(true);
    try {
      setEquipmentData(equipmentData.filter(e => !selectedEquip.has(e.id)));
      setSelectedEquip(new Set());
    } finally {
      setDeleting(false);
    }
  };

  const toggleTeamSelect = (id) => {
    const newSelected = new Set(selectedTeam);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelectedTeam(newSelected);
  };

  const toggleEquipSelect = (id) => {
    const newSelected = new Set(selectedEquip);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelectedEquip(newSelected);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Resources</h1>
          <p className="text-muted-foreground mt-1">Team members and equipment management</p>
        </div>
        <Button className="gap-2" onClick={() => setShowAddForm(true)}><Plus className="h-4 w-4" /> Add Resource</Button>
      </div>

      {/* Team */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold text-foreground">Team</h2>
          <span className="text-xs text-muted-foreground">({teamData.length} members)</span>
        </div>
        {selectedTeam.size > 0 && (
          <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <span className="text-sm font-medium text-blue-900">{selectedTeam.size} selected</span>
            <button onClick={handleBulkDeleteTeam} disabled={deleting} className="text-sm px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
              {deleting ? "Deleting..." : "Delete Selected"}
            </button>
            <button onClick={() => setSelectedTeam(new Set())} className="text-sm px-3 py-1.5 rounded border border-blue-200 text-blue-700 hover:bg-blue-100">
              Cancel
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {teamData.map((member) => (
            <div key={member.id} className="bg-card border border-border rounded-xl p-4 flex items-center gap-4 relative">
              <input
                type="checkbox"
                checked={selectedTeam.has(member.id)}
                onChange={() => toggleTeamSelect(member.id)}
                className="absolute top-3 left-3"
              />
              <button
                onClick={() => handleDeleteTeam(member.id)}
                disabled={deleting === member.id}
                className="absolute top-3 right-3 text-red-600 hover:text-red-700 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm flex-shrink-0 ml-6">
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
          <span className="text-xs text-muted-foreground">({equipmentData.length} items)</span>
        </div>
        {selectedEquip.size > 0 && (
          <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <span className="text-sm font-medium text-blue-900">{selectedEquip.size} selected</span>
            <button onClick={handleBulkDeleteEquip} disabled={deleting} className="text-sm px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
              {deleting ? "Deleting..." : "Delete Selected"}
            </button>
            <button onClick={() => setSelectedEquip(new Set())} className="text-sm px-3 py-1.5 rounded border border-blue-200 text-blue-700 hover:bg-blue-100">
              Cancel
            </button>
          </div>
        )}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Select</th>
                {["Equipment", "Type", "Status", "Last Service"].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
                <th className="px-5 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody>
              {equipmentData.map((eq) => (
                <tr key={eq.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-3.5">
                    <input
                      type="checkbox"
                      checked={selectedEquip.has(eq.id)}
                      onChange={() => toggleEquipSelect(eq.id)}
                    />
                  </td>
                  <td className="px-5 py-3.5 font-medium text-sm text-foreground">{eq.name}</td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">{eq.type}</td>
                  <td className="px-5 py-3.5">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${eq.status === "Operational" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                      {eq.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground">{eq.lastService}</td>
                  <td className="px-5 py-3.5 text-center">
                    <button
                      onClick={() => handleDeleteEquip(eq.id)}
                      disabled={deleting === eq.id}
                      className="text-red-600 hover:text-red-700 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAddForm && (
        <ResourceAddForm
          onClose={() => setShowAddForm(false)}
          onAddTeam={(member) => {
            setTeamData([...teamData, { ...member, id: Math.max(...teamData.map(m => m.id), 0) + 1 }]);
            setShowAddForm(false);
          }}
          onAddEquipment={(item) => {
            setEquipmentData([...equipmentData, { ...item, id: Math.max(...equipmentData.map(e => e.id), 0) + 1 }]);
            setShowAddForm(false);
          }}
        />
      )}
    </div>
  );
}