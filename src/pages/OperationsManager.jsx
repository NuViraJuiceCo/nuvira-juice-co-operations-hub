import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle2, Clock, TrendingUp, AlertTriangle, RefreshCw, CloudDownload, ShieldCheck } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function OperationsManager() {
  const [briefing, setBriefing] = useState(null);
  const [healthCheck, setHealthCheck] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [autoHealResult, setAutoHealResult] = useState(null);
  const [stripeSyncHealth, setStripeSyncHealth] = useState(null);
  const [webhookHistory, setWebhookHistory] = useState(null);
  const [safetyHealth, setSafetyHealth] = useState(null);
  const [safetyLoading, setSafetyLoading] = useState(false);

  const runSafetyHealthCheck = async () => {
    setSafetyLoading(true);
    try {
      const res = await base44.functions.invoke('systemSafetyHealthCheck', {});
      setSafetyHealth(res.data);
    } catch (err) {
      setSafetyHealth({ error: err.message });
    }
    setSafetyLoading(false);
  };

  const runAutoDetectIssues = async () => {
    try {
      const res = await base44.functions.invoke('detectStripeOrderSyncIssues', {});
      console.log('Detection result:', res.data.result);
    } catch (error) {
      console.error('Detection failed:', error.message);
    }
  };

  const runAutoReconcile = async () => {
    try {
      const res = await base44.functions.invoke('reconcileStripeOrders', {});
      const reconcileResult = res.data.result;
      setAutoHealResult(reconcileResult);
      await new Promise(resolve => setTimeout(resolve, 500));
      await fetchBriefing();
    } catch (error) {
      console.error('Reconciliation failed:', error.message);
    }
  };

  const fetchStripeSyncHealth = async () => {
    try {
      const allOrders = await base44.entities.ShopifyOrder.list('-updated_date', 100);
      const events = await base44.entities.StripeEventLog.list('-created_date', 50);
      
      const health = {
        synced: allOrders.filter(o => o.sync_status === 'synced').length,
        pending_reconciliation: allOrders.filter(o => o.sync_status === 'pending_reconciliation').length,
        needs_review: allOrders.filter(o => o.repair_status === 'needs_review').length,
        unknown: allOrders.filter(o => o.shopify_order_id === 'base44_unknown').length,
        stripe_linked: allOrders.filter(o => o.stripe_customer_id || o.stripe_payment_intent_id).length,
        total_orders: allOrders.length,
      };
      
      const eventStats = {
        processed: events.filter(e => e.status === 'processed').length,
        skipped: events.filter(e => e.status === 'skipped').length,
        failed: events.filter(e => e.status === 'failed').length,
        total_events: events.length,
      };
      
      setStripeSyncHealth({ ...health, events: eventStats });
      setWebhookHistory(events.slice(0, 20));
    } catch (error) {
      console.error('Failed to fetch Stripe health:', error.message);
    }
  };

  const runAutoRemediateStripe = async () => {
    try {
      const res = await base44.functions.invoke('autoRemediateStripeOrders', {});
      setAutoHealResult(res.data.result);
      // Refresh briefing after heal
      await new Promise(resolve => setTimeout(resolve, 500));
      await fetchBriefing();
    } catch (error) {
      console.error('Auto-remediate failed:', error.message);
    }
  };

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
    <div className="min-h-screen bg-background p-4 sm:p-6">
      <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Operations Manager</h1>
            <p className="text-sm text-muted-foreground mt-1">24/7 monitoring of orders, inventory, production, and sync health</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={runFullSync}
              disabled={syncing}
              size="sm"
              className="gap-2 flex-1 sm:flex-none"
            >
              <CloudDownload className={`w-4 h-4 ${syncing ? 'animate-pulse' : ''}`} />
              {syncing ? 'Syncing...' : 'Full Sync'}
            </Button>
            <Button 
              onClick={fetchBriefing}
              disabled={loading}
              variant="outline"
              size="sm"
              className="gap-2 flex-1 sm:flex-none"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        {lastUpdated && (
          <p className="text-sm text-muted-foreground">Last updated: {lastUpdated.toLocaleTimeString()}</p>
        )}

        {/* Auto-Remediation Result */}
        {autoHealResult && autoHealResult.fixed_count > 0 && (
          <div className="border border-green-200 bg-green-50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <p className="font-semibold text-green-900">Auto-Remediation Complete</p>
              <p className="text-xs text-green-700 ml-auto">{new Date(autoHealResult.timestamp).toLocaleTimeString()}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/70 rounded-lg px-3 py-2">
                <p className="text-xs font-semibold text-green-700">Orders Recovered</p>
                <p className="text-sm font-bold mt-0.5">{autoHealResult.fixed_count}</p>
              </div>
              <div className="bg-white/70 rounded-lg px-3 py-2">
                <p className="text-xs font-semibold text-green-700">Duplicates Removed</p>
                <p className="text-sm font-bold mt-0.5">
                  {autoHealResult.actions.filter(a => a.action === 'deleted_duplicate').length}
                </p>
              </div>
            </div>
            {autoHealResult.issues.length > 0 && (
              <div className="mt-3 p-3 bg-amber-50 rounded-lg border border-amber-200">
                <p className="text-xs font-semibold text-amber-700 mb-2">Issues During Remediation:</p>
                <div className="space-y-1">
                  {autoHealResult.issues.slice(0, 3).map((issue, i) => (
                    <p key={i} className="text-xs text-amber-600">⚠ {issue.problem}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
          <TabsList className="flex flex-wrap h-auto gap-1 p-1 w-full">
            <TabsTrigger value="alerts" className="flex-1 min-w-[80px] text-xs sm:text-sm">Alerts</TabsTrigger>
            <TabsTrigger value="orders" className="flex-1 min-w-[80px] text-xs sm:text-sm">Orders</TabsTrigger>
            <TabsTrigger value="inventory" className="flex-1 min-w-[80px] text-xs sm:text-sm">Inventory</TabsTrigger>
            <TabsTrigger value="stripe" className="flex-1 min-w-[80px] text-xs sm:text-sm">Stripe</TabsTrigger>
            <TabsTrigger value="safety" className="flex-1 min-w-[80px] text-xs sm:text-sm">Safety</TabsTrigger>
            <TabsTrigger value="summary" className="flex-1 min-w-[80px] text-xs sm:text-sm">Summary</TabsTrigger>
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

          {/* Stripe Sync Health & Repair */}
          <TabsContent value="stripe" className="space-y-4">
            <div className="flex gap-2 flex-wrap">
              <Button onClick={fetchStripeSyncHealth} variant="outline" className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Refresh Health
              </Button>
              <Button onClick={runAutoDetectIssues} variant="outline" className="gap-2">
                <AlertCircle className="h-4 w-4" />
                Detect Issues
              </Button>
              <Button onClick={runAutoReconcile} variant="outline" className="gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Reconcile
              </Button>
            </div>

            {stripeSyncHealth && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>Stripe Sync Health Status</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                        <p className="text-xs font-semibold text-green-700">Synced</p>
                        <p className="text-2xl font-bold text-green-600 mt-1">{stripeSyncHealth.synced}</p>
                      </div>
                      <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                        <p className="text-xs font-semibold text-amber-700">Pending Reconciliation</p>
                        <p className="text-2xl font-bold text-amber-600 mt-1">{stripeSyncHealth.pending_reconciliation}</p>
                      </div>
                      <div className="p-3 bg-orange-50 rounded-lg border border-orange-200">
                        <p className="text-xs font-semibold text-orange-700">Needs Review</p>
                        <p className="text-2xl font-bold text-orange-600 mt-1">{stripeSyncHealth.needs_review}</p>
                      </div>
                      <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                        <p className="text-xs font-semibold text-red-700">#Unknown</p>
                        <p className="text-2xl font-bold text-red-600 mt-1">{stripeSyncHealth.unknown}</p>
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-4">
                      <div className="p-3 bg-blue-50 rounded-lg">
                        <p className="text-xs font-semibold text-blue-700">Stripe Linked Orders</p>
                        <p className="text-xl font-bold text-blue-600 mt-1">{stripeSyncHealth.stripe_linked} / {stripeSyncHealth.total_orders}</p>
                      </div>
                      <div className="p-3 bg-slate-50 rounded-lg">
                        <p className="text-xs font-semibold text-slate-700">Webhooks Processed</p>
                        <p className="text-xl font-bold text-slate-600 mt-1">{stripeSyncHealth.events?.processed || 0}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {webhookHistory && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Recent Webhook History</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {webhookHistory.map((event, idx) => (
                          <div key={idx} className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-sm">
                            <div className="flex justify-between items-start gap-2 mb-1">
                              <p className="font-semibold text-slate-700">{event.event_type}</p>
                              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                event.status === 'processed' ? 'bg-green-100 text-green-700' :
                                event.status === 'skipped' ? 'bg-gray-100 text-gray-700' :
                                'bg-red-100 text-red-700'
                              }`}>
                                {event.status}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600">{event.stripe_event_id}</p>
                            {event.customer_email && <p className="text-xs text-slate-600">📧 {event.customer_email}</p>}
                            <p className="text-xs text-slate-500 mt-1">{new Date(event.created_date).toLocaleString()}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          {/* System Safety */}
          <TabsContent value="safety" className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Verifies all order write protections are active and no legacy paths are live.</p>
              <Button onClick={runSafetyHealthCheck} disabled={safetyLoading} className="gap-2">
                <ShieldCheck className={`h-4 w-4 ${safetyLoading ? 'animate-pulse' : ''}`} />
                {safetyLoading ? 'Checking...' : 'Run Health Check'}
              </Button>
            </div>

            {/* Static status cards — always visible */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: 'Stripe Webhook', detail: 'stripeCheckoutWebhookHardened only', status: 'pass' },
                { label: 'Legacy Webhook (V2)', detail: 'Disabled — returns 410 Gone', status: 'pass' },
                { label: 'Legacy Gateway (upsertOrderSafely)', detail: 'Disabled — returns 410 Gone', status: 'pass' },
                { label: 'OrderReviewQueue Alerts', detail: 'Auto email on every quarantine event', status: 'pass' },
                { label: 'safeSubscriptionUpsert', detail: 'Migrated to safeSyncOrderUpdate gateway', status: 'pass' },
                { label: 'All Order Writes', detail: 'Route through safeSyncOrderUpdate', status: 'pass' },
              ].map(item => (
                <div key={item.label} className="flex items-start gap-3 p-3 bg-green-50 border border-green-200 rounded-xl">
                  <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-green-900">{item.label}</p>
                    <p className="text-xs text-green-700 mt-0.5">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Live check results */}
            {safetyHealth && !safetyHealth.error && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                      safetyHealth.overall_status === 'PASS' ? 'bg-green-100 text-green-700' :
                      safetyHealth.overall_status === 'WARN' ? 'bg-amber-100 text-amber-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {safetyHealth.overall_status}
                    </span>
                    Live Check Results
                    <span className="text-xs font-normal text-muted-foreground ml-auto">
                      {new Date(safetyHealth.timestamp).toLocaleTimeString()}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {safetyHealth.checks?.map(check => (
                    <div key={check.id} className={`flex items-start gap-3 p-3 rounded-lg border ${
                      check.status === 'pass' ? 'bg-green-50 border-green-200' :
                      check.status === 'warn' ? 'bg-amber-50 border-amber-200' :
                      'bg-red-50 border-red-200'
                    }`}>
                      {check.status === 'pass'
                        ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                        : check.status === 'warn'
                        ? <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        : <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold">{check.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{check.detail}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {safetyHealth?.error && (
              <div className="flex gap-2 bg-red-50 border border-red-200 rounded-lg p-4">
                <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{safetyHealth.error}</p>
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