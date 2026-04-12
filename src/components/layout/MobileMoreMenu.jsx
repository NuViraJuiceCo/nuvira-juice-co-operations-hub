import { Link } from "react-router-dom";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { MoreVertical, LogOut } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useState } from "react";

const moreItems = [
  { path: "/inventory", label: "Inventory" },
  { path: "/suppliers", label: "Suppliers" },
  { path: "/compliance", label: "Compliance" },
  { path: "/resources", label: "Resources" },
  { path: "/events", label: "Events" },
  { path: "/partnerships", label: "Partnerships" },
  { path: "/reporting", label: "Reporting" },
  { path: "/calendar", label: "Calendar" },
  { path: "/prod-scheduler", label: "Prod. Scheduler" },
  { path: "/purchase-orders", label: "Purchase Orders" },
  { path: "/route-optimizer", label: "Route Optimizer" },
  { path: "/users", label: "User Management" },
  { path: "/audit-logs", label: "Audit Logs" },
  { path: "/report-scheduler", label: "Reports" },
  { path: "/settings", label: "Settings" },
];

export default function MobileMoreMenu() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button className="flex-1 flex flex-col items-center justify-center py-2 px-1 min-h-touch text-muted-foreground hover:text-foreground transition-colors">
          <MoreVertical className="h-5 w-5" />
          <span className="text-[10px] font-medium mt-0.5 leading-tight">More</span>
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[80vh]">
        <div className="overflow-y-auto p-4 space-y-2">
          {moreItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setOpen(false)}
              className="block px-4 py-3 rounded-lg text-sm text-foreground hover:bg-muted transition-colors"
            >
              {item.label}
            </Link>
          ))}
          <button
            onClick={() => {
              setOpen(false);
              base44.auth.logout();
            }}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm text-foreground hover:bg-muted transition-colors mt-4 pt-4 border-t border-border"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}