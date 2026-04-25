import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { AlertCircle, CheckCircle2, Loader, Play, ChevronDown, ChevronUp } from 'lucide-react';

const TOOLS = [
  {
    group: 'Subscription Orders',
    items: [
      {
        id: 'rebuildAllSubscriptionOrders',
        label: 'Rebuild All Subscription Orders from Stripe',
        description: 'Scans every Stripe subscription and creates or updates the matching order in the hub. Safe to run anytime — will not overwrite production status or fulfillments.',
        fn: 'rebuildAllSubscriptionOrders',
        payload: {},
        inputs: [],
      },
    ],
  },
  {
    group: 'Order Recovery',
    items: [
      {
        id: 'recover_session',
        label: 'Recover Order by Checkout Session ID',
        description: 'Fetches a Stripe checkout session and creates/updates the matching order.',
        fn: 'stripeOrderRecovery',
        inputs: [{ key: 'session_id', label: 'Checkout Session ID', placeholder: 'cs_live_...' }],
        payload: { action: 'recover_session' },
      },
      {
        id: 'recover_customer',
        label: 'Recover All Orders by Customer Email',
        description: 'Scans Stripe for all payments by this email and syncs any missing orders.',
        fn: 'stripeOrderRecovery',
        inputs: [{ key: 'customer_email', label: 'Customer Email', placeholder: 'customer@example.com' }],
        payload: { action: 'recover_customer' },
      },
      {
        id: 'fullOrderRecovery',
        label: 'Full Order Recovery',
        description: 'Broad recovery scan across all recent Stripe events.',
        fn: 'fullOrderRecovery',
        payload: {},
        inputs: [],
      },
    ],
  },
  {
    group: 'Diagnostics',
    items: [
      {
        id: 'detectBrokenStripeOrders',
        label: 'Detect Broken / Inconsistent Orders',
        description: 'Scans all orders and reports any with missing data, bad sync status, or Stripe mismatches.',
        fn: 'detectBrokenStripeOrders',
        payload: {},
        inputs: [],
      },
      {
        id: 'detectMissingStripeOrders',
        label: 'Detect Missing Stripe Orders',
        description: 'Compares Stripe payments against hub orders and lists any that are absent.',
        fn: 'detectMissingStripeOrders',
        payload: {},
        inputs: [],
      },
      {
        id: 'checkLatestOrderSync',
        label: 'Check Latest Order Sync Status',
        description: 'Shows the most recent sync activity and any errors.',
        fn: 'checkLatestOrderSync',
        payload: {},
        inputs: [],
      },
      {
        id: 'list_failed_events',
        label: 'List Unprocessed Stripe Events (Last 72h)',
        description: 'Shows Stripe events that were received but not successfully processed.',
        fn: 'stripeOrderRecovery',
        payload: { action: 'list_failed_events' },
        inputs: [],
      },
    ],
  },
  {
    group: 'Reconciliation',
    items: [
      {
        id: 'reconcileStripeOrders',
        label: 'Reconcile Stripe Orders',
        description: 'Cross-checks orders against Stripe and repairs data discrepancies.',
        fn: 'reconcileStripeOrders',
        payload: {},
        inputs: [],
      },
      {
        id: 'autoRemediateStripeOrders',
        label: 'Auto-Remediate Stripe Orders',
        description: 'Automatically fixes common order data issues detected in the hub.',
        fn: 'autoRemediateStripeOrders',
        payload: {},
        inputs: [],
      },
    ],
  },
];

function ToolCard({ tool }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [inputValues, setInputValues] = useState({});

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const payload = { ...tool.payload };
      for (const inp of tool.inputs || []) {
        payload[inp.key] = inputValues[inp.key] || '';
      }
      const res = await base44.functions.invoke(tool.fn, payload);
      setResult(res.data);
      setOpen(true);
    } catch (err) {
      setError(err.message);
      setOpen(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-foreground">{tool.label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{tool.description}</p>
        </div>
        <Button size="sm" onClick={run} disabled={loading} className="gap-1.5 shrink-0">
          {loading ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {loading ? 'Running...' : 'Run'}
        </Button>
      </div>

      {tool.inputs?.length > 0 && (
        <div className="grid gap-2">
          {tool.inputs.map(inp => (
            <Input
              key={inp.key}
              placeholder={inp.placeholder || inp.label}
              value={inputValues[inp.key] || ''}
              onChange={e => setInputValues(v => ({ ...v, [inp.key]: e.target.value }))}
            />
          ))}
        </div>
      )}

      {(result || error) && (
        <div>
          <button
            onClick={() => setOpen(o => !o)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2"
          >
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {open ? 'Hide' : 'Show'} result
          </button>
          {open && (
            error ? (
              <div className="flex gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
                <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            ) : (
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 space-y-1">
                <div className="flex gap-2 mb-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <p className="text-sm font-medium text-emerald-900">{result?.message || 'Completed'}</p>
                </div>
                <pre className="text-xs text-gray-700 font-mono whitespace-pre-wrap max-h-60 overflow-auto bg-white rounded p-2">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            )
          )}
        </div>
      )}
    </Card>
  );
}

export default function StripeRepair() {
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Admin Function Runner</h1>
        <p className="text-muted-foreground mt-1">Run diagnostic and repair functions directly from the dashboard.</p>
      </div>

      {TOOLS.map(group => (
        <div key={group.group} className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{group.group}</h2>
          {group.items.map(tool => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      ))}
    </div>
  );
}