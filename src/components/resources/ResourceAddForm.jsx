import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { base44 } from "@/api/base44Client";

export default function ResourceAddForm({ onClose, onSave }) {
  const [type, setType] = useState("team");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    role: "",
    shift: "",
    status: "Active",
    equipType: "",
    equipStatus: "Operational",
    lastService: new Date().toISOString().split("T")[0],
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (type === "team") {
        if (!formData.name || !formData.role || !formData.shift) {
          setError("Please fill in all team member fields");
          return;
        }
        await base44.entities.Resource.create({
          title: formData.name,
          category: "Team Member",
          description: `${formData.role} - ${formData.shift}`,
          version: formData.status,
          status: "Active",
        });
      } else {
        if (!formData.name || !formData.equipType) {
          setError("Please fill in all equipment fields");
          return;
        }
        await base44.entities.Resource.create({
          title: formData.name,
          category: "Equipment",
          description: `Type: ${formData.equipType} | Last Service: ${formData.lastService}`,
          version: formData.equipStatus,
          status: "Active",
        });
      }
      await onSave();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-card rounded-2xl shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-border sticky top-0 bg-card">
          <h2 className="text-lg font-semibold text-foreground">Add Resource</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">{error}</div>}
          <div>
            <label className="text-sm font-medium text-foreground">Resource Type</label>
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setFormData({
                  name: "",
                  role: "",
                  shift: "",
                  status: "Active",
                  equipType: "",
                  equipStatus: "Operational",
                  lastService: new Date().toISOString().split("T")[0],
                });
              }}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
            >
              <option value="team">Team Member</option>
              <option value="equipment">Equipment</option>
            </select>
          </div>

          {type === "team" ? (
            <>
              <div>
                <label className="text-sm font-medium text-foreground">Name *</label>
                <Input
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="Full name"
                  className="mt-1"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">Role *</label>
                <Input
                  name="role"
                  value={formData.role}
                  onChange={handleChange}
                  placeholder="e.g. Production Lead"
                  className="mt-1"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">Shift *</label>
                <Input
                  name="shift"
                  value={formData.shift}
                  onChange={handleChange}
                  placeholder="e.g. Mon–Fri, 6am–2pm"
                  className="mt-1"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">Status</label>
                <select
                  name="status"
                  value={formData.status}
                  onChange={handleChange}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
                >
                  <option>Active</option>
                  <option>On Leave</option>
                  <option>Inactive</option>
                </select>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-sm font-medium text-foreground">Equipment Name *</label>
                <Input
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="e.g. Cold Press Juicer #3"
                  className="mt-1"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">Type *</label>
                <Input
                  name="equipType"
                  value={formData.equipType}
                  onChange={handleChange}
                  placeholder="e.g. Juicer"
                  className="mt-1"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">Status</label>
                <select
                  name="equipStatus"
                  value={formData.equipStatus}
                  onChange={handleChange}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
                >
                  <option>Operational</option>
                  <option>Maintenance</option>
                  <option>Broken</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">Last Service</label>
                <Input
                  type="date"
                  name="lastService"
                  value={formData.lastService}
                  onChange={handleChange}
                  className="mt-1"
                />
              </div>
            </>
          )}

          <div className="flex items-center gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="flex-1"
            >
              {loading ? "Adding..." : "Add Resource"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}