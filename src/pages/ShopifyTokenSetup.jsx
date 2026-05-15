import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { AlertTriangle, CheckCircle2, ChevronRight, ExternalLink, Key, RefreshCw, Shield, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const STEPS = [
  {
    id: 1,
    title: "Open Shopify Admin",
    description: "Log in to your Shopify store admin panel",
    action: "Go to https://j01hk0-yw.myshopify.com/admin",
  },
  {
    id: 2,
    title: "Navigate to Apps",
    description: "Go to Settings → Apps and sales channels",
    action: "Click 'Develop apps' (or 'Custom apps' if already visible)",
  },
  {
    id: 3,
    title: "Create Custom App",
    description: "Click 'Create an app' and give it a name",
    action: "Name it 'NuVira Hub Integration' or similar",
  },
  {
    id: 4,
    title: "Configure Admin API Scopes",
    description: "Click 'Configure Admin API integration' and select these scopes:",
    required_scopes: [
      "read_orders",
      "read_all_orders",
      "read_products",
      "read_inventory",
      "read_locations",
    ],
    action: "Click 'Save' after selecting all required scopes",
  },
  {
    id: 5,
    title: "Install App",
    description: "Go back to the app overview and click 'Install app'",
    action: "Confirm the installation when prompted",
  },
  {
    id: 6,
    title: "Copy Admin API Access Token",
    description: "After installation, you'll see 'Admin API access token'",
    action: "Click 'Reveal token once' and copy the FULL token (starts with 'shpat_')",
    warning: "⚠️ DO NOT copy the webhook signing secret or app proxy token",
  },
  {
    id: 7,
    title: "Update Base44 Secret",
    description: "Paste the token into Base44 secrets",
    action: "Go to Base44 Dashboard → Settings → Environment Variables → Edit SHOPIFY_ADMIN_ACCESS_TOKEN",
  },
  {
    id: 8,
    title: "Verify Connection",
    description: "Re-run the Shopify connection audit",
    action: "Click the 'Re-run Audit' button below or visit /shopify-audit",
  },
];

export default function ShopifyTokenSetup() {
  const { user } = useAuth();
  const [copiedStep, setCopiedStep] = useState(null);

  const copyToClipboard = (text, stepId) => {
    navigator.clipboard.writeText(text);
    setCopiedStep(stepId);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedStep(null), 2000);
  };

  const runQuickTest = async () => {
    try {
      const res = await base44.functions.invoke("auditShopifyConnection", {});
      if (res.data.api_tests?.connectivity === "PASS") {
        toast.success("✅ Shopify Admin API connected successfully!");
      } else {
        toast.error("❌ Connection still failing - check token");
      }
    } catch (err) {
      toast.error("Audit failed: " + err.message);
    }
  };

  if (!user || user.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8 space-y-4">
        <AlertTriangle className="h-12 w-12 text-amber-500" />
        <h2 className="text-xl font-semibold text-foreground">Admin Access Required</h2>
        <p className="text-muted-foreground">Token setup is restricted to admin users only.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-foreground">Shopify Admin API Token Setup</h1>
        <p className="text-muted-foreground">
          Replace the invalid <code className="bg-muted px-1 rounded">shpss_*</code> token with a proper Admin API access token
        </p>
      </div>

      {/* Current Status Alert */}
      <Card className="border-red-300 bg-red-50">
        <CardHeader>
          <CardTitle className="text-red-800 flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Current Issue
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-red-900">
          <p>
            The current <code className="bg-red-100 px-1 rounded font-mono">SHOPIFY_ADMIN_ACCESS_TOKEN</code> is invalid.
          </p>
          <p>
            <strong>Token format detected:</strong> <code className="font-mono">shpss_*</code> (app proxy/session token)
          </p>
          <p>
            <strong>Required format:</strong> <code className="font-mono">shpat_*</code> (Admin API access token)
          </p>
          <div className="flex gap-2 mt-3">
            <Button onClick={runQuickTest} variant="outline" size="sm" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Quick Connection Test
            </Button>
            <Button onClick={() => window.location.href = "/shopify-audit"} variant="outline" size="sm" className="gap-2">
              <ExternalLink className="h-4 w-4" />
              View Full Audit
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Step-by-Step Guide */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Step-by-Step Instructions</h2>
        {STEPS.map((step) => (
          <Card key={step.id}>
            <CardHeader>
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground text-sm font-bold">
                  {step.id}
                </div>
                <div className="flex-1">
                  <CardTitle className="text-base">{step.title}</CardTitle>
                  <CardDescription>{step.description}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="bg-muted/50 rounded-lg p-3 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <ChevronRight className="h-4 w-4" />
                  <span className="font-medium">Action:</span>
                </div>
                <p className="text-foreground">{step.action}</p>
              </div>

              {step.required_scopes && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Required API Scopes:</p>
                  <div className="flex flex-wrap gap-2">
                    {step.required_scopes.map((scope) => (
                      <Badge key={scope} variant="secondary" className="gap-1">
                        <Key className="h-3 w-3" />
                        {scope}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {step.warning && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex gap-2">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>{step.warning}</span>
                </div>
              )}

              {step.id === 6 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2 text-sm">
                  <p className="font-medium text-green-800">✅ Correct Token Format:</p>
                  <div className="flex items-center gap-2">
                    <code className="bg-white px-2 py-1 rounded text-green-700 font-mono text-xs">
                      shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard("shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", step.id)}
                      className="h-6 w-6 p-0"
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                  <p className="text-xs text-green-700">
                    Your actual token will be ~38-40 characters long and start with <code className="font-mono">shpat_</code>
                  </p>
                </div>
              )}

              {step.id === 7 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
                  <p className="font-medium text-blue-800 mb-2">Base44 Secret Name:</p>
                  <div className="flex items-center gap-2">
                    <code className="bg-white px-2 py-1 rounded text-blue-700 font-mono text-xs">
                      SHOPIFY_ADMIN_ACCESS_TOKEN
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard("SHOPIFY_ADMIN_ACCESS_TOKEN", step.id)}
                      className="h-6 w-6 p-0"
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Token Comparison Table */}
      <Card>
        <CardHeader>
          <CardTitle>Token Type Reference</CardTitle>
          <CardDescription>Know which token you're copying</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Token Type</th>
                  <th className="text-left p-2">Format</th>
                  <th className="text-left p-2">Use Case</th>
                  <th className="text-left p-2">Use for Hub?</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b bg-red-50">
                  <td className="p-2 font-medium">App Proxy Token</td>
                  <td className="p-2 font-mono">shpss_*</td>
                  <td className="p-2">App proxy requests</td>
                  <td className="p-2 text-red-600">❌ NO - This is what you have now</td>
                </tr>
                <tr className="border-b bg-red-50">
                  <td className="p-2 font-medium">Session Token</td>
                  <td className="p-2 font-mono">shpst_*</td>
                  <td className="p-2">Temporary sessions</td>
                  <td className="p-2 text-red-600">❌ NO</td>
                </tr>
                <tr className="border-b bg-amber-50">
                  <td className="p-2 font-medium">Webhook Secret</td>
                  <td className="p-2 font-mono">shpss_*</td>
                  <td className="p-2">HMAC verification</td>
                  <td className="p-2 text-amber-600">⚠️ Different secret (SHOPIFY_WEBHOOK_SECRET)</td>
                </tr>
                <tr className="border-b bg-green-50">
                  <td className="p-2 font-medium">Admin API Access Token</td>
                  <td className="p-2 font-mono">shpat_*</td>
                  <td className="p-2">Admin API calls</td>
                  <td className="p-2 text-green-600">✅ YES - This is what you need</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Next Steps */}
      <Card className="border-green-300 bg-green-50">
        <CardHeader>
          <CardTitle className="text-green-800 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" />
            After Updating the Token
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-green-900">
          <p>1. Re-run the <a href="/shopify-audit" className="underline font-medium">Shopify Connection Audit</a></p>
          <p>2. Verify Admin API connectivity shows green checkmark</p>
          <p>3. Confirm recent orders (including POS) are returned</p>
          <p>4. Proceed with POS order validation at <a href="/pos-validation" className="underline font-medium">/pos-validation</a></p>
        </CardContent>
      </Card>
    </div>
  );
}