import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, X, ExternalLink, ChevronRight } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { SeverityDot, SeverityBadge } from './AlertBadge';
import moment from 'moment';

export default function AlertsDrawer() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const panelRef = useRef(null);

  const loadAlerts = async () => {
    try {
      const data = await base44.entities.HubAlert.list('-created_date', 30);
      setAlerts(data);
    } catch { /* silent */ }
  };

  useEffect(() => {
    loadAlerts();
    const unsub = base44.entities.HubAlert.subscribe((event) => {
      if (event.type === 'create') setAlerts(prev => [event.data, ...prev].slice(0, 30));
      else if (event.type === 'update') setAlerts(prev => prev.map(a => a.id === event.id ? event.data : a));
      else if (event.type === 'delete') setAlerts(prev => prev.filter(a => a.id !== event.id));
    });
    return unsub;
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const unreadCount = alerts.filter(a => a.status === 'unread').length;
  const active = alerts.filter(a => !['dismissed', 'resolved'].includes(a.status));

  const markRead = async (alert) => {
    if (alert.status !== 'unread') return;
    await base44.entities.HubAlert.update(alert.id, { status: 'read' });
    setAlerts(prev => prev.map(a => a.id === alert.id ? { ...a, status: 'read' } : a));
  };

  const handleViewAll = () => { setOpen(false); navigate('/alerts'); };

  const handleGo = (alert) => {
    setOpen(false);
    markRead(alert);
    if (alert.route) navigate(alert.route);
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => { setOpen(v => !v); if (!open) loadAlerts(); }}
        className="relative p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        aria-label="Alerts"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 w-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-80 sm:w-96 bg-card border border-border rounded-xl shadow-xl z-50 max-h-[80vh] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <h3 className="font-semibold text-foreground text-sm">
              Alerts {unreadCount > 0 && <span className="text-xs text-status-danger ml-1">({unreadCount} unread)</span>}
            </h3>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="overflow-y-auto flex-1">
            {active.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell className="h-8 w-8 text-muted mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No active alerts</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {active.slice(0, 10).map(alert => (
                  <button
                    key={alert.id}
                    onClick={() => { markRead(alert); setOpen(false); navigate('/alerts'); }}
                    className="w-full flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                  >
                    <div className="mt-1.5 shrink-0">
                      <SeverityDot severity={alert.severity} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className={`text-sm font-medium ${alert.status === 'unread' ? 'text-foreground' : 'text-foreground/70'}`}>
                          {alert.title}
                        </p>
                        {alert.status === 'unread' && (
                          <span className="h-1.5 w-1.5 bg-primary rounded-full shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{alert.message}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-muted-foreground/60">
                          {moment(alert.created_date).fromNow()}
                        </span>
                        <span className="text-[10px] text-muted-foreground/40">•</span>
                        <span className="text-[10px] text-muted-foreground/60">{alert.category}</span>
                      </div>
                    </div>
                    {alert.route && (
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 mt-1" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border px-4 py-2.5 shrink-0">
            <button
              onClick={handleViewAll}
              className="w-full flex items-center justify-center gap-1.5 text-sm text-primary font-medium hover:underline"
            >
              View All Alerts <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}