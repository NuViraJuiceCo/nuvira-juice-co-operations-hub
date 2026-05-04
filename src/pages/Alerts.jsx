import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Bell, Search, X, ExternalLink, ChevronDown, ChevronUp, AlertTriangle, Info, AlertCircle, CheckCircle2, Eye } from 'lucide-react';
import { SeverityBadge, StatusBadge, SeverityDot } from '@/components/alerts/AlertBadge';
import moment from 'moment';

const CATEGORIES = ['All', 'Orders', 'Payments', 'Subscriptions', 'Production', 'Compliance', 'Delivery', 'Loyalty', 'Events', 'Inventory', 'Sync', 'System', 'Security'];
const STATUS_FILTERS = ['All', 'Unread', 'Critical', 'Warning', 'Info', 'Acknowledged', 'Resolved', 'Dismissed'];

function AlertDetailPanel({ alert, onClose, onAction, currentUser }) {
  const [notes, setNotes] = useState('');
  const [acting, setActing] = useState(null);

  const act = async (type) => {
    setActing(type);
    const now = new Date().toISOString();
    const email = currentUser?.email || 'admin';
    const updates = {
      acknowledge: { status: 'acknowledged', acknowledged_by: email, acknowledged_at: now },
      resolve: { status: 'resolved', resolved_by: email, resolved_at: now, resolution_notes: notes || undefined },
      dismiss: { status: 'dismissed', dismissed_by: email, dismissed_at: now },
      read: { status: 'read' },
    }[type];
    if (updates) {
      await base44.entities.HubAlert.update(alert.id, updates);
      onAction({ ...alert, ...updates });
    }
    setActing(null);
    if (type !== 'read') onClose();
  };

  const SeverityIcon = alert.severity === 'critical' ? AlertCircle : alert.severity === 'warning' ? AlertTriangle : Info;
  const severityColor = alert.severity === 'critical' ? 'text-status-danger' : alert.severity === 'warning' ? 'text-status-warning' : 'text-status-info';

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-card w-full sm:max-w-lg rounded-t-2xl sm:rounded-xl border border-border shadow-2xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-border shrink-0">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <SeverityIcon className={`h-5 w-5 shrink-0 mt-0.5 ${severityColor}`} />
            <div className="min-w-0">
              <h2 className="font-bold text-foreground text-base leading-snug">{alert.title}</h2>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                <SeverityBadge severity={alert.severity} />
                <StatusBadge status={alert.status} />
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{alert.category}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0 p-1"><X className="h-4 w-4" /></button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Message</p>
            <p className="text-sm text-foreground leading-relaxed">{alert.message}</p>
          </div>

          {alert.recommended_action && (
            <div className="bg-status-info-bg border border-status-info-border rounded-lg px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-status-info mb-1">Recommended Action</p>
              <p className="text-sm text-foreground">{alert.recommended_action}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-xs">
            {alert.source && (
              <div><p className="text-muted-foreground font-semibold uppercase tracking-wide mb-0.5">Source</p><p className="text-foreground">{alert.source}</p></div>
            )}
            {alert.related_display_id && (
              <div><p className="text-muted-foreground font-semibold uppercase tracking-wide mb-0.5">Related Record</p><p className="text-foreground font-mono">{alert.related_display_id}</p></div>
            )}
            <div><p className="text-muted-foreground font-semibold uppercase tracking-wide mb-0.5">Created</p><p className="text-foreground">{moment(alert.created_date).format('MMM D, YYYY h:mm A')}</p></div>
            {alert.related_record_type && (
              <div><p className="text-muted-foreground font-semibold uppercase tracking-wide mb-0.5">Record Type</p><p className="text-foreground">{alert.related_record_type}</p></div>
            )}
          </div>

          {/* Audit trail */}
          {(alert.acknowledged_by || alert.resolved_by || alert.dismissed_by) && (
            <div className="border border-border rounded-lg px-4 py-3 space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Audit Trail</p>
              {alert.acknowledged_by && <p className="text-xs text-foreground">Acknowledged by <span className="font-medium">{alert.acknowledged_by}</span> on {moment(alert.acknowledged_at).format('MMM D, h:mm A')}</p>}
              {alert.resolved_by && <p className="text-xs text-foreground">Resolved by <span className="font-medium">{alert.resolved_by}</span> on {moment(alert.resolved_at).format('MMM D, h:mm A')}</p>}
              {alert.dismissed_by && <p className="text-xs text-foreground">Dismissed by <span className="font-medium">{alert.dismissed_by}</span></p>}
              {alert.resolution_notes && <p className="text-xs text-muted-foreground mt-1 italic">"{alert.resolution_notes}"</p>}
            </div>
          )}

          {/* Resolve notes */}
          {!['resolved', 'dismissed'].includes(alert.status) && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Resolution Notes (optional)</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Describe how the issue was resolved..."
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm bg-background resize-none" />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-5 py-4 border-t border-border shrink-0 flex flex-wrap gap-2">
          {alert.route && (
            <Button size="sm" className="gap-1.5" onClick={() => { onClose(); window.location.href = alert.route; }}>
              <ExternalLink className="h-3.5 w-3.5" /> Go To Record
            </Button>
          )}
          {alert.status === 'unread' && (
            <Button size="sm" variant="outline" onClick={() => act('read')} disabled={acting === 'read'}>Mark Read</Button>
          )}
          {!['acknowledged', 'resolved', 'dismissed'].includes(alert.status) && (
            <Button size="sm" variant="outline" onClick={() => act('acknowledge')} disabled={!!acting}>Acknowledge</Button>
          )}
          {!['resolved', 'dismissed'].includes(alert.status) && (
            <Button size="sm" variant="outline" onClick={() => act('resolve')} disabled={!!acting}>
              {acting === 'resolve' ? 'Resolving...' : 'Resolve'}
            </Button>
          )}
          {alert.status !== 'dismissed' && (
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => act('dismiss')} disabled={!!acting}>Dismiss</Button>
          )}
        </div>
      </div>
    </div>
  );
}

function AlertCard({ alert, onClick }) {
  const SeverityIcon = alert.severity === 'critical' ? AlertCircle : alert.severity === 'warning' ? AlertTriangle : Info;
  const isUnread = alert.status === 'unread';

  return (
    <button
      onClick={() => onClick(alert)}
      className={`w-full text-left rounded-xl border transition-all hover:shadow-sm hover:border-primary/30 active:scale-[0.99] ${isUnread ? 'bg-card border-primary/20' : 'bg-card border-border'}`}
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        <div className="mt-0.5 shrink-0">
          <SeverityDot severity={alert.severity} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
            <span className={`text-sm font-semibold leading-tight ${isUnread ? 'text-foreground' : 'text-foreground/80'}`}>{alert.title}</span>
            {isUnread && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{alert.message}</p>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <SeverityBadge severity={alert.severity} />
            <StatusBadge status={alert.status} />
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{alert.category}</span>
            <span className="text-[10px] text-muted-foreground/60 ml-auto">{moment(alert.created_date).fromNow()}</span>
          </div>
          {alert.related_display_id && (
            <p className="text-[10px] font-mono text-muted-foreground mt-1">→ {alert.related_display_id}</p>
          )}
        </div>
        <Eye className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-0.5" />
      </div>
    </button>
  );
}

export default function Alerts() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selected, setSelected] = useState(null);
  const [showFilters, setShowFilters] = useState(false);

  const { data: alerts = [], isLoading, refetch } = useQuery({
    queryKey: ['hub_alerts'],
    queryFn: () => base44.entities.HubAlert.list('-created_date', 200),
    staleTime: 30_000,
  });

  // Real-time updates
  useEffect(() => {
    const unsub = base44.entities.HubAlert.subscribe((event) => {
      qc.invalidateQueries({ queryKey: ['hub_alerts'] });
    });
    return unsub;
  }, [qc]);

  const filtered = alerts.filter(a => {
    const lq = query.toLowerCase();
    if (lq && ![ a.title, a.message, a.category, a.severity, a.related_display_id, a.source, a.status ].some(f => (f || '').toLowerCase().includes(lq))) return false;
    if (statusFilter === 'Unread' && a.status !== 'unread') return false;
    if (statusFilter === 'Critical' && a.severity !== 'critical') return false;
    if (statusFilter === 'Warning' && a.severity !== 'warning') return false;
    if (statusFilter === 'Info' && a.severity !== 'info') return false;
    if (statusFilter === 'Acknowledged' && a.status !== 'acknowledged') return false;
    if (statusFilter === 'Resolved' && a.status !== 'resolved') return false;
    if (statusFilter === 'Dismissed' && a.status !== 'dismissed') return false;
    if (categoryFilter !== 'All' && a.category !== categoryFilter) return false;
    if (startDate && a.created_date && a.created_date.slice(0, 10) < startDate) return false;
    if (endDate && a.created_date && a.created_date.slice(0, 10) > endDate) return false;
    return true;
  });

  const unreadCount = alerts.filter(a => a.status === 'unread').length;
  const criticalCount = alerts.filter(a => a.severity === 'critical' && !['resolved', 'dismissed'].includes(a.status)).length;

  const handleAction = (updated) => {
    qc.invalidateQueries({ queryKey: ['hub_alerts'] });
    setSelected(updated);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card px-4 sm:px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-status-danger-bg flex items-center justify-center">
                <Bell className="h-5 w-5 text-status-danger" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">Alerts & Notifications</h1>
                <p className="text-xs text-muted-foreground">
                  {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
                  {criticalCount > 0 && ` · ${criticalCount} critical`}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="shrink-0">Refresh</Button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 space-y-4">
        {/* Search + filter bar */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search alerts..."
              className="w-full pl-9 pr-4 py-2 border border-border rounded-lg text-sm bg-background"
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowFilters(f => !f)} className="gap-1.5 shrink-0">
            Filters {showFilters ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        </div>

        {/* Status filter pills */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {STATUS_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`shrink-0 text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${
                statusFilter === f ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:text-foreground'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Extended filters */}
        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 border border-border rounded-xl bg-card">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Category</label>
              <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm bg-background">
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">From Date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">To Date</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" />
            </div>
          </div>
        )}

        {/* Results */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <CheckCircle2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground">No alerts match your filters</p>
            <p className="text-xs text-muted-foreground mt-1">Try adjusting the search or filter criteria</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{filtered.length} alert{filtered.length !== 1 ? 's' : ''}</p>
            {filtered.map(alert => (
              <AlertCard key={alert.id} alert={alert} onClick={setSelected} />
            ))}
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <AlertDetailPanel
          alert={selected}
          onClose={() => setSelected(null)}
          onAction={handleAction}
          currentUser={user}
        />
      )}
    </div>
  );
}