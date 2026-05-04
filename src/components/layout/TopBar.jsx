import { useState, useEffect, useRef } from "react";
import { ArrowLeft, Menu } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";

import AdminProfileMenu from "./AdminProfileMenu";
import GlobalSearch from "@/components/search/GlobalSearch";
import AlertsDrawer from "@/components/alerts/AlertsDrawer";


export default function TopBar({ onMenuClick }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isRootPage = location.pathname === "/";
  const [showPanel, setShowPanel] = useState(false);
  const panelRef = useRef(null);

  // (alert subscriptions handled by AlertsDrawer)



  return (
    <header className="sticky top-0 z-30 h-14 bg-background/95 backdrop-blur border-b border-border flex items-center px-3 gap-2">
      {/* Back button — mobile, non-root pages */}
      {!isRootPage ? (
        <button
          onClick={() => {
            if (window.history.length > 1) {
              navigate(-1);
            } else {
              navigate("/");
            }
          }}
          className="lg:hidden flex items-center justify-center h-12 w-12 min-h-touch min-w-touch rounded-xl hover:bg-muted active:bg-muted/80 transition-colors text-muted-foreground -ml-1"
          aria-label="Go back"
        >
          <ArrowLeft className="h-7 w-7" />
        </button>
      ) : (
        /* Desktop hamburger — hidden on mobile since bottom nav handles it */
        <button
          onClick={onMenuClick}
          className="hidden lg:flex items-center justify-center h-9 w-9 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}

      {/* Brand — mobile */}
      <span className="lg:hidden font-display font-bold text-primary text-lg">nuVira</span>

      {/* Global Search — desktop inline bar (hidden on mobile, handled by icon below) */}
      <GlobalSearch mobile={false} />

      <div className="flex-1" />

      {/* Mobile Search icon */}
      <div className="lg:hidden">
        <GlobalSearch mobile={true} />
      </div>

      {/* Alerts Bell — powered by AlertsDrawer */}
      <AlertsDrawer />

      {/* Admin profile menu */}
      <AdminProfileMenu onOpenAlerts={() => {}} />
    </header>
  );
}