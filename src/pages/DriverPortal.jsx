import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { format } from 'date-fns';
import { Recycle, CheckCircle2, Package, AlertCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import PreOptimizeOrderCard from '@/components/driver/PreOptimizeOrderCard';

export default function DriverPortal() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('route');
  const [syncing, setSyncing] = useState(false);

  const isAuthorized = user?.role === 'driver' || user?.role === 'admin';

  const { data: bagReturns = [], isLoading: returnsLoading } = useQuery({
    queryKey: ['driver-bag-returns'],
    queryFn: () => base44.entities.BagReturn.list('-created_date', 200),
    enabled: isAuthorized,
    refetchInterval: 30000,
  });

  const { data: allCredits = [] } = useQuery({
    queryKey: ['driver-all-credits'],
    queryFn: () => base44.entities.NuViraCredit.list('-created_date', 500),
    enabled: isAuthorized,
  });

  const { data: orders = [], isLoading: ordersLoading } = useQuery({
    queryKey: ['driver-queued-orders'],
    queryFn: () => base44.entities.Order.filter({ fulfillment_type: 'delivery', status: { $nin: ['delivered', 'picked_up'] } }),
    enabled: isAuthorized,
    refetchInterval: 60000,
  });

  const verifyMutation = useMutation({
    mutationFn: async ({ ret, data }) => {
      await base44.entities.BagReturn.update(ret.id, { ...data, sync_status: 'pending' });

      if (data.credit_issued > 0) {
        const existing = allCredits.find(c => c.customer_email === ret.customer_email);
        const entry = {
          amount: data.credit_issued,
          type: 'issued',
          description: `Return + Reward${data.verification_status === 'partially_verified' ? ' (Partial)' : ''}`,
          order_id: ret.order_id,
          timestamp: new Date().toISOString(),
        };

        if (existing) {
          await base44.entities.NuViraCredit.update(existing.id, {
            balance: (existing.balance || 0) + data.credit_issued,
            lifetime_issued: (existing.lifetime_issued || 0) + data.credit_issued,
            history: [...(existing.history || []), entry],
          });
        } else {
          await base44.entities.NuViraCredit.create({
            customer_email: ret.customer_email,
            balance: data.credit_issued,
            lifetime_issued: data.credit_issued,
            history: [entry],
          });
        }
      }

      // Trigger sync to customer app
      await base44.functions.invoke('syncBagReturnToCustomerApp', {
        bagReturnId: ret.id,
        returnData: { ...ret, ...data },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['driver-bag-returns'] });
      queryClient.invalidateQueries({ queryKey: ['driver-all-credits'] });
      toast.success('Bag return verified & synced to customer app');
    },
    onError: (error) => {
      console.error('Verification error:', error);
      toast.error('Failed to verify bag return');
    },
  });

  const pendingReturns = bagReturns.filter(r => r.verification_status === 'requested');
  const todayDone = bagReturns.filter(
    r => r.verification_status !== 'requested' && r.verified_at?.startsWith(new Date().toISOString().slice(0, 10))
  ).length;

  const handleBagReturnVerified = (ret, data) => {
    verifyMutation.mutate({ ret, data });
  };

  const handleSyncOrders = async () => {
    setSyncing(true);
    try {
      await base44.functions.invoke('pullOrdersFromCustomerApp', {});
      queryClient.invalidateQueries({ queryKey: ['driver-queued-orders'] });
      toast.success('Orders synced from customer app');
    } catch (error) {
      console.error('Sync error:', error);
      toast.error('Failed to sync orders');
    }
    setSyncing(false);
  };

  // Map pending returns by customer email for quick lookup
  const pendingReturnsByEmail = {};
  bagReturns.forEach(r => {
    if (r.verification_status === 'requested' && !pendingReturnsByEmail[r.customer_email]) {
      pendingReturnsByEmail[r.customer_email] = r;
    }
  });

  if (!isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-3" />
          <p className="text-lg font-semibold">Access Denied</p>
          <p className="text-sm text-muted-foreground mt-1">Only drivers can access this portal.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-card border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold">Driver Portal</h1>
          <p className="text-sm text-muted-foreground mt-1">Welcome, {user?.full_name || user?.email}</p>
        </div>

        {/* Tabs */}
        <div className="border-t border-border flex items-center">
          <button
            onClick={() => setTab('route')}
            className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-colors ${
              tab === 'route'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Route ({orders.length})
          </button>
          <button
            onClick={() => setTab('returns')}
            className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-colors ${
              tab === 'returns'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Returns ({pendingReturns.length})
          </button>
          <button
            onClick={handleSyncOrders}
            disabled={syncing}
            className="px-4 py-3 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Sync orders from customer app"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        {tab === 'route' && (
          <div className="space-y-4">
            {ordersLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : orders.length === 0 ? (
              <div className="text-center py-16">
                <CheckCircle2 className="w-10 h-10 text-primary mx-auto mb-3" />
                <p className="text-sm font-semibold">All deliveries completed</p>
              </div>
            ) : (
              orders.map(order => (
                <PreOptimizeOrderCard
                  key={order.id}
                  order={order}
                  pendingReturn={pendingReturnsByEmail[order.customer_email] || null}
                  onVerifyReturn={handleBagReturnVerified}
                  user={user}
                  isUpdating={false}
                />
              ))
            )}
          </div>
        )}

        {tab === 'returns' && (
          <div className="space-y-4">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Pending', value: pendingReturns.length, color: 'text-amber-600' },
                { label: 'Done Today', value: todayDone, color: 'text-primary' },
                { label: 'Total Done', value: bagReturns.filter(r => r.verification_status !== 'requested').length, color: 'text-foreground' },
              ].map(s => (
                <div key={s.label} className="bg-card border border-border rounded-xl p-4 text-center">
                  <p className={`text-2xl font-bold font-heading ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Returns list */}
            <div className="space-y-2">
              {returnsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : pendingReturns.length === 0 ? (
                <div className="text-center py-12 bg-card border border-border rounded-xl">
                  <Recycle className="w-10 h-10 text-primary mx-auto mb-3" />
                  <p className="text-sm font-semibold">All caught up</p>
                  <p className="text-xs text-muted-foreground mt-1">No pending bag returns</p>
                </div>
              ) : (
                pendingReturns.map(ret => (
                  <div key={ret.id} className="bg-card border border-amber-300 rounded-xl p-4">
                    <div className="flex items-center gap-3">
                      <Package className="w-5 h-5 text-amber-600 shrink-0" />
                      <div className="flex-1">
                        <p className="font-semibold text-sm">{ret.customer_email}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {(ret.small_bags_requested || 0) > 0 && `${ret.small_bags_requested} Small`}
                          {(ret.small_bags_requested || 0) > 0 && (ret.tote_bags_requested || 0) > 0 && ' + '}
                          {(ret.tote_bags_requested || 0) > 0 && `${ret.tote_bags_requested} Tote`}
                        </p>
                      </div>
                      <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-3 py-1 rounded-full">Pending</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}