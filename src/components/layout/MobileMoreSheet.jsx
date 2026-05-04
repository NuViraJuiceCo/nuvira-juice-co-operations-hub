import { Link } from "react-router-dom";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/lib/AuthContext";
import {
  CalendarDays, CalendarCheck, Truck, FlaskConical, ClipboardList,
  ShieldCheck, Package, ShoppingBag, Gift, Handshake, BarChart3,
  Activity, Wrench, LogOut, ChevronRight, X, Users, ScrollText,
  FileBarChart, Settings, Zap, AlertCircle, Bell,
} from "lucide-react";

const sections = [
  {
    title: "Daily Operations",
    items: [
      { label: "Calendar", route: "/calendar", icon: CalendarDays, description: "Production, delivery, and event dates" },
      { label: "Events", route: "/events", icon: CalendarCheck, description: "Samplings, pop-ups, and activations" },
      { label: "Driver Portal", route: "/driver-portal", icon: Truck, description: "Delivery routes and driver workflows" },
    ],
  },
  {
    title: "Production + Compliance",
    items: [
      { label: "Production Planning", route: "/production-planning", icon: FlaskConical, description: "Plan upcoming batches and production needs" },
      { label: "Prod. Scheduler", route: "/prod-scheduler", icon: ClipboardList, description: "Manage production timing and schedules" },
      { label: "Compliance Logs", route: "/compliance", icon: ShieldCheck, description: "Batch, sanitation, CCP, and binder records" },
      { label: "Inventory", route: "/inventory", icon: Package, description: "Track ingredients, supplies, and stock" },
      { label: "Purchase Orders", route: "/purchase-orders", icon: ShoppingBag, description: "Manage sourcing and purchase needs" },
    ],
  },
  {
    title: "Business + Customers",
    items: [
      { label: "Loyalty Dashboard", route: "/loyalty-admin", icon: Gift, description: "Customer rewards and point balances" },
      { label: "Partnerships", route: "/partnerships", icon: Handshake, description: "Partner locations and opportunities" },
      { label: "Reporting", route: "/reporting", icon: BarChart3, description: "Performance and business metrics" },
      { label: "Suppliers", route: "/suppliers", icon: Users, description: "Manage vendor and supplier relationships" },
    ],
  },
  {
    title: "System",
    items: [
      { label: "Alerts & Notifications", route: "/alerts", icon: Bell, description: "View and manage system alerts" },
      { label: "Operations Manager", route: "/operations-manager", icon: Activity, description: "Internal operations controls" },
      { label: "Resources", route: "/resources", icon: Wrench, description: "Guides, references, and internal docs" },
      { label: "Settings", route: "/settings", icon: Settings, description: "App and account preferences" },
      { label: "Audit Logs", route: "/audit-logs", icon: ScrollText, description: "Review system and admin activity" },
      { label: "Order Review Queue", route: "/order-review-queue", icon: AlertCircle, description: "Review flagged or pending orders" },
      { label: "Stripe Recovery", route: "/stripe-repair", icon: Zap, description: "Repair and recover Stripe data" },
      { label: "User Management", route: "/users", icon: Users, description: "Manage admin and staff accounts" },
      { label: "Reports", route: "/report-scheduler", icon: FileBarChart, description: "Scheduled and generated reports" },
    ],
  },
];

export default function MobileMoreSheet({ open, onClose }) {
  const { logout } = useAuth();

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent
        side="bottom"
        className="h-[92vh] p-0 rounded-t-2xl overflow-hidden flex flex-col [&>button]:hidden"
      >
        {/* Header — single close control (SheetContent's built-in X is hidden via [&>button]:hidden) */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border shrink-0">
          <div>
            <h2 className="text-base font-bold text-foreground">More</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Operations, compliance, and admin tools</p>
          </div>
          <button
            onClick={onClose}
            className="h-11 w-11 min-h-touch min-w-touch rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground active:bg-muted/80 transition-colors"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5 pb-6">
          {sections.map(section => (
            <div key={section.title}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 px-1 mb-2">
                {section.title}
              </p>
              <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
                {section.items.map(item => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.route}
                      to={item.route}
                      onClick={onClose}
                      className="flex items-center gap-3.5 px-4 py-3.5 hover:bg-muted/40 active:bg-muted/60 transition-colors"
                    >
                      <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Icon className="h-4.5 w-4.5 text-primary" style={{ height: '18px', width: '18px' }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground leading-tight">{item.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{item.description}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Sign Out */}
          <div>
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <button
                onClick={() => { onClose(); logout(); }}
                className="w-full flex items-center gap-3.5 px-4 py-3.5 hover:bg-red-50 active:bg-red-100 transition-colors text-left"
              >
                <div className="h-9 w-9 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                  <LogOut className="h-[18px] w-[18px] text-red-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-red-600 leading-tight">Sign Out</p>
                  <p className="text-xs text-muted-foreground mt-0.5">End the current admin session</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}