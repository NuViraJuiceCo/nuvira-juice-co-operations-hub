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
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-border flex items-center justify-around z-40" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {navItems.map(item => {
        const Icon = item.icon;
        const isActive = location.pathname === item.path;
        return (
          <Link
            key={item.path}
            to={item.path}
            className={`flex-1 flex flex-col items-center justify-center py-2 px-1 min-h-touch transition-colors ${
              isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-5 w-5" />
            <span className="text-[10px] font-medium mt-0.5 leading-tight">{item.label}</span>
          </Link>
        );
      })}
      <MobileMoreMenu />
    </nav>
  );
}