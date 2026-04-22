import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle2, Clock, TrendingUp, AlertTriangle, RefreshCw, CloudDownload } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function OperationsManager() {
  const [briefing, setBriefing] = useState(null);
  const [healthCheck, setHealthCheck] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  const runFullSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await base44.functions.invoke('fullSyncFromCustomerApp', {});
      setSyncResult(res.data);
    } catch (error) {
      setSyncResult({ error: error.message });
    }
    setSyncing(false);
  };

  const fetchBriefing = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('operationsOversight', {
        action: 'daily_briefing'
      });
      setBriefing(res.data.briefing);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Error fetching briefing:', error);
    }
    setLoading(false);
  };

  const fetchOrderHealth = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('operationsOversight', {
        action: 'order_health_check'
      });
      setHealthCheck(res.data.health);
    } catch (error) {
      console.error('Error fetching health check:', error);
    }
    setLoading(false);
  };

  const fetchInventory = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('operationsOversight', {
        action: 'inventory_forecast'
      });
      setInventory(res.data.forecast);
    } catch (error) {
      console.error('Error fetching inventory:', error);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchBriefing();
  }, []);

  const getAlertIcon = (type) => {
    if (type === 'critical' || type === 'error') return <AlertCircle className="w-5 h-5 text-destructive" />;
    if (type === 'warning') return <AlertTriangle className="w-5 h-5 text-amber-500" />;
    return <CheckCircle2 className="w-5 h-5 text-green-600" />;
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-4xl font-bold text-foreground">Operations Manager</h1>
            <p className="text-muted-foreground mt-2">24/7 monitoring of orders, inventory, production, and sync health</p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={runFullSync}
              disabled={syncing}
              size="lg"
              className="gap-2"
            >
              <CloudDownload className={`w-4 h-4 ${syncing ? 'animate-pulse' : ''}`} />
              {syncing ? 'Syncing...' : 'Full Sync'}
            </Button>
            <Button 
              onClick={fetchBriefing}
              disabled={loading}
              variant="outline"
              size="lg"
              className="gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {lastUpdated && (
          <p className="text-sm text-muted-foreground">Last updated: {lastUpdated.toLocaleTimeString()}</p>
        )}

        {/* Full Sync Result */}
        {syncResult && (
          <div className={`border rounded-xl p-4 ${syncResult.error ? 'border-red-200 bg-red-50' : syncResult.status === 'partial' ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'}`}>
            <div className="flex items-center gap-2 mb-3">
              {syncResult.error ? <AlertCircle className="w-5 h-5 text-red-600" /> : <CheckCircle2 className="w-5 h-5 text-green-600" />}
              <p className="font-semibold">
                {syncResult.error ? 'Sync Failed' : syncResult.status === 'partial' ? 'Sync Partially Complete' : 'Full Sync Complete'}
              </p>
              {syncResult.synced_at && <p className="text-xs text-muted-foreground ml-auto">{new Date(syncResult.synced_at).toLocaleTimeString()}</p>}
            </div>
            {syncResult.results && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(syncResult.results).map(([key, val]) => (
                  <div key={key} className="bg-white/70 rounded-lg px-3 py-2">
                    <p className="text-xs font-semibold uppercase text-muted-foreground capitalize">{key}</p>
                    <p className="text-sm font-bold mt-0.5">{val.total ?? val.created ?? '—'} records</p>
                    <p className="text-xs text-muted-foreground">
                      {val.created != null && `+${val.created} new`}
                      {val.updated != null && ` · ${val.updated} updated`}
                      {val.failed > 0 && <span className="text-red-600"> · {val.failed} failed</span>}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {syncResult.errors && (
              <div className="mt-3 space-y-1">
                {Object.entries(syncResult.errors).map(([key, msg]) => (
                  <p key={key} className="text-xs text-red-600">⚠ {key}: {msg}</p>
                ))}
              </div>
            )}
            {syncResult.error && <p className="text-sm text-red-700">{syncResult.error}</p>}
          </div>
        )}

        {/* Critical Alerts Banner */}
        {briefing?.alerts?.some(a => a.type === 'critical' || a.type === 'error') && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
            <div className="flex gap-3">
              <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-destructive">Critical Issues Detected</p>
                <p className="text-sm text-foreground mt-1">
                  {briefing.alerts.filter(a => a.type === 'critical' || a.type === 'error').length} critical alert(s) require immediate attention
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Quick Stats */}
        {briefing?.summary && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Orders</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{briefing.summary.total_orders}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Loyalty Members</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{briefing.summary.total_loyalty_members}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Low Stock Items</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-3xl font-bold ${briefing.summary.low_stock_count > 0 ? 'text-amber-600' : ''}`}>
                  {briefing.summary.low_stock_count}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Sync Status</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-lg font-bold ${briefing.summary.data_sync_status === 'healthy' ? 'text-green-600' : 'text-amber-600'}`}>
                  {briefing.summary.data_sync_status}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        <Tabs defaultValue="alerts" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="alerts">Alerts & Actions</TabsTrigger>
            <TabsTrigger value="orders">Order Health</TabsTrigger>
            <TabsTrigger value="inventory">Inventory</TabsTrigger>
            <TabsTrigger value="summary">Summary</TabsTrigger>
          </TabsList>

          {/* Alerts & Action Items */}
          <TabsContent value="alerts" className="space-y-4">
            {briefing?.alerts && briefing.alerts.length > 0 ? (
              <div className="space-y-3">
                {briefing.alerts.map((alert, idx) => (
                  <Card key={idx} className={`border-l-4 ${
                    alert.type === 'critical' || alert.type === 'error' ? 'border-l-destructive' :
                    alert.type === 'warning' ? 'border-l-amber-500' :
                    'border-l-green-600'
                  }`}>
                    <CardContent className="pt-6">
                      <div className="flex gap-3">
                        {getAlertIcon(alert.type)}
                        <div className="flex-1">
                          <p className="font-semibold">{alert.message}</p>
                          {alert.details && (
                            <div className="mt-2 text-sm text-muted-foreground space-y-1">
                              {Array.isArray(alert.details) ? (
                                alert.details.slice(0, 3).map((detail, i) => (
                                  <p key={i}>• {JSON.stringify(detail).substring(0, 80)}...</p>
                                ))
                              ) : (
                                <p>{JSON.stringify(alert.details)}</p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="pt-6 text-center text-muted-foreground">
                  ✅ No alerts. Everything is running smoothly.
                </CardContent>
              </Card>
            )}

            {briefing?.actionItems && briefing.actionItems.length > 0 && (
              <Card className="bg-accent/5 border-accent/20">
                <CardHeader>
                  <CardTitle className="text-base flex gap-2 items-center">
                    <TrendingUp className="w-5 h-5" />
                    Action Items
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {briefing.actionItems.map((item, idx) => (
                      <li key={idx} className="flex gap-2 text-sm">
                        <span className="text-primary font-bold">•</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Order Health */}
          <TabsContent value="orders" className="space-y-4">
            <Button onClick={fetchOrderHealth} className="w-full" variant="outline">
              Check Order Health
            </Button>
            {healthCheck && (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Order Status Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {Object.entries(healthCheck.by_status).map(([status, count]) => (
                        <div key={status} className="text-center p-3 bg-muted rounded-lg">
                          <p className="text-sm text-muted-foreground capitalize">{status.replace(/_/g, ' ')}</p>
                          <p className="text-2xl font-bold">{count}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {healthCheck.risks && healthCheck.risks.length > 0 && (
                  <Card className="border-amber-200">
                    <CardHeader>
                      <CardTitle className="text-amber-700 flex gap-2 items-center">
                        <AlertTriangle className="w-5 h-5" />
                        At-Risk Orders
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {healthCheck.risks.map((risk, idx) => (
                          <div key={idx} className="p-3 bg-amber-50 rounded-lg text-sm">
                            <p className="font-semibold">{risk.order}</p>
                            <p className="text-amber-700">{risk.reason}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </TabsContent>

          {/* Inventory */}
          <TabsContent value="inventory" className="space-y-4">
            <Button onClick={fetchInventory} className="w-full" variant="outline">
              Load Inventory Forecast
            </Button>
            {inventory && (
              <div className="space-y-4">
                {inventory.critical && inventory.critical.length > 0 && (
                  <Card className="border-destructive/30 bg-destructive/5">
                    <CardHeader>
                      <CardTitle className="text-destructive flex gap-2 items-center">
                        <AlertCircle className="w-5 h-5" />
                        Critical Stock Levels
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {inventory.critical.map((item, idx) => (
                        <div key={idx} className="p-3 bg-destructive/10 rounded-lg text-sm">
                          <p className="font-semibold">{item.ingredient}</p>
                          <p className="text-muted-foreground">Stock: {item.current} | Needed: {item.needed}</p>
                          <p className="text-destructive text-xs mt-1">⚡ {item.action}</p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {inventory.warning && inventory.warning.length > 0 && (
                  <Card className="border-amber-200 bg-amber-50">
                    <CardHeader>
                      <CardTitle className="text-amber-700 flex gap-2 items-center">
                        <Clock className="w-5 h-5" />
                        Monitor Soon
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {inventory.warning.map((item, idx) => (
                        <div key={idx} className="text-sm">
                          <p className="font-semibold">{item.ingredient}</p>
                          <p className="text-muted-foreground">~{item.days_until_reorder} days until reorder</p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {inventory.healthy && inventory.healthy.length > 0 && (
                  <Card className="bg-green-50 border-green-200">
                    <CardHeader>
                      <CardTitle className="text-green-700 flex gap-2 items-center">
                        <CheckCircle2 className="w-5 h-5" />
                        Healthy Stock ({inventory.healthy.length})
                      </CardTitle>
                    </CardHeader>
                  </Card>
                )}
              </div>
            )}
          </TabsContent>

          {/* Summary */}
          <TabsContent value="summary">
            {briefing?.summary && (
              <Card>
                <CardHeader>
                  <CardTitle>Operations Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    {Object.entries(briefing.summary).map(([key, value]) => (
                      <div key={key}>
                        <p className="text-sm text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</p>
                        <p className="text-2xl font-bold mt-1">
                          {typeof value === 'object' ? JSON.stringify(value) : value}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}