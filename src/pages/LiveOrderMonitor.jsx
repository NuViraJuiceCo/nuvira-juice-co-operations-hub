import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw, Activity, Clock, ChevronDown, ChevronRight, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CHECK_LABELS = {
  hub_order: "Hub Order",
  fulfillment_task: "Fulfillment Task",
  production_batch: "Production Batch",
  no_duplicate_orders: "No Duplicates",
  old_orders_retired: "Old Orders Retired",
};

const STATUS_CONFIG = {
  PASS: { icon: CheckCircle2, color: "text-status-success", bg: "bg-status-success-bg border-status-success-border", label: "PASS" },
  WARN: { icon: AlertTriangle, color: "text-status-warning", bg: "bg-status-warning-bg border-status-warning-border", label: "WARN" },
  FAIL: { icon: XCircle, color: "text-status-danger", bg: "bg-status-danger-bg border-status-danger-border", label: "FAIL" },
};

function CheckRow({ label, check }) {
  const status = check.pass === false ? "FAIL" : check.warn ? "WARN" : "PASS";
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-border/40 last:border-0">
      <Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${cfg.color}`} />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <p className="text-xs text-muted-foreground mt-0.5 break-words">{check.detail}</p>
      </div>
    </div>
  );
}

function OrderCard({ result }) {
  const [expanded, setExpanded] = useState(result.chain_status !== "PASS");
  const cfg = STATUS_CONFIG[result.chain_status];
  const Icon = cfg.icon;

  return (
    <Card className={`border ${cfg.bg}`}>
      <CardHeader className="pb-2 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className={`h-5 w-5 flex-shrink-0 ${cfg.color}`} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-foreground">{result.order_number}</span>
                <Badge variant="outline" className="text-xs">{result.order_type}</Badge>
                <Badge className={`text-xs ${cfg.color} bg-transparent border-current`}>{result.chain_status}</Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{result.customer_name} · {result.customer_email}</p>
              {result.stripe_subscription_id && (
                <p className="text-xs text-muted-foreground font-mono">{result.stripe_subscription_id}</p>
              )}
            </div>
          </div>
          <div className="flex-shrink-0">
            {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0">
          <div className="bg-card rounded-lg p-3 border border-border/40">
            {Object.entries(result.checks).map(([key, check]) => (
              <CheckRow key={key} label={CHECK_LABELS[key] || key} check={check} />
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default function LiveOrderMonitor() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lookback, setLookback] = useState("30");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const intervalRef = useRef(null);

  const runCheck = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke("monitorNewOrderChain", {
        lookback_minutes: parseInt(lookback),
      });
      setData(res.data);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runCheck();
  }, []);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (autoRefresh) {
      intervalRef.current = setInterval(runCheck, 60000); // every 60s
    }
    return () => clearInterval(intervalRef.current);
  }, [autoRefresh, lookback]);

  const overall = data?.overall;
  const overallCfg = overall ? STATUS_CONFIG[overall] : null;
  const OverallIcon = overallCfg?.icon;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Activity className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-semibold">Live Order Chain Monitor</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Watches new paid orders/subscriptions and verifies the full automatic chain completes. Read-only — no intervention.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={lookback} onValueChange={setLookback}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="10">Last 10 minutes</SelectItem>
            <SelectItem value="30">Last 30 minutes</SelectItem>
            <SelectItem value="60">Last 1 hour</SelectItem>
            <SelectItem value="180">Last 3 hours</SelectItem>
            <SelectItem value="360">Last 6 hours</SelectItem>
          </SelectContent>
        </Select>

        <Button onClick={runCheck} disabled={loading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Checking..." : "Run Check"}
        </Button>

        <Button
          variant={autoRefresh ? "default" : "outline"}
          onClick={() => setAutoRefresh(a => !a)}
          className="gap-2"
        >
          <Zap className="h-4 w-4" />
          {autoRefresh ? "Auto-refresh ON (60s)" : "Auto-refresh OFF"}
        </Button>

        {lastRefresh && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Last check: {lastRefresh.toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-status-danger-bg border border-status-danger-border text-status-danger text-sm">
          {error}
        </div>
      )}

      {/* Summary banner */}
      {data && (
        <>
          {data.status === "no_new_orders" ? (
            <div className="p-4 rounded-lg bg-status-info-bg border border-status-info-border text-status-info text-sm font-medium">
              ⏳ {data.message}
            </div>
          ) : (
            <>
              <div className={`p-4 rounded-lg border flex items-center gap-3 ${overallCfg?.bg}`}>
                {OverallIcon && <OverallIcon className={`h-6 w-6 flex-shrink-0 ${overallCfg?.color}`} />}
                <div>
                  <div className={`font-bold text-lg ${overallCfg?.color}`}>
                    Overall: {data.overall}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {data.orders_monitored} order(s) monitored in last {data.lookback_minutes} min ·{" "}
                    <span className="text-status-success font-medium">{data.summary.pass} passed</span>
                    {data.summary.warn > 0 && <span className="text-status-warning font-medium"> · {data.summary.warn} warned</span>}
                    {data.summary.fail > 0 && <span className="text-status-danger font-medium"> · {data.summary.fail} failed</span>}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {data.results.map(result => (
                  <OrderCard key={result.order_id} result={result} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {!data && !loading && !error && (
        <div className="text-center text-muted-foreground py-12">Click "Run Check" to start monitoring.</div>
      )}
    </div>
  );
}