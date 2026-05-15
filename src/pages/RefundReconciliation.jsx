import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { AlertTriangle, CheckCircle2, XCircle, RefreshCw, TrendingUp, Package, Zap, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function RefundReconciliation() {
  const { user } = useAuth();
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  const runReconciliation = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await base44.functions.invoke("reconcileRefundedPOSOrders", {});
      setReport(res.data);
    } catch (err) {
      setError(err.message || "Reconciliation failed");
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    runReconciliation();
  }, []);

  if (!user || user.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8 space-y-4">
        <AlertTriangle className="h-12 w-12 text-amber-500" />
        <h2 className="text-xl font-semibold text-foreground">Admin Access Required</h2>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Refund Reconciliation</h1>
          <p className="text-muted-foreground text-sm">Validate refunded POS orders and dashboard revenue accuracy</p>
        </div>
        <Button onClick={runReconciliation} disabled={running} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${running ? "animate-spin" : ""}`} />
          {running ? "Running..." : "Run Reconciliation"}
        </Button>
      </div>

      {error && (
        <Card className="border-red-300 bg-red-50">
          <CardHeader>
            <CardTitle className="text-red-800 flex items-center gap-2">
              <XCircle className="h-5 w-5" />
              Error
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-red-700 font-mono text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      {report && (
        <div className="space-y-6">
          {/* Status Overview */}
          <Card className={report.status === "SUCCESS" ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50"}>
            <CardHeader>
              <CardTitle className={`flex items-center gap-2 ${report.status === "SUCCESS" ? "text-green-800" : "text-amber-800"}`}>
                {report.status === "SUCCESS" ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : (
                  <AlertCircle className="h-5 w-5" />
                )}
                {report.status}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">{new Date(report.timestamp).toLocaleString()}</p>
            </CardContent>
          </Card>

          {/* Refund Reconciliation Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Refund Reconciliation Results
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-2xl font-bold">{report.refund_reconciliation.total_refunded_pos_orders}</p>
                  <p className="text-xs text-muted-foreground">Total Refunded</p>
                </div>
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-2xl font-bold text-green-700">{report.refund_reconciliation.fully_refunded}</p>
                  <p className="text-xs text-green-700">Fully Refunded</p>
                </div>
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-2xl font-bold text-amber-700">{report.refund_reconciliation.partially_refunded}</p>
                  <p className="text-xs text-amber-700">Partially Refunded</p>
                </div>
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-2xl font-bold text-blue-700">{report.refund_reconciliation.updated}</p>
                  <p className="text-xs text-blue-700">Updated</p>
                </div>
              </div>

              {report.refund_reconciliation.errors.length > 0 && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm font-semibold text-red-800 mb-2">Errors:</p>
                  {report.refund_reconciliation.errors.map((err, idx) => (
                    <p key={idx} className="text-xs text-red-700">
                      {err.order_number}: {err.error}
                    </p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Validation Checks */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Validation Checks
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Revenue Calculation */}
              {report.validation_checks.revenue_calculation && (
                <div className="border rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <span className="font-semibold text-sm">Revenue Calculation</span>
                    <Badge variant={report.validation_checks.revenue_calculation.status === "PASS" ? "default" : "destructive"}>
                      {report.validation_checks.revenue_calculation.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{report.validation_checks.revenue_calculation.message}</p>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Net Revenue:</span>
                      <p className="font-bold text-green-700">${report.validation_checks.revenue_calculation.net_revenue.toFixed(2)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Refunded:</span>
                      <p className="font-bold text-red-700">${report.validation_checks.revenue_calculation.refunded_revenue.toFixed(2)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Count:</span>
                      <p className="font-bold">{report.validation_checks.revenue_calculation.refunded_orders_count}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Fulfillment Exclusion */}
              {report.validation_checks.fulfillment_exclusion && (
                <div className="border rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <span className="font-semibold text-sm">Fulfillment Exclusion</span>
                    <Badge variant={report.validation_checks.fulfillment_exclusion.status === "PASS" ? "default" : "destructive"}>
                      {report.validation_checks.fulfillment_exclusion.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{report.validation_checks.fulfillment_exclusion.message}</p>
                </div>
              )}

              {/* Production Planning Exclusion */}
              {report.validation_checks.production_planning_exclusion && (
                <div className="border rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <span className="font-semibold text-sm">Production Planning Exclusion</span>
                    <Badge variant={report.validation_checks.production_planning_exclusion.status === "PASS" ? "default" : "destructive"}>
                      {report.validation_checks.production_planning_exclusion.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{report.validation_checks.production_planning_exclusion.message}</p>
                </div>
              )}

              {/* Payment Status Accuracy */}
              {report.validation_checks.payment_status_accuracy && (
                <div className="border rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <span className="font-semibold text-sm">Payment Status Accuracy</span>
                    <Badge variant="default">
                      {report.validation_checks.payment_status_accuracy.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{report.validation_checks.payment_status_accuracy.message}</p>
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    {Object.entries(report.validation_checks.payment_status_accuracy.breakdown).map(([status, count]) => (
                      <div key={status}>
                        <span className="text-muted-foreground capitalize">{status}:</span>
                        <p className="font-bold">{count}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Acceptance Criteria */}
          <Card className="border-green-300 bg-green-50">
            <CardHeader>
              <CardTitle className="text-green-800 flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5" />
                Acceptance Criteria Met ({report.acceptance_criteria_met.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {report.acceptance_criteria_met.map((criterion, idx) => (
                  <li key={idx} className="flex items-center gap-2 text-sm text-green-800">
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                    {criterion}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Issues */}
          {report.issues.length > 0 && (
            <Card className="border-red-300 bg-red-50">
              <CardHeader>
                <CardTitle className="text-red-800 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Issues ({report.issues.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {report.issues.map((issue, idx) => (
                    <li key={idx} className="text-sm text-red-800">• {issue}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}