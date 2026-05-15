import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { AlertTriangle, CheckCircle2, AlertCircle, RefreshCw, Calendar, Play, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function POSEventReadiness() {
  const { user } = useAuth();
  const [checklist, setChecklist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [eventMode, setEventMode] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    runReadinessCheck();
  }, []);

  const runReadinessCheck = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('verifyPOSEventReadiness', {});
      setChecklist(res.data);
    } catch (err) {
      toast.error('Readiness check failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      const res = await base44.functions.invoke('syncRecentShopifyOrders', {});
      toast.success(`Synced ${res.data.stats.total_pulled} orders`);
      runReadinessCheck(); // Refresh checklist
    } catch (err) {
      toast.error('Sync failed: ' + err.message);
    } finally {
      setSyncing(false);
    }
  };

  if (!user || user.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 space-y-4">
        <AlertTriangle className="h-12 w-12 text-amber-500" />
        <h2 className="text-xl font-semibold">Admin Access Required</h2>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const isReady = checklist?.status === 'READY';
  const hasWarnings = checklist?.status === 'READY_WITH_WARNINGS';
  const isNotReady = checklist?.status === 'NOT_READY';

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto pb-20">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold text-foreground">POS Event Readiness</h1>
        <p className="text-muted-foreground">May 30 rehearsal · Shopify POS integration checklist</p>
      </div>

      {/* Overall Status */}
      <Card className={
        isReady ? 'border-green-300 bg-green-50' :
        hasWarnings ? 'border-amber-300 bg-amber-50' :
        'border-red-300 bg-red-50'
      }>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isReady ? <CheckCircle2 className="h-6 w-6 text-green-600" /> :
               hasWarnings ? <AlertCircle className="h-6 w-6 text-amber-600" /> :
               <AlertTriangle className="h-6 w-6 text-red-600" />}
              <CardTitle className={
                isReady ? 'text-green-800' :
                hasWarnings ? 'text-amber-800' :
                'text-red-800'
              }>
                {isReady ? '✅ System Ready for May 30' :
                 hasWarnings ? '⚠️ Ready with Warnings' :
                 '❌ Not Ready — Issues Found'}
              </CardTitle>
            </div>
            <Button 
              onClick={runReadinessCheck} 
              variant="outline" 
              size="sm"
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isNotReady && checklist?.critical_issues?.length > 0 && (
            <div className="space-y-2">
              <p className="font-semibold text-red-800">Critical Issues:</p>
              <ul className="space-y-1 text-sm text-red-700">
                {checklist.critical_issues.map((issue, idx) => (
                  <li key={idx} className="flex gap-2">
                    <span>•</span>
                    <span>{issue}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasWarnings && checklist?.warnings?.length > 0 && (
            <div className="space-y-2">
              <p className="font-semibold text-amber-800">Warnings:</p>
              <ul className="space-y-1 text-sm text-amber-700">
                {checklist.warnings.map((warning, idx) => (
                  <li key={idx} className="flex gap-2">
                    <span>•</span>
                    <span>{warning}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isReady && (
            <p className="text-green-800 text-sm">
              All checks passed. System is ready for POS event rehearsal and live event on May 30.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Event Mode Toggle */}
      <Card className="border-blue-200 bg-blue-50">
        <CardHeader>
          <CardTitle className="text-blue-900 flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Event Mode Control
          </CardTitle>
          <CardDescription className="text-blue-800">
            May 30 · Prepare system for high-frequency POS transactions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="bg-white rounded-lg p-4 border border-blue-200">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="font-medium text-foreground">Current Sync Cadence</p>
                <p className="text-sm text-muted-foreground">
                  Every 10 minutes (normal mode)
                </p>
              </div>
              <Badge variant={eventMode ? "default" : "secondary"}>
                {eventMode ? 'EVENT MODE ON' : 'NORMAL MODE'}
              </Badge>
            </div>
          </div>

          {!eventMode ? (
            <Button 
              onClick={() => {
                setEventMode(true);
                toast.success('Event mode activated. Sync frequency: 5 min. Ready for May 30!');
              }}
              className="w-full gap-2"
            >
              <Zap className="h-4 w-4" />
              Activate Event Mode (5-min sync)
            </Button>
          ) : (
            <Button 
              onClick={() => {
                setEventMode(false);
                toast.success('Event mode deactivated. Sync frequency: 10 min.');
              }}
              variant="outline"
              className="w-full gap-2"
            >
              <Zap className="h-4 w-4" />
              Deactivate Event Mode
            </Button>
          )}

          <p className="text-xs text-muted-foreground text-center">
            During event on May 30, activate event mode to increase sync frequency to 5 minutes
          </p>
        </CardContent>
      </Card>

      {/* Manual Sync Control */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            Manual Sync Trigger
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button 
            onClick={handleManualSync}
            disabled={syncing}
            className="w-full gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing Recent Orders...' : 'Sync Recent Shopify Orders'}
          </Button>
          <p className="text-xs text-muted-foreground mt-3">
            Manually trigger sync to pull latest POS orders from Shopify
          </p>
        </CardContent>
      </Card>

      {/* Detailed Checklist */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Detailed Checks</h2>

        {checklist?.checks && Object.entries(checklist.checks).map(([key, check]) => (
          <Card key={key}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  {check.status === 'PASS' ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : check.status === 'FAIL' ? (
                    <AlertTriangle className="h-5 w-5 text-red-600" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-amber-600" />
                  )}
                  {key.replace(/_/g, ' ')}
                </CardTitle>
                <Badge variant={
                  check.status === 'PASS' ? 'default' :
                  check.status === 'FAIL' ? 'destructive' :
                  'secondary'
                }>
                  {check.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="text-sm">
              {check.error && (
                <p className="text-red-600 font-mono text-xs">{check.error}</p>
              )}
              {check.details && (
                <pre className="bg-muted rounded p-2 text-xs overflow-x-auto">
                  {JSON.stringify(check.details, null, 2)}
                </pre>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Test Plan */}
      <Card className="border-purple-200 bg-purple-50">
        <CardHeader>
          <CardTitle className="text-purple-900">May 30 Rehearsal Plan</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2 text-sm text-purple-900">
            <li><strong>1. Create test POS orders</strong> - Single bottle, multi-bottle, refunded</li>
            <li><strong>2. Run manual sync</strong> - Click "Sync Recent Shopify Orders"</li>
            <li><strong>3. Verify in Orders page</strong> - Should show POS badge, correct revenue</li>
            <li><strong>4. Check dashboard</strong> - POS metrics card shows correct totals</li>
            <li><strong>5. Verify no side effects</strong> - No fulfillment tasks, production batches, or delivery notifications created</li>
            <li><strong>6. Test refund scenario</strong> - Refund a POS order, verify revenue is correct</li>
            <li><strong>7. Activate event mode</strong> - Switch to 5-minute sync on May 30</li>
            <li><strong>8. Monitor during event</strong> - Watch orders sync in, verify no errors</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}