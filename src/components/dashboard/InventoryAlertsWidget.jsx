import { AlertTriangle, Package } from "lucide-react";

export default function InventoryAlertsWidget({ items }) {
  const getStatus = (item) => {
    if (item.stock <= 0) return "Out of Stock";
    if (item.stock <= item.reorder_point * 0.5) return "Critical";
    if (item.stock <= item.reorder_point) return "Low";
    return "OK";
  };

  const alerts = items.filter(item => {
    const status = getStatus(item);
    return status === "Low" || status === "Critical" || status === "Out of Stock";
  });

  const statusColors = {
    "Out of Stock": "bg-red-50 border-red-200",
    "Critical": "bg-orange-50 border-orange-200",
    "Low": "bg-amber-50 border-amber-200",
  };

  const textColors = {
    "Out of Stock": "text-red-700",
    "Critical": "text-orange-700",
    "Low": "text-amber-700",
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <h3 className="font-semibold text-foreground">Inventory Alerts</h3>
        </div>
        <span className="text-sm font-medium text-destructive">{alerts.length} Items</span>
      </div>

      {alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Package className="h-10 w-10 text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">All inventory levels are healthy</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {alerts.map((item) => {
            const status = getStatus(item);
            return (
              <div
                key={item.id}
                className={`border rounded-lg p-3 ${statusColors[status]}`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className={`font-medium text-sm ${textColors[status]}`}>
                      {item.ingredient}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Stock: {item.stock} {item.unit} / Reorder: {item.reorder_point}
                    </p>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-1 rounded ${textColors[status]}`}>
                    {status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}