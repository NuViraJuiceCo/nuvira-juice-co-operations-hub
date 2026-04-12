import { X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function BulkActionsBar({ selectedCount, onClearSelection, onDeleteSelected, onStatusUpdate }) {
  if (selectedCount === 0) return null;

  return (
    <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 flex items-center justify-between mb-4">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-foreground">
          {selectedCount} item{selectedCount !== 1 ? "s" : ""} selected
        </span>
      </div>
      <div className="flex items-center gap-2">
        {onStatusUpdate && (
          <Button variant="outline" size="sm" onClick={onStatusUpdate}>
            Update Status
          </Button>
        )}
        {onDeleteSelected && (
          <Button variant="destructive" size="sm" onClick={onDeleteSelected} className="gap-2">
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClearSelection}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}