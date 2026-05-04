import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, ShoppingCart, Factory, Truck, Grid3X3 } from "lucide-react";
import MobileMoreSheet from "./MobileMoreSheet";
import { useState } from "react";

const PRIMARY_ROUTES = ["/", "/orders", "/production", "/fulfillment"];

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/orders", label: "Orders", icon: ShoppingCart },
  { path: "/production", label: "Production", icon: Factory },
  { path: "/fulfillment", label: "Fulfillment", icon: Truck },
];

// Routes that belong to "More" — keep More highlighted when on these pages
const MORE_ROUTES = [
  "/calendar", "/events", "/driver-portal",
  "/production-planning", "/prod-scheduler", "/compliance", "/inventory", "/purchase-orders",
  "/loyalty-admin", "/partnerships", "/reporting",
  "/operations-manager", "/resources", "/suppliers",
  "/audit-logs", "/users", "/settings", "/report-scheduler",
  "/stripe-repair", "/order-review-queue", "/compliance-center",
];

export default function MobileNav() {
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const isMoreActive = MORE_ROUTES.some(r => location.pathname.startsWith(r));

  return (
    <>
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur-md border-t border-border z-40"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-stretch">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`relative flex-1 flex flex-col items-center justify-center gap-1 py-3 px-1 min-h-[60px] transition-colors ${
                  isActive ? "text-primary" : "text-foreground/55"
                }`}
              >
                <Icon className={`h-[22px] w-[22px] shrink-0 transition-transform ${isActive ? "scale-110" : ""}`} />
                <span className={`text-[10px] font-medium leading-tight ${isActive ? "font-semibold" : ""}`}>{item.label}</span>
                {isActive && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-10 bg-primary rounded-b-full" />
                )}
              </Link>
            );
          })}

          {/* More tab */}
          <button
            onClick={() => setMoreOpen(true)}
            className={`relative flex-1 flex flex-col items-center justify-center gap-1 py-3 px-1 min-h-[60px] transition-colors ${
              isMoreActive ? "text-primary" : "text-foreground/55"
            }`}
          >
            <Grid3X3 className={`h-[22px] w-[22px] shrink-0 transition-transform ${isMoreActive ? "scale-110" : ""}`} />
            <span className={`text-[10px] font-medium leading-tight ${isMoreActive ? "font-semibold" : ""}`}>More</span>
            {isMoreActive && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-10 bg-primary rounded-b-full" />
            )}
          </button>
        </div>
      </nav>

      <MobileMoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}