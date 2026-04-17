import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import moment from "moment";

export default function EventCreateForm({ onClose, onSave }) {
  const [formData, setFormData] = useState({
    name: "",
    type: "Pop-Up",
    status: "Confirmed",
    date: moment().format("YYYY-MM-DD"),
    location: "",
    expected_attendees: "",
    products: "",
    notes: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const payload = {
        name: formData.name,
        type: formData.type,
        status: formData.status,
        date: formData.date,
        location: formData.location || undefined,
        expected_attendees: formData.expected_attendees ? parseInt(formData.expected_attendees) : undefined,
        products: formData.products || undefined,
        notes: formData.notes || undefined,
      };

      await base44.entities.Event.create(payload);
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
          <h2 className="text-lg font-semibold text-foreground">Create Event</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">{error}</div>}

          <div>
            <label className="text-sm font-medium text-foreground">Event Name *</label>
            <Input
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="e.g. Farmer's Market Pop-Up"
              required
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-foreground">Type *</label>
              <select
                name="type"
                value={formData.type}
                onChange={handleChange}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
              >
                <option>Pop-Up</option>
                <option>Market</option>
                <option>Corporate</option>
                <option>Tasting</option>
                <option>Festival</option>
                <option>Wholesale Meeting</option>
                <option>Other</option>
              </select>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Status *</label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
              >
                <option>Confirmed</option>
                <option>Pending</option>
                <option>Applied</option>
                <option>Cancelled</option>
                <option>Completed</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Date *</label>
            <Input
              type="date"
              name="date"
              value={formData.date}
              onChange={handleChange}
              required
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Location</label>
            <Input
              name="location"
              value={formData.location}
              onChange={handleChange}
              placeholder="e.g. Downtown Market Square"
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Expected Attendees</label>
            <Input
              type="number"
              name="expected_attendees"
              value={formData.expected_attendees}
              onChange={handleChange}
              placeholder="0"
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Products to Bring</label>
            <Input
              name="products"
              value={formData.products}
              onChange={handleChange}
              placeholder="e.g. 50x bottles Green Glow, 30x Berry Blast"
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Notes</label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              placeholder="Setup requirements, parking info, etc."
              className="mt-1 w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
              rows="3"
            />
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
              {loading ? "Creating..." : "Create Event"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}