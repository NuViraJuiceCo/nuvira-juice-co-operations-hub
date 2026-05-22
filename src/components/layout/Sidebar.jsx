import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard, BarChart3, ChevronLeft, ChevronRight, LogOut,
  ShoppingCart, Factory, Truck, CalendarDays, Package, Users,
  ShieldCheck, Wrench, CalendarCheck, Handshake, ClipboardList,
  ShoppingBag, Route, UserCog, ScrollText, FileBarChart, X, Settings, Gift, FlaskConical, AlertCircle, Bell, MapPin,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/lib/AuthContext";

const navGroups = [
  {
    label: null,
    items: [
      { path: "/", label: "Dashboard", icon: LayoutDashboard },
      { path: "/calendar", label: "Calendar", icon: CalendarDays },
      { path: "/compliance", label: "Compliance Logs", icon: ShieldCheck },
      { path: "/driver-portal", label: "Driver Portal", icon: Truck },
      { path: "/events", label: "Events", icon: CalendarCheck },
      { path: "/fulfillment", label: "Fulfillment", icon: Truck },
      { path: "/inventory", label: "Inventory", icon: Package },
      { path: "/loyalty-admin", label: "Loyalty Dashboard", icon: Gift },
      { path: "/orders", label: "Orders", icon: ShoppingCart },
      { path: "/partnerships", label: "Partnerships", icon: Handshake },
      { path: "/prod-scheduler", label: "Prod. Scheduler", icon: ClipboardList },
      { path: "/production", label: "Production", icon: Factory },
      { path: "/production-planning", label: "Production Planning", icon: FlaskConical },
      { path: "/purchase-orders", label: "Purchase Orders", icon: ShoppingBag },
      { path: "/reporting", label: "Reporting", icon: BarChart3 },
      { path: "/resources", label: "Resources", icon: Wrench },
      { path: "/suppliers", label: "Suppliers", icon: Users },
    ],
  },
  {
    label: "Admin",
    items: [
      { path: "/delivery-route-reviews", label: "Route Reviews", icon: MapPin },
      { path: "/alerts", label: "Alerts", icon: Bell },
      { path: "/audit-logs", label: "Audit Logs", icon: ScrollText },
      { path: "/order-review-queue", label: "Order Review Queue", icon: AlertCircle },
      { path: "/report-scheduler", label: "Reports", icon: FileBarChart },
      { path: "/settings", label: "Settings", icon: Settings },
      { path: "/users", label: "User Management", icon: UserCog },
      { path: "/pos-validation", label: "POS Validation", icon: Route },
    ],
  },
];

export default function Sidebar({ open, onClose }) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const { logout } = useAuth();

  const NavLink = ({ item }) => {
    const isActive = location.pathname === item.path;
    const Icon = item.icon;
    return (
      <Link
        to={item.path}
        onClick={onClose}
        className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 ${
          isActive
            ? "bg-sidebar-accent text-sidebar-primary"
            : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
        }`}
      >
        <Icon className="h-[17px] w-[17px] flex-shrink-0" />
        {!collapsed && <span className="text-sm font-medium truncate">{item.label}</span>}
      </Link>
    );
  };

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex fixed left-0 top-0 h-screen bg-sidebar flex-col z-50 transition-all duration-300 ${
          collapsed ? "w-16" : "w-56"
        }`}
      >
        <SidebarContent
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          navGroups={navGroups}
          NavLink={NavLink}
          showCollapseBtn
          onSignOut={logout}
        />
      </aside>

      {/* Mobile/Tablet drawer */}
      <aside
        className={`lg:hidden fixed left-0 top-0 h-screen w-64 bg-sidebar flex flex-col z-50 transition-transform duration-300 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <SidebarContent
          collapsed={false}
          setCollapsed={() => {}}
          navGroups={navGroups}
          NavLink={NavLink}
          showCloseBtn
          onClose={onClose}
          onSignOut={logout}
        />
      </aside>
    </>
  );
}

function SidebarContent({ collapsed, setCollapsed, navGroups, NavLink, showCollapseBtn, showCloseBtn, onClose, onSignOut }) {
  return (
    <>
      {/* Logo */}
      <div className="mx-4 mt-4 px-4 py-5 rounded-lg bg-sidebar-accent/30 flex items-center gap-3">
        <img src="https://media.base44.com/images/public/69da9e8036b037ad40a9a73f/2510179e6_IMG_5717.png" alt="nuVira" className="h-9 w-auto flex-shrink-0 rounded-md" />
        {!collapsed && (
          <div className="overflow-hidden flex-1">
            <h1 className="text-sidebar-foreground font-display font-bold text-sm leading-tight tracking-tight">
              nuVira Juice Co.
            </h1>
            <p className="text-sidebar-foreground/50 text-[10px] uppercase tracking-widest">
              Operations Hub
            </p>
          </div>
        )}
        {showCloseBtn && (
          <button onClick={onClose} className="ml-auto text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors p-1">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 mt-2 overflow-y-auto space-y-4 pb-4">
        {navGroups.map((group, gi) => (
          <div key={gi}>
            {group.label && !collapsed && (
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/30">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map(item => <NavLink key={item.path} item={item} />)}
            </div>
          </div>
        ))}
      </nav>

      {/* Collapse toggle — desktop only */}
      {showCollapseBtn && (
        <div className="relative px-3 py-1">
          <button
            onClick={() => setCollapsed(c => !c)}
            className="w-full flex items-center justify-center gap-2 py-2 text-xs text-sidebar-foreground/40 hover:text-sidebar-foreground transition-colors"
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <><ChevronLeft className="h-3.5 w-3.5" /><span>Collapse</span></>}
          </button>
        </div>
      )}

      {/* Footer */}
      <div className="px-3 pb-4 pt-2 border-t border-sidebar-border">
        <button
          onClick={() => onSignOut(true)}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all w-full"
        >
          <LogOut className="h-[18px] w-[18px] flex-shrink-0" />
          {!collapsed && <span className="text-sm">Sign Out</span>}
        </button>
      </div>
    </>
  );
}
