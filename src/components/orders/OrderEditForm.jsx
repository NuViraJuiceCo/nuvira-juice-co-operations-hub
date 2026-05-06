import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { X, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function OrderEditForm({ order, onClose, onSave }) {
  const [formData, setFormData] = useState({
    production_status: order.production_status || "new",
    payment_status: order.payment_status || "pending",
    fulfillment_method: order.fulfillment_method || "delivery",
    assigned_delivery_date: order.assigned_delivery_date || "",
    customer_notes: order.customer_notes || "",
    internal_notes: order.internal_notes || "",
    address_line1: order.address_line1 || "",
    address_line2: order.address_line2 || "",
    address_city: order.address_city || "",
    address_state: order.address_state || "",
    address_postal_code: order.address_postal_code || "",
    address_country: order.address_country || "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [savedStatus, setSavedStatus] = useState(null); // confirmed persisted value
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(u => setCurrentUser(u)).catch(() => {});
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSavedStatus(null);

    const now = new Date().toISOString();

    try {
      // source: 'admin' bypasses field-ownership filtering — all fields written as-is.
      // manual_override=true prevents customer_app/rebuild_subscriptions from reverting these values.
      await base44.functions.invoke('safeSyncOrderUpdate', {
        incomingData: {
          ...formData,
          manual_override: true,
          manual_override_at: now,
          manual_override_by: currentUser?.email || 'admin',
        },
        source: 'admin',
        matchBy: { internal_id: order.id },
      });

      // Confirm the value actually persisted by re-fetching the order
      const refetched = await base44.entities.ShopifyOrder.get(order.id);
      const confirmedStatus = refetched?.production_status;

      if (confirmedStatus !== formData.production_status) {
        setError(
          `Save appeared to succeed but production_status is still "${confirmedStatus}" — expected "${formData.production_status}". Check backend logs.`
        );
        setLoading(false);
        return;
      }

      setSavedStatus(confirmedStatus);
      // Brief delay to show confirmation, then close and refresh parent
      setTimeout(() => {
        onSave();
      }, 1200);
    } catch (err) {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        "Save failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-card rounded-2xl shadow-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-border sticky top-0 bg-card">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Edit Order</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Changes are protected from Customer App sync overwrites
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          {savedStatus && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-2 rounded-lg text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Saved and confirmed: production_status = <strong>{savedStatus}</strong>
            </div>
          )}

          <div className="space-y-1 text-sm">
            <p className="text-muted-foreground">Order ID</p>
            <p className="font-semibold text-foreground">{order.shopify_order_number}</p>
          </div>

          <div className="space-y-1 text-sm">
            <p className="text-muted-foreground">Customer</p>
            <p className="font-semibold text-foreground">{order.customer_email}</p>
          </div>

          {order.manual_override && (
            <div className="text-xs bg-amber-50 border border-amber-200 text-amber-700 px-3 py-2 rounded-lg">
              🔒 Manual override active — Customer App sync cannot overwrite status fields.
              {order.manual_override_by && (
                <span className="ml-1">Set by {order.manual_override_by}.</span>
              )}
            </div>
          )}

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
            <Button type="submit" disabled={loading || !!savedStatus} className="flex-1">
              {loading ? "Saving..." : savedStatus ? "Saved ✓" : "Save Changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}