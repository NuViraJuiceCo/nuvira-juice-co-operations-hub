import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Download, RefreshCw, TrendingUp, Gift, Trash2, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import moment from 'moment';

export default function LoyaltyAdmin() {
  const [customers, setCustomers] = useState([]);
  const [userPoints, setUserPoints] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [selectedCustomers, setSelectedCustomers] = useState(new Set());
  const [processingBonus, setProcessingBonus] = useState(false);
  const [expandedCustomer, setExpandedCustomer] = useState(null);
  const [editingPointsId, setEditingPointsId] = useState(null);
  const [editPointsValue, setEditPointsValue] = useState('');
  const queryClient = useQueryClient();
  
  const redeemMutation = useMutation({
    mutationFn: async (vars) => {
      const res = await base44.functions.invoke('redeemReward', vars);
      return res.data;
    },
    onSuccess: () => {
      loadData();
      toast.success('Reward redeemed');
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || 'Redemption failed');
    },
  });

  const updatePointsMutation = useMutation({
    mutationFn: async ({ customerId, newPoints }) => {
      await base44.entities.LoyaltyMember.update(customerId, { total_points: parseInt(newPoints) });
    },
    onSuccess: () => {
      loadData();
      toast.success('Points updated');
      setEditingPointsId(null);
    },
    onError: () => {
      toast.error('Update failed');
    },
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [loyaltyData, pointsData, rewardsData] = await Promise.all([
        base44.entities.LoyaltyMember.list('-lifetime_points', 100),
        base44.entities.UserPoints.list('-created_date', 500),
        base44.entities.Rewards.list(),
      ]);
      setCustomers(Array.isArray(loyaltyData) ? loyaltyData : []);
      setUserPoints(Array.isArray(pointsData) ? pointsData : []);
      setRewards(Array.isArray(rewardsData) ? rewardsData : []);
    } catch (error) {
      console.error('Error loading data:', error);
      setCustomers([]);
      setUserPoints([]);
      setRewards([]);
    }
    setLoading(false);
  };

  const syncFromCustomerApp = async () => {
    setSyncing(true);
    try {
      const res = await base44.functions.invoke('pullLoyaltyFromCustomerApp', {});
      if (res.data.status === 'success') {
        await loadData();
      }
    } catch (error) {
      console.error('Sync error:', error);
    }
    setSyncing(false);
  };

  const getPointHistory = (customerEmail) => {
    return userPoints.filter(p => p.customer_email === customerEmail).sort((a, b) => 
      new Date(b.created_date) - new Date(a.created_date)
    );
  };

  const getAvailableRewards = (customer) => {
     if (!customer || !Array.isArray(rewards)) return [];
     return rewards.filter(r => r && r.is_active && (customer.total_points || 0) >= (r.points_required || 0));
   };

  const getRedemptionsByOrder = (customer) => {
    return customer.points_history?.filter(h => h.type === 'redeemed' && h.order_id) || [];
  };

  const getOrderHistory = (customer) => {
    return customer.order_history || [];
  };

  const filtered = customers.filter(c =>
    c && (!search || (c.email && c.email.toLowerCase().includes(search.toLowerCase())))
  );

  const exportCSV = () => {
    const headers = 'Email,Current Points,Lifetime Points,Redeemed,Available Rewards,Redemptions\n';
    const rows = filtered.filter(c => c).map(c => {
      const available = getAvailableRewards(c).length;
      const redemptions = getRedemptionsByOrder(c).length;
      return `"${(c.email || '').replace(/"/g, '""')}",${c.total_points || 0},${c.lifetime_points || 0},${c.redeemed_points || 0},${available},${redemptions}`;
    }).join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `loyalty-customers-${moment().format('YYYY-MM-DD')}.csv`;
    a.click();
  };

  const addBonusToSelected = async () => {
    if (selectedCustomers.size === 0) return;
    setProcessingBonus(true);
    try {
      const selectedIds = Array.from(selectedCustomers);
      const selectedLoyalty = customers.filter(c => selectedIds.includes(c.id));
      await Promise.all(selectedLoyalty.map(c => 
        base44.functions.invoke('createLoyaltySignupBonus', {
          customer_email: c.email,
          points_data: {
            total_points: (c.total_points || 0) + 100,
            lifetime_points: (c.lifetime_points || 0) + 100,
            redeemed_points: c.redeemed_points || 0,
            points_history: [
              ...(c.points_history || []),
              {
                amount: 100,
                type: 'bonus',
                description: 'Admin bonus',
                timestamp: new Date().toISOString()
              }
            ]
          }
        })
      ));
      await loadData();
      setSelectedCustomers(new Set());
    } catch (error) {
      console.error('Bonus error:', error);
    }
    setProcessingBonus(false);
  };

  const deleteSelected = async () => {
    if (selectedCustomers.size === 0) return;
    if (!confirm(`Delete ${selectedCustomers.size} member(s)?`)) return;
    try {
      await Promise.all(Array.from(selectedCustomers).map(id => base44.entities.LoyaltyMember.delete(id)));
      await loadData();
      setSelectedCustomers(new Set());
    } catch (error) {
      console.error('Delete error:', error);
    }
  };

  const deleteSingle = async (e, customerId) => {
    e.stopPropagation();
    if (!confirm('Delete this loyalty member?')) return;
    await base44.entities.LoyaltyMember.delete(customerId);
    setCustomers(prev => prev.filter(c => c.id !== customerId));
    setSelectedCustomers(prev => { const s = new Set(prev); s.delete(customerId); return s; });
  };

  const toggleSelectAll = () => {
    if (selectedCustomers.size === filtered.length) {
      setSelectedCustomers(new Set());
    } else {
      setSelectedCustomers(new Set(filtered.map(c => c.id)));
    }
  };

  const toggleCustomer = (customerId) => {
    const updated = new Set(selectedCustomers);
    if (updated.has(customerId)) {
      updated.delete(customerId);
    } else {
      updated.add(customerId);
    }
    setSelectedCustomers(updated);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Loyalty Dashboard</h1>
          <p className="text-muted-foreground mt-1">{customers.length} customers tracked</p>
        </div>
        <div className="flex gap-2">
          {selectedCustomers.size > 0 && (
            <>
              <Button onClick={addBonusToSelected} disabled={processingBonus} className="gap-2 bg-green-600 hover:bg-green-700">
                +100 pts ({selectedCustomers.size})
              </Button>
              <Button onClick={deleteSelected} variant="destructive" className="gap-2">
                Delete ({selectedCustomers.size})
              </Button>
            </>
          )}
          <Button variant="outline" onClick={syncFromCustomerApp} disabled={syncing} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            Sync Now
          </Button>
          <Button variant="outline" onClick={exportCSV} className="gap-2">
            <Download className="h-4 w-4" /> Export
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Customers</p>
            <p className="text-3xl font-bold mt-2">{customers.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Points Issued</p>
            <p className="text-3xl font-bold mt-2">{customers.reduce((sum, c) => sum + (c?.lifetime_points || 0), 0).toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Points Redeemed</p>
            <p className="text-3xl font-bold mt-2">{customers.reduce((sum, c) => sum + (c?.redeemed_points || 0), 0).toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Avg Points/Customer</p>
            <p className="text-3xl font-bold mt-2">{customers.length > 0 ? Math.round(customers.reduce((sum, c) => sum + (c?.total_points || 0), 0) / customers.length) : 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Select All + bulk bar */}
      {filtered.length > 0 && (
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              className="w-4 h-4 cursor-pointer"
              checked={selectedCustomers.size === filtered.length && filtered.length > 0}
              onChange={toggleSelectAll}
            />
            Select all ({filtered.length})
          </label>
          {selectedCustomers.size > 0 && (
            <span className="text-sm font-medium text-primary">{selectedCustomers.size} selected</span>
          )}
        </div>
      )}

      {/* Customer List */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              No customers found
            </CardContent>
          </Card>
        ) : (
          filtered.map(customer => {
            const availableRewards = getAvailableRewards(customer);
            const redemptions = getRedemptionsByOrder(customer);
            const isSelected = selectedCustomers.has(customer.id);
            return (
              <Card 
                key={customer.id} 
                className={`hover:shadow-md transition-shadow cursor-pointer ${isSelected ? 'ring-2 ring-primary' : ''}`}
                onClick={() => toggleCustomer(customer.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <input 
                          type="checkbox" 
                          checked={isSelected}
                          onChange={() => {}}
                          className="w-4 h-4 cursor-pointer"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div>
                          <CardTitle className="text-lg">{customer.email}</CardTitle>
                          <p className="text-sm text-muted-foreground mt-1">
                            Member since {moment(customer.created_date).format('MMM D, YYYY')}
                          </p>
                          <div className="flex gap-2 mt-2">
                            {getAvailableRewards(customer).length > 0 && (
                              <Badge className="bg-green-100 text-green-700 border border-green-300">
                                <Gift className="w-3 h-3 mr-1" />
                                {getAvailableRewards(customer).length} Unlocked
                              </Badge>
                            )}
                            {getRedemptionsByOrder(customer).length > 0 && (
                              <Badge className="bg-blue-100 text-blue-700 border border-blue-300">
                                <CheckCircle className="w-3 h-3 mr-1" />
                                {getRedemptionsByOrder(customer).length} Redeemed
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-lg font-bold">
                        {customer.total_points} pts
                      </Badge>
                      <button
                        onClick={(e) => deleteSingle(e, customer.id)}
                        className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 transition-colors"
                        title="Delete member"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Points Summary */}
                  <div className="grid grid-cols-3 gap-3 p-3 bg-muted rounded-lg">
                    <div>
                      <p className="text-xs text-muted-foreground">Lifetime</p>
                      <p className="font-bold text-sm">{customer.lifetime_points}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Redeemed</p>
                      <p className="font-bold text-sm">{customer.redeemed_points}</p>
                    </div>
                    <div className="relative">
                      <p className="text-xs text-muted-foreground">Remaining</p>
                      {editingPointsId === customer.id ? (
                        <div className="flex gap-2 mt-2">
                          <input
                            type="number"
                            value={editPointsValue}
                            onChange={(e) => setEditPointsValue(e.target.value)}
                            className="flex-1 bg-white border border-primary rounded px-2 py-1 text-sm font-bold"
                            autoFocus
                          />
                          <button
                            onClick={() => updatePointsMutation.mutate({ customerId: customer.id, newPoints: editPointsValue })}
                            disabled={updatePointsMutation.isPending}
                            className="px-2 py-1 bg-primary text-white rounded text-xs font-bold"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingPointsId(null)}
                            className="px-2 py-1 border border-muted-foreground rounded text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setEditingPointsId(customer.id);
                            setEditPointsValue(String(customer.total_points));
                          }}
                          className="font-bold text-sm text-primary hover:underline"
                        >
                          {customer.total_points}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Available Rewards */}
                  {availableRewards.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold mb-2 flex items-center gap-2">
                        <Gift className="w-4 h-4" /> Available Rewards ({availableRewards.length})
                      </p>
                      <div className="space-y-2">
                        {availableRewards.map(reward => (
                          <div key={reward.id} className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                            <div>
                              <p className="text-sm font-semibold text-green-700">{reward.title}</p>
                              <p className="text-xs text-green-600">{reward.points_required} pts</p>
                            </div>
                            <Button
                              onClick={() => redeemMutation.mutate({ customer_id: customer.id, reward_id: reward.id })}
                              disabled={redeemMutation.isPending}
                              size="sm"
                              className="bg-green-600 hover:bg-green-700 text-white gap-1"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              {redeemMutation.isPending ? 'Redeeming...' : 'Claim'}
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Redemption History */}
                  {redemptions.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold mb-2 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4" /> Redemptions ({redemptions.length})
                      </p>
                      <div className="space-y-2">
                        {redemptions.map((redemption, idx) => (
                          <div key={idx} className="text-xs p-3 bg-primary/10 rounded border border-primary/20">
                            <div className="flex justify-between">
                              <span className="font-semibold text-primary">-{redemption.amount} points</span>
                              <span className="text-muted-foreground text-[11px]">{moment(redemption.timestamp).format('MMM D, h:mm A')}</span>
                            </div>
                            <p className="text-foreground/80 mt-1 font-medium">{redemption.description}</p>
                            {redemption.order_id && (
                              <p className="text-primary/70 mt-1.5 text-[11px]">Order ID: {redemption.order_id}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {availableRewards.length === 0 && redemptions.length === 0 && (
                    <p className="text-sm text-muted-foreground italic">No rewards unlocked or redeemed yet</p>
                  )}

                  {/* Point History */}
                  {getPointHistory(customer.email).length > 0 && (
                    <div>
                      <button 
                        onClick={() => setExpandedCustomer(expandedCustomer === customer.id ? null : customer.id)}
                        className="text-sm font-semibold mb-2 flex items-center gap-2 text-primary hover:underline"
                      >
                        {expandedCustomer === customer.id ? '▼' : '▶'} Point Transactions ({getPointHistory(customer.email).length})
                      </button>
                      {expandedCustomer === customer.id && (
                        <div className="space-y-2">
                          {getPointHistory(customer.email).map((pt, idx) => (
                            <div key={idx} className={`text-xs p-3 rounded border ${pt.type === 'earned' ? 'bg-green-50 border-green-200' : pt.type === 'redeemed' ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'}`}>
                              <div className="flex justify-between">
                                <span className={`font-semibold ${pt.type === 'earned' ? 'text-green-700' : pt.type === 'redeemed' ? 'text-red-700' : 'text-blue-700'}`}>
                                  {pt.type === 'redeemed' ? '-' : '+'}{Math.abs(pt.amount)} points
                                </span>
                                <span className="text-muted-foreground text-[11px]">{moment(pt.created_date).format('MMM D, h:mm A')}</span>
                              </div>
                              <p className="text-foreground/80 mt-1">{pt.description}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Order History */}
                  {getOrderHistory(customer).length > 0 && (
                    <div>
                      <p className="text-sm font-semibold mb-2 flex items-center gap-2">
                        📦 Order History ({getOrderHistory(customer).length})
                      </p>
                      <div className="space-y-2">
                        {getOrderHistory(customer).map((order, idx) => (
                          <div key={idx} className="text-xs p-3 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
                            <div className="flex justify-between items-start mb-1">
                              <span className="font-semibold text-blue-700 dark:text-blue-400">{order.order_number}</span>
                              <span className="text-muted-foreground text-[11px]">{moment(order.order_date).format('MMM D, YYYY')}</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-[11px] mt-2">
                              <div>
                                <span className="text-muted-foreground">Total:</span>
                                <p className="font-semibold">${order.total_price?.toFixed(2)}</p>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Items:</span>
                                <p className="font-semibold">{order.items_count}</p>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Pts Earned:</span>
                                <p className="font-semibold text-primary">+{order.points_earned || 0}</p>
                              </div>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-1.5">Status: {order.status}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}