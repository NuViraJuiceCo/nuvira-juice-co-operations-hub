import { Link, useLocation } from "react-router-dom";
import { LayoutDashboard, ShoppingCart, Factory, Truck } from "lucide-react";
import MobileMoreMenu from "./MobileMoreMenu";

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/orders", label: "Orders", icon: ShoppingCart },
  { path: "/production", label: "Production", icon: Factory },
  { path: "/fulfillment", label: "Fulfillment", icon: Truck },
];

export default function MobileNav() {
  const location = useLocation();

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border flex items-stretch justify-around z-40"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {navItems.map(item => {
        const Icon = item.icon;
        const isActive = location.pathname === item.path;
        return (
          <Link
            key={item.path}
            to={item.path}
            className={`relative flex-1 flex flex-col items-center justify-center gap-1 py-3 px-1 min-h-[56px] transition-colors ${
              isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-6 w-6 shrink-0" />
            <span className="text-[11px] font-medium leading-tight">{item.label}</span>
            {isActive && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-8 bg-primary rounded-t-full" />}
          </Link>
        );
      })}
      <MobileMoreMenu />
    </nav>
  );
}