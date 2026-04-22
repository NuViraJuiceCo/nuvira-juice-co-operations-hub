import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";

export default function SyncPanel() {
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);

  const handleSyncBagReturns = async () => {
    setSyncing(true);
    setSyncStatus(null);
    try {
      await base44.functions.invoke("pullBagReturnsFromCustomerApp", {});
      setSyncStatus({ type: "success", message: "Bag returns synced successfully" });
    } catch (error) {
      setSyncStatus({ type: "error", message: error.message || "Sync failed" });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-foreground">Bag Returns Sync</h3>
          <p className="text-xs text-muted-foreground mt-1">Manual sync from customer app</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            onClick={handleSyncBagReturns}
            disabled={syncing}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Sync Now"}
          </Button>
          {syncStatus && (
            <div className="flex items-center gap-1">
              {syncStatus.type === "success" ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span className="text-xs text-emerald-700">{syncStatus.message}</span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <span className="text-xs text-red-700">{syncStatus.message}</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}