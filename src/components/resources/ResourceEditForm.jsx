import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { base44 } from "@/api/base44Client";

export default function ResourceEditForm({ resource, onClose, onSave }) {
  const isTeam = resource.category === "Team Member";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const getTagValue = (prefix) => {
    if (!resource.tags) return "";
    const tag = resource.tags.find(t => t.startsWith(prefix));
    return tag ? tag.replace(prefix, "") : "";
  };

  const [formData, setFormData] = useState({
    name: resource.title,
    description: resource.description || "",
    shift: isTeam ? (resource.tags?.[0] || "") : "",
    lastService: !isTeam ? getTagValue("LastService:") : "",
    version: resource.version || (isTeam ? "Active" : "Operational"),
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
      const updateData = {
        title: formData.name,
        description: formData.description,
        version: formData.version,
      };

      if (isTeam) {
        updateData.tags = [formData.shift];
      } else {
        updateData.tags = [`LastService:${formData.lastService}`];
      }

      await base44.entities.Resource.update(resource.id, updateData);
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
          <h2 className="text-lg font-semibold text-foreground">Edit {isTeam ? "Team Member" : "Equipment"}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">{error}</div>}

          <div>
            <label className="text-sm font-medium text-foreground">Name *</label>
            <Input
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">{isTeam ? "Role" : "Type"}</label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder={isTeam ? "Job role" : "Equipment type"}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
              rows="2"
            />
          </div>

          {isTeam && (
            <div>
              <label className="text-sm font-medium text-foreground">Shift</label>
              <Input
                name="shift"
                value={formData.shift}
                onChange={handleChange}
                placeholder="e.g., Morning, Afternoon, Night"
                className="mt-1"
              />
            </div>
          )}

          {!isTeam && (
            <div>
              <label className="text-sm font-medium text-foreground">Last Service Date</label>
              <Input
                type="date"
                name="lastService"
                value={formData.lastService}
                onChange={handleChange}
                className="mt-1"
              />
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-foreground">Status</label>
            <select
              name="version"
              value={formData.version}
              onChange={handleChange}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
            >
              {isTeam ? (
                <>
                  <option>Active</option>
                  <option>On Leave</option>
                  <option>Inactive</option>
                </>
              ) : (
                <>
                  <option>Operational</option>
                  <option>Maintenance</option>
                  <option>Broken</option>
                </>
              )}
            </select>
          </div>

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
              {loading ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}