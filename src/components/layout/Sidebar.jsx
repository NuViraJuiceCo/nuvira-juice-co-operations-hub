import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, BarChart3, ChevronLeft, ChevronRight, LogOut, ShoppingCart, Factory, Truck, CalendarDays, Package, Users, ShieldCheck, Wrench, CalendarCheck, Handshake, ClipboardList, ShoppingBag, Route, UserCog, ScrollText, FileBarChart } from "lucide-react";
import { useState } from "react";
import { base44 } from "@/api/base44Client";

const navGroups = [
  {
    label: null,
    items: [
      { path: "/", label: "Dashboard", icon: LayoutDashboard },
      { path: "/orders", label: "Orders", icon: ShoppingCart },
      { path: "/production", label: "Production", icon: Factory },
      { path: "/fulfillment", label: "Fulfillment", icon: Truck },
      { path: "/inventory", label: "Inventory", icon: Package },
      { path: "/suppliers", label: "Suppliers", icon: Users },
      { path: "/compliance", label: "Compliance", icon: ShieldCheck },
      { path: "/resources", label: "Resources", icon: Wrench },
      { path: "/events", label: "Events", icon: CalendarCheck },
      { path: "/partnerships", label: "Partnerships", icon: Handshake },
      { path: "/reporting", label: "Reporting", icon: BarChart3 },
      { path: "/calendar", label: "Calendar", icon: CalendarDays },
      { path: "/prod-scheduler", label: "Prod. Scheduler", icon: ClipboardList },
      { path: "/purchase-orders", label: "Purchase Orders", icon: ShoppingBag },
      { path: "/route-optimizer", label: "Route Optimizer", icon: Route },
    ],
  },
  {
    label: "Admin",
    items: [
      { path: "/users", label: "User Management", icon: UserCog },
      { path: "/audit-logs", label: "Audit Logs", icon: ScrollText },
      { path: "/report-scheduler", label: "Reports", icon: FileBarChart },
    ],
  },
];

export default function Sidebar() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`fixed left-0 top-0 h-screen bg-sidebar flex flex-col z-50 transition-all duration-300 ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      {/* Logo */}
      <div className="px-4 py-5 flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-sidebar-primary/20 flex items-center justify-center flex-shrink-0">
          <span className="text-sidebar-primary font-bold text-lg font-display">N</span>
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <h1 className="text-sidebar-foreground font-display font-bold text-lg leading-tight tracking-tight">
              nuVira
            </h1>
            <p className="text-sidebar-foreground/50 text-[10px] uppercase tracking-widest">
              Operations Hub
            </p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 mt-2 overflow-y-auto space-y-4">
        {navGroups.map((group, gi) => (
          <div key={gi}>
            {group.label && !collapsed && (
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/30">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = location.pathname === item.path;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 ${
                      isActive
                        ? "bg-sidebar-accent text-sidebar-primary"
                        : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                    }`}
                  >
                    <Icon className="h-[17px] w-[17px] flex-shrink-0" />
                    {!collapsed && (
                      <span className="text-sm font-medium truncate">{item.label}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="relative">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-0 h-6 w-6 bg-card border border-border rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground shadow-sm transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <ChevronLeft className="h-3 w-3" />
          )}
        </button>
      </div>

      {/* Footer */}
      <div className="px-3 pb-4 pt-2 border-t border-sidebar-border mt-2">
        <button
          onClick={() => base44.auth.logout()}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all w-full"
        >
          <LogOut className="h-[18px] w-[18px] flex-shrink-0" />
          {!collapsed && <span className="text-sm">Sign Out</span>}
        </button>
      </div>
    </aside>
  );
}