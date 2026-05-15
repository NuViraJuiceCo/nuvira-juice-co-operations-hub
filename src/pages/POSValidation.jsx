import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { CheckCircle2, XCircle, Clock, RefreshCw, ShoppingCart, AlertTriangle, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import moment from "moment";

const CHECKS = [
  { id: "appears_in_orders", label: "Order appears in Orders page" },
  { id: "pos_badge", label: "Order shows 🏪 POS / Event badge" },
  { id: "payment_paid", label: "payment_status = paid" },
  { id: "fulfillment_fulfilled", label: "fulfillment_status = fulfilled" },
  { id: "production_not_required", label: "production_status = not_required" },
  { id: "source_type_pos", label: "source_type = shopify_pos" },
  { id: "no_address_warning", label: "No delivery address warning shown" },
  { id: "not_in_fulfillment", label: "Order NOT in active Fulfillment queue" },
  { id: "not_in_production", label: "Order NOT in Production Planning demand" },
  { id: "visible_in_reporting", label: "Order visible in Revenue / Reporting" },
];

const STATUS = { pass: "pass", fail: "fail", pending: "pending" };

function StatusIcon({ status }) {
  if (status === STATUS.pass) return <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />;
  if (status === STATUS.fail) return <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />;
  return <Clock className="h-5 w-5 text-muted-foreground flex-shrink-0" />;
}

export default function POSValidation() {
  const [orderNumber, setOrderNumber] = useState("");
  const [foundOrder, setFoundOrder] = useState(null);
  const [searching, setSearching] = useState(false);
  const [checks, setChecks] = useState(() =>
    Object.fromEntries(CHECKS.map((c) => [c.id, STATUS.pending]))
  );
  const [autoRunDone, setAutoRunDone] = useState(false);
  const [copied, setCopied] = useState(false);

  const searchOrder = async () => {
    if (!orderNumber.trim()) return;
    setSearching(true);
    setFoundOrder(null);
    setAutoRunDone(false);
    setChecks(Object.fromEntries(CHECKS.map((c) => [c.id, STATUS.pending])));
    try {
      const results = await base44.entities.ShopifyOrder.filter({ shopify_order_number: orderNumber.trim() });
      if (results && results.length > 0) {
        setFoundOrder(results[0]);
      } else {
        // Try partial match via list
        const all = await base44.entities.ShopifyOrder.list("-created_date", 50);
        const match = all.find(
          (o) =>
            o.shopify_order_number?.toLowerCase().includes(orderNumber.trim().toLowerCase())
        );
        setFoundOrder(match || null);
      }
    } finally {
      setSearching(false);
    }
  };

  // Auto-run checks whenever foundOrder changes
  useEffect(() => {
    if (!foundOrder || autoRunDone) return;
    const o = foundOrder;
    const isPOS =
      o.source_type === "shopify_pos" ||
      o.source_channel === "pos" ||
      o.order_type === "pos" ||
      o.fulfillment_method === "pos";

    setChecks({
      appears_in_orders: STATUS.pass, // if we found it, it's in the DB / Orders page
      pos_badge: isPOS ? STATUS.pass : STATUS.fail,
      payment_paid: o.payment_status === "paid" ? STATUS.pass : STATUS.fail,
      fulfillment_fulfilled:
        ["fulfilled", "completed"].includes(o.fulfillment_status) ? STATUS.pass : STATUS.fail,
      production_not_required:
        o.production_status === "not_required" ? STATUS.pass : STATUS.fail,
      source_type_pos: o.source_type === "shopify_pos" ? STATUS.pass : STATUS.fail,
      no_address_warning:
        o.fulfillment_method === "pos" || !o.address_line1 ? STATUS.pass : STATUS.pending,
      // These three need manual confirmation — they check OTHER pages
      not_in_fulfillment: STATUS.pending,
      not_in_production: STATUS.pending,
      visible_in_reporting: STATUS.pending,
    });
    setAutoRunDone(true);
  }, [foundOrder, autoRunDone]);

  const setCheck = (id, val) => setChecks((prev) => ({ ...prev, [id]: val }));

  const passed = Object.values(checks).filter((v) => v === STATUS.pass).length;
  const failed = Object.values(checks).filter((v) => v === STATUS.fail).length;
  const pending = Object.values(checks).filter((v) => v === STATUS.pending).length;
  const allPassed = passed === CHECKS.length;

  const copyEndpointInfo = () => {
    const info = `ingestShopifyPOSOrder endpoint\n\nHeader: Authorization: Bearer <CUSTOMER_APP_SYNC_SECRET>\nPayload:\n${JSON.stringify({
      order_number: "#POS-TEST-001",
      customer_name: "Walk-in Customer",
      customer_email: "event@example.com",
      line_items: [{ title: "Aura", quantity: 1, price: 12.0 }, { title: "Re-Nu", quantity: 1, price: 12.0 }],
      total_price: 24.0,
      source_name: "pos",
      channel: "pos",
      pos_location_name: "Wellness Expo 2026",
    }, null, 2)}`;
    navigator.clipboard.writeText(info);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">POS Order Validation</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Validate that a real Shopify POS test sale flows correctly through the Hub.
        </p>
      </div>

      {/* Step 1 — Create the POS order */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <h2 className="font-semibold text-foreground flex items-center gap-2">
          <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">1</span>
          Create a Shopify POS Test Sale
        </h2>
        <div className="text-sm text-muted-foreground space-y-1.5">
          <p>Open the <strong>Shopify POS app</strong> on your device or use the Shopify Admin POS emulator.</p>
          <p>Add <strong>1× Aura</strong> and <strong>1× Re-Nu</strong> to the cart.</p>
          <p>Complete the sale using <strong>Cash</strong> or <strong>Manual</strong> payment.</p>
          <p>Void or refund the transaction after validation if needed.</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">
            <strong>If Shopify webhook is not yet wired to <code>ingestShopifyPOSOrder</code>:</strong> use the manual ingestion payload below to simulate the POS order flowing into the Hub via the endpoint.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={copyEndpointInfo} className="gap-2 text-xs">
          <Copy className="h-3.5 w-3.5" />
          {copied ? "Copied!" : "Copy Manual Ingestion Payload"}
        </Button>
      </div>

      {/* Step 2 — Find the order */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <h2 className="font-semibold text-foreground flex items-center gap-2">
          <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">2</span>
          Find the Order in Hub
        </h2>
        <div className="flex gap-2">
          <Input
            placeholder="Enter POS order number (e.g. #POS-001 or #1234)"
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchOrder()}
            className="flex-1"
          />
          <Button onClick={searchOrder} disabled={searching} className="gap-2 flex-shrink-0">
            <RefreshCw className={`h-4 w-4 ${searching ? "animate-spin" : ""}`} />
            {searching ? "Searching…" : "Find"}
          </Button>
        </div>

        {foundOrder && (
          <div className="bg-muted/40 rounded-lg p-4 space-y-2 text-sm">
            <p className="font-semibold text-foreground">{foundOrder.shopify_order_number}</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
              <span><span className="text-muted-foreground">Customer:</span> {foundOrder.customer_name || "—"}</span>
              <span><span className="text-muted-foreground">Email:</span> {foundOrder.customer_email || "—"}</span>
              <span><span className="text-muted-foreground">source_type:</span> <code className="bg-muted px-1 rounded">{foundOrder.source_type || "—"}</code></span>
              <span><span className="text-muted-foreground">order_type:</span> <code className="bg-muted px-1 rounded">{foundOrder.order_type || "—"}</code></span>
              <span><span className="text-muted-foreground">payment_status:</span> <code className="bg-muted px-1 rounded">{foundOrder.payment_status || "—"}</code></span>
              <span><span className="text-muted-foreground">fulfillment_status:</span> <code className="bg-muted px-1 rounded">{foundOrder.fulfillment_status || "—"}</code></span>
              <span><span className="text-muted-foreground">production_status:</span> <code className="bg-muted px-1 rounded">{foundOrder.production_status || "—"}</code></span>
              <span><span className="text-muted-foreground">fulfillment_method:</span> <code className="bg-muted px-1 rounded">{foundOrder.fulfillment_method || "—"}</code></span>
              <span className="col-span-2"><span className="text-muted-foreground">tags:</span> <code className="bg-muted px-1 rounded">{(foundOrder.tags || []).join(", ") || "none"}</code></span>
              <span className="col-span-2"><span className="text-muted-foreground">internal_notes:</span> {foundOrder.internal_notes || "—"}</span>
              <span className="col-span-2"><span className="text-muted-foreground">Created:</span> {moment(foundOrder.created_date).format("MMM D, YYYY h:mm A")}</span>
            </div>
          </div>
        )}

        {!foundOrder && autoRunDone === false && orderNumber && !searching && (
          <p className="text-sm text-red-600">⚠ Order not found in Hub. Make sure the POS sale was processed and the webhook or manual ingestion ran.</p>
        )}
      </div>

      {/* Step 3 — Checklist */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">3</span>
            Acceptance Checklist
          </h2>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-green-600 font-semibold">{passed} passed</span>
            {failed > 0 && <span className="text-red-500 font-semibold">{failed} failed</span>}
            {pending > 0 && <span className="text-muted-foreground">{pending} pending</span>}
          </div>
        </div>

        <div className="space-y-2">
          {CHECKS.map((check) => (
            <div
              key={check.id}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                checks[check.id] === STATUS.pass
                  ? "bg-green-50 border-green-200"
                  : checks[check.id] === STATUS.fail
                  ? "bg-red-50 border-red-200"
                  : "bg-muted/30 border-border"
              }`}
            >
              <StatusIcon status={checks[check.id]} />
              <span className={`flex-1 text-sm ${checks[check.id] === STATUS.fail ? "text-red-700" : "text-foreground"}`}>
                {check.label}
              </span>
              <div className="flex gap-1 flex-shrink-0">
                <button
                  onClick={() => setCheck(check.id, STATUS.pass)}
                  className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors ${checks[check.id] === STATUS.pass ? "bg-green-600 text-white" : "bg-muted text-muted-foreground hover:bg-green-100 hover:text-green-700"}`}
                >
                  ✓
                </button>
                <button
                  onClick={() => setCheck(check.id, STATUS.fail)}
                  className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors ${checks[check.id] === STATUS.fail ? "bg-red-600 text-white" : "bg-muted text-muted-foreground hover:bg-red-100 hover:text-red-700"}`}
                >
                  ✗
                </button>
                <button
                  onClick={() => setCheck(check.id, STATUS.pending)}
                  className="px-2 py-1 rounded text-[11px] font-semibold bg-muted text-muted-foreground hover:bg-muted/80"
                >
                  ?
                </button>
              </div>
            </div>
          ))}
        </div>

        {allPassed && (
          <div className="bg-green-50 border border-green-300 rounded-xl p-4 text-center">
            <CheckCircle2 className="h-8 w-8 text-green-600 mx-auto mb-2" />
            <p className="font-bold text-green-800 text-lg">POS Validation Complete ✓</p>
            <p className="text-green-700 text-sm mt-1">All acceptance criteria passed. Shopify POS orders are fully supported.</p>
          </div>
        )}

        {failed > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
            <strong>{failed} check{failed > 1 ? "s" : ""} failed.</strong> Review the order data above and the corresponding Hub pages (Fulfillment, Production Planning, Reporting) to investigate.
          </div>
        )}
      </div>

      {/* Step 4 — Manual checks */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-2">
        <h2 className="font-semibold text-foreground flex items-center gap-2">
          <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">4</span>
          Manual Cross-Page Verification
        </h2>
        <p className="text-sm text-muted-foreground">Navigate to these pages and manually confirm, then mark above:</p>
        <ul className="text-sm space-y-2 text-muted-foreground">
          <li className="flex gap-2"><ShoppingCart className="h-4 w-4 flex-shrink-0 mt-0.5 text-primary" /><span><strong>Fulfillment page</strong> → Orders view → confirm POS order is <em>absent</em> (or clearly excluded)</span></li>
          <li className="flex gap-2"><ShoppingCart className="h-4 w-4 flex-shrink-0 mt-0.5 text-primary" /><span><strong>Production Planning</strong> → confirm POS order does not appear in demand rows</span></li>
          <li className="flex gap-2"><ShoppingCart className="h-4 w-4 flex-shrink-0 mt-0.5 text-primary" /><span><strong>Reporting</strong> → confirm POS sale total appears in revenue figures</span></li>
        </ul>
      </div>
    </div>
  );
}