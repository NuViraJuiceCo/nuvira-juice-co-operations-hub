import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { RefreshCw, MapPin, CheckCircle2, XCircle, Clock, Package, Users, AlertTriangle } from 'lucide-react';
import ApprovalRequestCard from '../components/zone3/ApprovalRequestCard';
import ApproveRequestModal from '../components/zone3/ApproveRequestModal';
import DenyRequestModal from '../components/zone3/DenyRequestModal';
import { useToast } from '@/components/ui/use-toast';
import moment from 'moment';

const TABS = [
  { id: 'pending_review', label: 'Pending Review', icon: Clock, color: 'text-amber-600' },
  { id: 'approved', label: 'Approved', icon: CheckCircle2, color: 'text-green-600' },
  { id: 'captured', label: 'Captured Orders', icon: Package, color: 'text-blue-600' },
  { id: 'denied', label: 'Denied', icon: XCircle, color: 'text-red-600' },
  { id: 'expired', label: 'Expired', icon: AlertTriangle, color: 'text-gray-500' },
  { id: 'waitlist', label: 'Waitlist', icon: Users, color: 'text-purple-600' },
];

export default function DeliveryRouteReviews() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('pending_review');
  const [requests, setRequests] = useState([]);
  const [waitlist, setWaitlist] = useState([]);
  const [loading, setLoading] = useState(true);
  const [approvingRequest, setApprovingRequest] = useState(null);
  const [denyingRequest, setDenyingRequest] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [reqs, wl] = await Promise.all([
        base44.entities.DeliveryApprovalRequest.list('-created_date', 200),
        base44.entities.Zone3Waitlist.list('-created_date', 100),
      ]);
      setRequests(reqs || []);
      setWaitlist(wl || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (user?.role !== 'admin') {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Admin access required.</p>
      </div>
    );
  }

  const filtered = activeTab === 'waitlist'
    ? []
    : requests.filter(r => r.status === activeTab);

  const pendingCount = requests.filter(r => r.status === 'pending_review').length;

  const handleApproveSuccess = (result) => {
    setApprovingRequest(null);
    toast({ title: 'Approved & Captured', description: `Order ${result.hub_order_number} created. $${result.amount_captured} captured.` });
    load();
  };

  const handleDenySuccess = (result) => {
    setDenyingRequest(null);
    toast({ title: 'Request Denied', description: result.waitlist_id ? 'Customer added to waitlist.' : 'Authorization released.' });
    load();
  };

  return (
    <div className="space-y-5 p-4 sm:p-6 lg:p-8 w-full overflow-x-hidden" style={{ paddingBottom: 'calc(90px + env(safe-area-inset-bottom))' }}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" />
            <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Delivery Route Reviews</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Zone 3 extended delivery requests requiring admin approval before capture.
          </p>
        </div>
        <Button onClick={load} disabled={loading} variant="outline" size="sm" className="gap-2 self-start">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Summary pills */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {TABS.map(tab => {
          const count = tab.id === 'waitlist' ? waitlist.length : requests.filter(r => r.status === tab.id).length;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-center transition-all ${
                activeTab === tab.id
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'bg-card border-border hover:bg-muted/30'
              }`}
            >
              <Icon className={`w-4 h-4 mb-1 ${activeTab === tab.id ? 'text-primary-foreground' : tab.color}`} />
              <span className="text-lg font-bold leading-tight">{count}</span>
              <span className="text-[9px] font-medium leading-tight mt-0.5 opacity-80">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b overflow-x-auto scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const count = tab.id === 'waitlist' ? waitlist.length : requests.filter(r => r.status === tab.id).length;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-xs sm:text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${activeTab === tab.id ? 'text-primary' : tab.color}`} />
              {tab.label}
              {count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                  activeTab === tab.id ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                }`}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
        </div>
      ) : activeTab === 'waitlist' ? (
        <WaitlistSection waitlist={waitlist} onRefresh={load} />
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-base font-medium">No {TABS.find(t => t.id === activeTab)?.label.toLowerCase()} requests.</p>
          {activeTab === 'pending_review' && (
            <p className="text-sm mt-1">New Zone 3 requests from the Customer App will appear here.</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {activeTab === 'pending_review' && pendingCount > 0 && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <p><strong>{pendingCount} request{pendingCount > 1 ? 's' : ''}</strong> pending admin review. Payment authorization holds will expire — review promptly.</p>
            </div>
          )}
          {filtered.map(req => (
            <ApprovalRequestCard
              key={req.id}
              request={req}
              onApprove={setApprovingRequest}
              onDeny={setDenyingRequest}
              readOnly={activeTab !== 'pending_review'}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {approvingRequest && (
        <ApproveRequestModal
          request={approvingRequest}
          onClose={() => setApprovingRequest(null)}
          onSuccess={handleApproveSuccess}
        />
      )}
      {denyingRequest && (
        <DenyRequestModal
          request={denyingRequest}
          onClose={() => setDenyingRequest(null)}
          onSuccess={handleDenySuccess}
        />
      )}
    </div>
  );
}

function WaitlistSection({ waitlist, onRefresh }) {
  const [updating, setUpdating] = useState(null);

  const statusColors = {
    active: 'bg-green-100 text-green-800',
    contacted: 'bg-blue-100 text-blue-800',
    converted: 'bg-purple-100 text-purple-800',
    removed: 'bg-gray-100 text-gray-700',
  };

  const handleStatusChange = async (entry, newStatus) => {
    setUpdating(entry.id);
    await base44.entities.Zone3Waitlist.update(entry.id, { status: newStatus });
    setUpdating(null);
    onRefresh();
  };

  if (waitlist.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p className="text-base font-medium">Waitlist is empty.</p>
        <p className="text-sm mt-1">Customers denied from Zone 3 will appear here if added to waitlist.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {waitlist.map(entry => (
        <div key={entry.id} className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <p className="font-semibold text-sm">{entry.customer_name}</p>
              <p className="text-xs text-muted-foreground">{entry.customer_email}</p>
            </div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColors[entry.status] || 'bg-muted text-muted-foreground'}`}>
              {(entry.status || '').toUpperCase()}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-1">{entry.delivery_address}</p>
          {entry.zone_name && <p className="text-xs text-purple-700 font-medium">{entry.zone_name} · {entry.estimated_distance_miles} mi</p>}
          {entry.denial_reason && (
            <p className="text-xs text-muted-foreground mt-1.5"><span className="font-medium">Denied: </span>{entry.denial_reason}</p>
          )}
          {entry.notes && (
            <p className="text-xs text-muted-foreground mt-1"><span className="font-medium">Notes: </span>{entry.notes}</p>
          )}
          <p className="text-[10px] text-muted-foreground mt-1">Added {moment(entry.created_date).format('MMM D, YYYY')}</p>
          {entry.status !== 'removed' && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {entry.status !== 'contacted' && (
                <Button size="sm" variant="outline" disabled={updating === entry.id} onClick={() => handleStatusChange(entry, 'contacted')}
                  className="text-xs h-7 px-2.5 text-blue-700 border-blue-200 hover:bg-blue-50">
                  Mark Contacted
                </Button>
              )}
              {entry.status !== 'converted' && (
                <Button size="sm" variant="outline" disabled={updating === entry.id} onClick={() => handleStatusChange(entry, 'converted')}
                  className="text-xs h-7 px-2.5 text-purple-700 border-purple-200 hover:bg-purple-50">
                  Mark Converted
                </Button>
              )}
              {entry.status !== 'active' && (
                <Button size="sm" variant="outline" disabled={updating === entry.id} onClick={() => handleStatusChange(entry, 'active')}
                  className="text-xs h-7 px-2.5">
                  Reset to Active
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={updating === entry.id} onClick={() => handleStatusChange(entry, 'removed')}
                className="text-xs h-7 px-2.5 text-red-600 border-red-200 hover:bg-red-50">
                Remove
              </Button>
            </div>
          )}
          {entry.status === 'removed' && (
            <Button size="sm" variant="outline" disabled={updating === entry.id} onClick={() => handleStatusChange(entry, 'active')}
              className="text-xs h-7 px-2.5 mt-3">
              Restore
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}