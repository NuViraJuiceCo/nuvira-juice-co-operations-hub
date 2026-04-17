import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function OrderEditForm({ order, onClose, onSave }) {
  const [formData, setFormData] = useState({
    status: order.status,
    payment_status: order.payment_status,
    fulfillment_type: order.fulfillment_type,
    fulfillment_window: order.fulfillment_window || "",
    notes: order.notes || "",
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
      await base44.entities.Order.update(order.id, formData);
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
          <h2 className="text-lg font-semibold text-foreground">Edit Order</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">{error}</div>}

          <div className="space-y-1 text-sm">
            <p className="text-muted-foreground">Order ID</p>
            <p className="font-semibold text-foreground">{order.order_id}</p>
          </div>

          <div className="space-y-1 text-sm">
            <p className="text-muted-foreground">Customer</p>
            <p className="font-semibold text-foreground">{order.customer_name}</p>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Status</label>
            <select
              name="status"
              value={formData.status}
              onChange={handleChange}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
            >
              <option>New</option>
              <option>Confirmed</option>
              <option>Scheduled for Production</option>
              <option>In Production</option>
              <option>Completed</option>
              <option>Cancelled</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Payment Status</label>
            <select
              name="payment_status"
              value={formData.payment_status}
              onChange={handleChange}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
            >
              <option>Pending</option>
              <option>Paid</option>
              <option>Refunded</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Fulfillment Type</label>
            <select
              name="fulfillment_type"
              value={formData.fulfillment_type}
              onChange={handleChange}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
            >
              <option>Delivery</option>
              <option>Pickup</option>
              <option>Wholesale</option>
              <option>Event</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Fulfillment Window</label>
            <Input
              name="fulfillment_window"
              value={formData.fulfillment_window}
              onChange={handleChange}
              placeholder="e.g. 10am-12pm"
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Notes</label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              placeholder="Add any special instructions or notes..."
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
              {loading ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}