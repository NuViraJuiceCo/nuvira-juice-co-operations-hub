import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function OrderEditForm({ order, onClose, onSave }) {
  const [formData, setFormData] = useState({
    production_status: order.production_status,
    payment_status: order.payment_status,
    fulfillment_method: order.fulfillment_method,
    assigned_delivery_date: order.assigned_delivery_date || "",
    customer_notes: order.customer_notes || "",
    internal_notes: order.internal_notes || "",
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
      await base44.entities.ShopifyOrder.update(order.id, formData);
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
            <p className="font-semibold text-foreground">{order.shopify_order_number}</p>
          </div>

          <div className="space-y-1 text-sm">
            <p className="text-muted-foreground">Customer</p>
            <p className="font-semibold text-foreground">{order.customer_email}</p>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Production Status</label>
            <select
              name="production_status"
              value={formData.production_status}
              onChange={handleChange}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
            >
              <option value="new">New</option>
              <option value="awaiting_production">Awaiting Production</option>
              <option value="in_production">In Production</option>
              <option value="bottled">Bottled</option>
              <option value="labeled">Labeled</option>
              <option value="qc_checked">QC Checked</option>
              <option value="packed">Packed</option>
              <option value="in_cold_storage">In Cold Storage</option>
              <option value="assigned_for_pickup">Assigned for Pickup</option>
              <option value="assigned_for_delivery">Assigned for Delivery</option>
              <option value="fulfilled">Fulfilled</option>
              <option value="canceled">Canceled</option>
              <option value="refunded">Refunded</option>
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
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
              <option value="authorized">Authorized</option>
              <option value="refunded">Refunded</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Fulfillment Method</label>
            <select
              name="fulfillment_method"
              value={formData.fulfillment_method}
              onChange={handleChange}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
            >
              <option value="delivery">Delivery</option>
              <option value="pickup">Pickup</option>
              <option value="shipping">Shipping</option>
              <option value="pos">POS</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Assigned Delivery Date</label>
            <Input
              type="date"
              name="assigned_delivery_date"
              value={formData.assigned_delivery_date}
              onChange={handleChange}
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Customer Notes</label>
            <textarea
              name="customer_notes"
              value={formData.customer_notes}
              onChange={handleChange}
              placeholder="Customer-facing notes..."
              className="mt-1 w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
              rows="2"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Internal Notes</label>
            <textarea
              name="internal_notes"
              value={formData.internal_notes}
              onChange={handleChange}
              placeholder="Internal operations notes..."
              className="mt-1 w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
              rows="2"
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