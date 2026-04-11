import { Activity } from "lucide-react";
import moment from "moment";

const logs = [
  { id: 1, action: "Order Created", entity: "Order NV-006", user: "system", time: "2026-04-11T10:32:00Z", type: "create" },
  { id: 2, action: "Order Status Updated", entity: "Order NV-003 → In Production", user: "Amar Kahlon", time: "2026-04-11T09:15:00Z", type: "update" },
  { id: 3, action: "Batch Status Updated", entity: "BATCH-2026-W15-A → In Packing", user: "Amar Kahlon", time: "2026-04-11T08:55:00Z", type: "update" },
  { id: 4, action: "Fulfillment Task Created", entity: "Wellness Studio YVR", user: "system", time: "2026-04-10T16:20:00Z", type: "create" },
  { id: 5, action: "Order Payment Received", entity: "Order NV-005 → Pending", user: "system", time: "2026-04-10T14:10:00Z", type: "update" },
  { id: 6, action: "Batch Created", entity: "BATCH-2026-W15-C Citrus Sunrise", user: "Kirandeep Kahlon", time: "2026-04-10T11:00:00Z", type: "create" },
  { id: 7, action: "Order Completed", entity: "Order NV-006 Lisa Park", user: "Preet Singh", time: "2026-04-09T15:45:00Z", type: "update" },
  { id: 8, action: "User Login", entity: "Amar Kahlon", user: "Amar Kahlon", time: "2026-04-09T07:00:00Z", type: "auth" },
  { id: 9, action: "Fulfillment Packed", entity: "Jake Thompson — Citrus Sunrise", user: "Maya Torres", time: "2026-04-08T14:30:00Z", type: "update" },
  { id: 10, action: "PO Created", entity: "PO-003 Fresh Farms Blueberries", user: "Amar Kahlon", time: "2026-04-07T09:00:00Z", type: "create" },
];

const typeColors = {
  create: "bg-emerald-100 text-emerald-700",
  update: "bg-blue-100 text-blue-700",
  delete: "bg-red-100 text-red-700",
  auth: "bg-purple-100 text-purple-700",
};

export default function AuditLogs() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Audit Logs</h1>
        <p className="text-muted-foreground mt-1">System activity and user action history</p>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="space-y-0">
          {logs.map((log, i) => (
            <div key={log.id} className={`flex items-start gap-4 px-5 py-4 hover:bg-muted/20 transition-colors ${i < logs.length - 1 ? "border-b border-border/50" : ""}`}>
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${typeColors[log.type]}`}>
                <Activity className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{log.action}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{log.entity}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-xs text-muted-foreground">{log.user}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{moment(log.time).fromNow()}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}