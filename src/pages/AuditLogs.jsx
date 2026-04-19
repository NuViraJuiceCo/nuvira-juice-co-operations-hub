import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Activity } from "lucide-react";
import moment from "moment";

const typeColors = {
  create: "bg-emerald-100 text-emerald-700",
  update: "bg-blue-100 text-blue-700",
  delete: "bg-red-100 text-red-700",
  synced: "bg-purple-100 text-purple-700",
};

export default function AuditLogs() {
  const [orders, setOrders] = useState([]);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [orderData, batchData] = await Promise.all([
        base44.entities.ShopifyOrder.list("-updated_date", 30),
        base44.entities.ProductionBatch.list("-updated_date", 20),
      ]);
      setOrders(orderData);
      setBatches(batchData);
      setLoading(false);
    }
    load();
  }, []);

  const logs = [
    ...orders.map(o => ({
      id: `order-${o.id}`,
      action: `Order ${o.production_status === "new" ? "Received" : "Updated"}`,
      entity: `${o.shopify_order_number} · ${o.customer_email}`,
      detail: o.production_status,
      time: o.updated_date,
      type: o.sync_status === "synced" ? "synced" : "update",
    })),
    ...batches.map(b => ({
      id: `batch-${b.id}`,
      action: `Batch ${b.status}`,
      entity: `${b.batch_id} · ${b.product_name}`,
      detail: `${b.planned_units} units`,
      time: b.updated_date,
      type: b.status === "Completed" ? "create" : "update",
    })),
  ].sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 50);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Audit Logs</h1>
        <p className="text-muted-foreground mt-1">Recent system activity across orders and production</p>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="space-y-0">
          {logs.length === 0 ? (
            <p className="text-center text-muted-foreground py-10">No recent activity found.</p>
          ) : (
            logs.map((log, i) => (
              <div key={log.id} className={`flex items-start gap-4 px-5 py-4 hover:bg-muted/20 transition-colors ${i < logs.length - 1 ? "border-b border-border/50" : ""}`}>
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${typeColors[log.type] || "bg-muted text-muted-foreground"}`}>
                  <Activity className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{log.action}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{log.entity}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-muted-foreground capitalize">{log.detail}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{moment(log.time).fromNow()}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}