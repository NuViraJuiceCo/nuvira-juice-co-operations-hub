import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { AlertTriangle, CheckCircle2, XCircle, RefreshCw, Database, Shield, Key, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function ShopifyConnectionAudit() {
  const { user } = useAuth();
  const [auditRunning, setAuditRunning] = useState(false);
  const [auditResults, setAuditResults] = useState(null);
  const [error, setError] = useState(null);

  const runAudit = async () => {
    setAuditRunning(true);
    setError(null);
    try {
      const res = await base44.functions.invoke("auditShopifyConnection", {});
      setAuditResults(res.data);
    } catch (err) {
      setError(err.message || "Audit failed");
    } finally {
      setAuditRunning(false);
    }
  };

  useEffect(() => {
    runAudit();
  }, []);

  if (!user || user.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8 space-y-4">
        <AlertTriangle className="h-12 w-12 text-amber-500" />
        <h2 className="text-xl font-semibold text-foreground">Admin Access Required</h2>
        <p className="text-muted-foreground">Shopify connection audit is restricted to admin users only.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Shopify Connection Audit</h1>
          <p className="text-muted-foreground text-sm">Verify Admin API connectivity, credentials, and scopes before webhook debugging</p>
        </div>
        <Button onClick={runAudit} disabled={auditRunning} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${auditRunning ? "animate-spin" : ""}`} />
          {auditRunning ? "Running Audit..." : "Re-run Audit"}
        </Button>
      </div>

      {error && (
        <Card className="border-red-300 bg-red-50">
          <CardHeader>
            <CardTitle className="text-red-800 flex items-center gap-2">
              <XCircle className="h-5 w-5" />
              Audit Failed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-red-700 font-mono text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      {auditResults && (
        <div className="space-y-6">
          {/* Credentials Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Credentials Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    {auditResults.credentials.shop_domain_present ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <span className="text-sm font-medium">Shop Domain</span>
                  </div>
                  <p className="text-xs text-muted-foreground ml-6">
                    {auditResults.credentials.shop_domain_value}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    {auditResults.credentials.admin_token_present ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <span className="text-sm font-medium">Admin Token</span>
                  </div>
                  <p className="text-xs text-muted-foreground ml-6">
                    {auditResults.credentials.admin_token_present 
                      ? `${auditResults.credentials.admin_token_prefix} (${auditResults.credentials.admin_token_length} chars)`
                      : "MISSING"}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    {auditResults.credentials.webhook_secret_present ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <span className="text-sm font-medium">Webhook Secret</span>
                  </div>
                  <p className="text-xs text-muted-foreground ml-6">
                    {auditResults.credentials.webhook_secret_present 
                      ? `${auditResults.credentials.webhook_secret_length} chars`
                      : "MISSING"}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    {auditResults.credentials.credentials_complete ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <span className="text-sm font-medium">All Credentials</span>
                  </div>
                  <p className="text-xs text-muted-foreground ml-6">
                    {auditResults.credentials.credentials_complete ? "Complete" : "Incomplete"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* API Connectivity */}
          <Card className={auditResults.api_tests.connectivity === "PASS" ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50"}>
            <CardHeader>
              <CardTitle className={`flex items-center gap-2 ${auditResults.api_tests.connectivity === "PASS" ? "text-green-800" : "text-red-800"}`}>
                {auditResults.api_tests.connectivity === "PASS" ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : (
                  <XCircle className="h-5 w-5" />
                )}
                Admin API Connectivity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-mono">{auditResults.api_tests.shop_endpoint?.url}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={auditResults.api_tests.connectivity === "PASS" ? "default" : "destructive"}>
                  HTTP {auditResults.api_tests.shop_endpoint?.status} - {auditResults.api_tests.shop_endpoint?.status_text}
                </Badge>
              </div>
              
              {auditResults.api_tests.connectivity === "PASS" && auditResults.api_tests.shop_info && (
                <div className="bg-white rounded-lg p-3 text-sm space-y-1">
                  <p><strong>Shop:</strong> {auditResults.api_tests.shop_info.name}</p>
                  <p><strong>Domain:</strong> {auditResults.api_tests.shop_info.domain}</p>
                  <p><strong>Plan:</strong> {auditResults.api_tests.shop_info.plan_name}</p>
                </div>
              )}

              {auditResults.api_tests.error && (
                <div className="bg-white border border-red-200 rounded-lg p-3 text-xs font-mono text-red-700">
                  {auditResults.api_tests.error}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Orders Access */}
          {auditResults.api_tests.orders_access && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5" />
                  Orders API Access
                  <Badge variant={auditResults.api_tests.orders_access === "PASS" ? "default" : "destructive"}>
                    {auditResults.api_tests.orders_access}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {auditResults.order_samples && (
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <p className="text-2xl font-bold">{auditResults.order_samples.total_fetched || 0}</p>
                      <p className="text-xs text-muted-foreground">Total Orders</p>
                    </div>
                    <div className="text-center p-3 bg-green-50 border border-green-200 rounded-lg">
                      <p className="text-2xl font-bold text-green-700">{auditResults.order_samples.pos_count || 0}</p>
                      <p className="text-xs text-green-700">POS Orders</p>
                    </div>
                    <div className="text-center p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-2xl font-bold text-blue-700">{auditResults.order_samples.online_count || 0}</p>
                      <p className="text-xs text-blue-700">Online Orders</p>
                    </div>
                  </div>
                )}

                {auditResults.order_samples?.recent_orders?.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold">Recent Orders:</h4>
                    <div className="max-h-64 overflow-y-auto space-y-2">
                      {auditResults.order_samples.recent_orders.map((order, idx) => (
                        <div key={idx} className="border rounded-lg p-3 text-xs font-mono bg-muted/30">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-semibold">{order.order_number}</span>
                            <Badge variant={order.classification === "POS" ? "default" : "secondary"}>
                              {order.classification}
                            </Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                            <p>source_name: {order.source_name || "—"}</p>
                            <p>app_id: {order.app_id || "—"}</p>
                            <p>location_id: {order.location_id || "—"}</p>
                            <p>channel: {order.channel || "—"}</p>
                            <p>financial: {order.financial_status}</p>
                            <p>fulfillment: {order.fulfillment_status}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Recommendations */}
          <Card className="border-amber-300 bg-amber-50">
            <CardHeader>
              <CardTitle className="text-amber-800 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Recommendations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-amber-900">
                {auditResults.recommendations.map((rec, idx) => (
                  <li key={idx} className="flex gap-2">
                    <span className="font-bold">•</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Critical Issue Alert */}
          {auditResults.api_tests.connectivity === "FAIL" && (
            <Card className="border-red-500 bg-red-50">
              <CardHeader>
                <CardTitle className="text-red-800 flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  CRITICAL: Admin API Token Invalid
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-red-700">
                  The current <code className="bg-red-100 px-1 rounded">SHOPIFY_ADMIN_ACCESS_TOKEN</code> is not a valid Admin API access token.
                </p>
                <div className="bg-white border border-red-200 rounded-lg p-4 space-y-2 text-sm">
                  <p><strong>Issue:</strong> Token format <code className="text-red-600">shpss_*</code> indicates a Shopify app proxy token, not an Admin API token.</p>
                  <p><strong>Required:</strong> Admin API access tokens are typically longer and obtained through:</p>
                  <ol className="list-decimal list-inside space-y-1 ml-2">
                    <li>Custom app in Shopify Admin → Settings → Apps and sales channels</li>
                    <li>Develop apps → Create an app → Configure Admin API scopes</li>
                    <li>Required scopes: <code className="bg-muted px-1 rounded">read_orders</code>, <code className="bg-muted px-1 rounded">read_all_orders</code>, <code className="bg-muted px-1 rounded">read_products</code>, <code className="bg-muted px-1 rounded">read_inventory</code>, <code className="bg-muted px-1 rounded">read_locations</code></li>
                    <li>Install app → Copy Admin API access token</li>
                  </ol>
                </div>
                <p className="text-xs text-red-700">
                  <strong>Next Step:</strong> Update the <code className="bg-red-100 px-1 rounded">SHOPIFY_ADMIN_ACCESS_TOKEN</code> secret with a valid Admin API access token before proceeding with webhook debugging.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}