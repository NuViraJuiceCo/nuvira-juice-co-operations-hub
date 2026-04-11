import { Link } from "react-router-dom";
import { ClipboardList } from "lucide-react";
import StatusBadge from "../shared/StatusBadge";

export default function UpcomingProduction({ batches }) {
  const activeBatches = batches.filter((b) => b.status !== "Completed").slice(0, 4);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between border-b border-border">
        <h3 className="font-semibold text-foreground">Upcoming Production</h3>
        <Link to="/production" className="text-sm text-primary hover:text-primary/80 font-medium transition-colors">
          View all →
        </Link>
      </div>
      <div className="p-4 space-y-3">
        {activeBatches.map((batch) => (
          <div key={batch.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors">
            <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{batch.product_name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {batch.batch_id} · {batch.planned_units} units
              </p>
              <div className="mt-1.5">
                <StatusBadge status={batch.status} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}