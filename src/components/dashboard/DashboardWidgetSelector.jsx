import { Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function DashboardWidgetSelector({ widgets, onToggle }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <h3 className="font-semibold text-foreground mb-3">Widget View</h3>
      <div className="flex flex-wrap gap-2">
        {[
          { id: "production", label: "Production Throughput" },
          { id: "orders", label: "Active Orders" },
          { id: "inventory", label: "Inventory Alerts" },
        ].map((widget) => (
          <Button
            key={widget.id}
            variant={widgets.includes(widget.id) ? "default" : "outline"}
            size="sm"
            onClick={() => onToggle(widget.id)}
            className="gap-2"
          >
            {widgets.includes(widget.id) ? (
              <Maximize2 className="h-3.5 w-3.5" />
            ) : (
              <Minimize2 className="h-3.5 w-3.5" />
            )}
            {widget.label}
          </Button>
        ))}
      </div>
    </div>
  );
}