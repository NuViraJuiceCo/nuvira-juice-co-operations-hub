import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Download, RefreshCw, TrendingUp, Gift } from 'lucide-react';
import moment from 'moment';

export default function LoyaltyAdmin() {
  const [customers, setCustomers] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [loyaltyData, rewardsData] = await Promise.all([
        base44.entities.CustomerLoyalty.list('-lifetime_points', 100),
        base44.entities.Rewards.list(),
      ]);
      setCustomers(loyaltyData);
      setRewards(rewardsData);
    } catch (error) {
      console.error('Error loading data:', error);
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

  const getAvailableRewards = (customer) => {
    return rewards.filter(r => r.is_active && customer.total_points >= r.points_required);
  };

  const getRedemptionsByOrder = (customer) => {
    return customer.points_history?.filter(h => h.type === 'redeemed' && h.order_id) || [];
  };

  const filtered = customers.filter(c =>
    !search || c.customer_email.toLowerCase().includes(search.toLowerCase())
  );

  const exportCSV = () => {
    const headers = 'Email,Current Points,Lifetime Points,Redeemed,Available Rewards,Redemptions\n';
    const rows = filtered.map(c => {
      const available = getAvailableRewards(c).length;
      const redemptions = getRedemptionsByOrder(c).length;
      return `"${c.customer_email}",${c.total_points},${c.lifetime_points},${c.redeemed_points},${available},${redemptions}`;
    }).join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `loyalty-customers-${moment().format('YYYY-MM-DD')}.csv`;
    a.click();
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
            <p className="text-3xl font-bold mt-2">{customers.reduce((sum, c) => sum + c.lifetime_points, 0).toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Points Redeemed</p>
            <p className="text-3xl font-bold mt-2">{customers.reduce((sum, c) => sum + c.redeemed_points, 0).toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Avg Points/Customer</p>
            <p className="text-3xl font-bold mt-2">{customers.length > 0 ? Math.round(customers.reduce((sum, c) => sum + c.total_points, 0) / customers.length) : 0}</p>
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
            return (
              <Card key={customer.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{customer.customer_email}</CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">
                        Member since {moment(customer.created_date).format('MMM D, YYYY')}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-lg font-bold">
                      {customer.total_points} pts
                    </Badge>
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
                    <div>
                      <p className="text-xs text-muted-foreground">Remaining</p>
                      <p className="font-bold text-sm text-primary">{customer.total_points}</p>
                    </div>
                  </div>

                  {/* Available Rewards */}
                  {availableRewards.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold mb-2 flex items-center gap-2">
                        <Gift className="w-4 h-4" /> Available Rewards ({availableRewards.length})
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {availableRewards.map(reward => (
                          <Badge key={reward.id} className="bg-green-100 text-green-700">
                            {reward.title} ({reward.points_required} pts)
                          </Badge>
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
                          <div key={idx} className="text-xs p-2 bg-blue-50 rounded border border-blue-200">
                            <div className="flex justify-between">
                              <span className="font-medium">-{redemption.amount} points</span>
                              <span className="text-muted-foreground">{moment(redemption.timestamp).format('MMM D, h:mm A')}</span>
                            </div>
                            <p className="text-muted-foreground mt-1">{redemption.description}</p>
                            {redemption.order_id && (
                              <p className="text-blue-600 mt-1">Order: {redemption.order_id}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {availableRewards.length === 0 && redemptions.length === 0 && (
                    <p className="text-sm text-muted-foreground italic">No rewards unlocked or redeemed yet</p>
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