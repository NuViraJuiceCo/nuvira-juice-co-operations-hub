import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/lib/AuthContext";
import {
  User, Bell, BookOpen, Activity, Settings, LogOut, ChevronRight,
} from "lucide-react";

const menuItems = [
  {
    label: "Notifications",
    description: "Alerts, sync warnings, and admin notices",
    icon: Bell,
    route: null,
    action: "notifications",
  },
  {
    label: "System Status",
    description: "Stripe, Customer App, and Hub health",
    icon: Activity,
    route: "/operations-manager",
  },
  {
    label: "Settings",
    description: "App preferences and admin settings",
    icon: Settings,
    route: "/settings",
  },
];

export default function AdminProfileMenu({ onOpenAlerts }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const initials = user?.full_name
    ?.split(" ")
    .map(n => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

  const handleItem = (item) => {
    setOpen(false);
    if (item.action === "notifications") {
      onOpenAlerts?.();
      return;
    }
    if (item.route) {
      navigate(item.route);
    }
  };

  return (
    <>
      {/* Avatar trigger — 48px tap target on mobile */}
      <button
        onClick={() => setOpen(true)}
        className="relative z-30 h-11 w-11 sm:h-10 sm:w-10 min-h-touch min-w-touch rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-bold shrink-0 active:scale-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-transform shadow-sm cursor-pointer select-none"
        aria-label="Admin account menu"
        type="button"
      >
        {initials}
      </button>

      {/* Bottom sheet on mobile, same on desktop */}
      <Sheet open={open} onOpenChange={v => setOpen(v)}>
        <SheetContent side="bottom" className="p-0 rounded-t-2xl overflow-hidden">
          {/* Profile header */}
          <div className="flex items-center gap-4 px-5 py-5 border-b border-border bg-muted/30">
            <div className="h-14 w-14 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xl font-bold shrink-0">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-base text-foreground truncate">
                {user?.full_name || "Admin"}
              </p>
              {user?.email && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">{user.email}</p>
              )}
              {user?.role && (
                <span className="inline-block mt-1.5 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold uppercase tracking-wide">
                  {user.role}
                </span>
              )}
            </div>
          </div>

          {/* Menu items */}
          <div className="bg-card divide-y divide-border">
            {menuItems.map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  onClick={() => handleItem(item)}
                  className="w-full flex items-center gap-3.5 px-5 py-4 hover:bg-muted/40 active:bg-muted/60 transition-colors text-left"
                >
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Icon className="h-[18px] w-[18px] text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{item.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                </button>
              );
            })}
          </div>

          {/* Sign out */}
          <div className="px-4 py-4 border-t border-border">
            <button
              onClick={() => { setOpen(false); logout(); }}
              className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl bg-red-50 hover:bg-red-100 active:bg-red-200 transition-colors text-left"
            >
              <div className="h-9 w-9 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                <LogOut className="h-[18px] w-[18px] text-red-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-red-600">Sign Out</p>
                <p className="text-xs text-muted-foreground">End the current admin session</p>
              </div>
            </button>
          </div>

          {/* Safe area spacer */}
          <div style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} />
        </SheetContent>
      </Sheet>
    </>
  );
}