import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, TrendingUp, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

export default function POSMetricsCard({ orders = [] }) {
  const [posStats, setPosStats] = useState(null);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    calculatePOSMetrics();
  }, [orders]);

  const calculatePOSMetrics = () => {
    // Filter for POS orders only (paid, not refunded)
    const posOrders = orders.filter(o => 
      (o.order_type === 'pos' || (Array.isArray(o.tags) && o.tags.includes('shopify_pos'))) &&
      o.payment_status === 'paid'
    );

    // Calculate metrics
    const posRevenue = posOrders.reduce((sum, o) => sum + (o.total_price || 0), 0);
    const totalUnits = posOrders.reduce((sum, o) => 
      sum + (o.line_items?.reduce((itemSum, item) => itemSum + (item.quantity || 0), 0) || 0)
    , 0);

    // Count by product
    const productCounts = {};
    posOrders.forEach(order => {
      (order.line_items || []).forEach(item => {
        const key = item.title || 'Unknown';
        productCounts[key] = (productCounts[key] || 0) + item.quantity;
      });
    });

    // Find most recent sync timestamp from POS orders
    const mostRecentSync = posOrders.length > 0 
      ? new Date(Math.max(...posOrders.map(o => new Date(o.last_sync_at || o.created_date).getTime())))
      : null;

    setPosStats({
      count: posOrders.length,
      revenue: posRevenue,
      units: totalUnits,
      topProducts: Object.entries(productCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, qty]) => ({ name, qty }))
    });

    setLastSyncTime(mostRecentSync);
  };

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      await base44.functions.invoke('syncRecentShopifyOrders', {});
      // Refresh dashboard data
      window.location.reload();
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };

  if (!posStats) return null;

  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-amber-900 flex items-center gap-2">
            <Package className="h-5 w-5" />
            POS Event Metrics
          </CardTitle>
          <Button 
            onClick={handleManualSync} 
            disabled={syncing} 
            variant="outline" 
            size="sm" 
            className="gap-1"
          >
            <RefreshCw className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync Now'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">POS Orders</p>
            <p className="text-2xl font-bold text-amber-700">{posStats.count}</p>
          </div>
          <div className="bg-white rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">Units Sold</p>
            <p className="text-2xl font-bold text-amber-700">{posStats.units}</p>
          </div>
          <div className="bg-white rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground">POS Revenue</p>
            <p className="text-xl font-bold text-green-700">${posStats.revenue.toFixed(0)}</p>
          </div>
        </div>

        {/* Top Products */}
        {posStats.topProducts.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-amber-900">Top Products</p>
            <div className="space-y-1">
              {posStats.topProducts.map(({ name, qty }) => (
                <div key={name} className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground truncate">{name}</span>
                  <Badge variant="secondary" className="text-xs">{qty} units</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sync Status */}
        <div className="bg-white rounded-lg p-3 border border-amber-100 text-xs space-y-1">
          <p className="text-muted-foreground">Last Shopify Sync</p>
          <p className="font-mono text-amber-700">
            {lastSyncTime 
              ? lastSyncTime.toLocaleTimeString() 
              : 'Never'}
          </p>
          <p className="text-muted-foreground">
            Auto-sync: Every 10 min (5 min during event)
          </p>
        </div>
      </CardContent>
    </Card>
  );
}