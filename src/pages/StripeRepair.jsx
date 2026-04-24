import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { AlertCircle, CheckCircle2, Loader, RefreshCw, Search } from 'lucide-react';

export default function StripeRepair() {
  const [action, setAction] = useState('recover_session');
  const [sessionId, setSessionId] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [eventId, setEventId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleRecovery = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const payload = { action };
      if (action === 'recover_session') payload.session_id = sessionId;
      if (action === 'recover_customer') payload.customer_email = customerEmail;
      if (action === 'process_event') payload.event_id = eventId;

      const res = await base44.functions.invoke('stripeOrderRecovery', payload);
      setResult(res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Stripe Order Recovery</h1>
        <p className="text-muted-foreground">Admin tool to recover missing or malformed Stripe orders</p>
      </div>

      <Card className="p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">Recovery Action</label>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="w-full border rounded-lg px-3 py-2"
          >
            <option value="recover_session">Recover by Checkout Session ID</option>
            <option value="recover_customer">Recover All Orders by Customer Email</option>
            <option value="process_event">Process Stripe Event by Event ID</option>
            <option value="list_failed_events">List Unprocessed Events (Last 72h)</option>
            <option value="get_history">Get Event History for Session</option>
          </select>
        </div>

        {action === 'recover_session' && (
          <div>
            <label className="block text-sm font-medium mb-2">Checkout Session ID</label>
            <Input
              placeholder="cs_test_..."
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
            />
          </div>
        )}

        {action === 'recover_customer' && (
          <div>
            <label className="block text-sm font-medium mb-2">Customer Email</label>
            <Input
              placeholder="customer@example.com"
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
            />
          </div>
        )}

        {action === 'process_event' && (
          <div>
            <label className="block text-sm font-medium mb-2">Stripe Event ID</label>
            <Input
              placeholder="evt_..."
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
            />
          </div>
        )}

        {action === 'get_history' && (
          <div>
            <label className="block text-sm font-medium mb-2">Checkout Session ID</label>
            <Input
              placeholder="cs_test_..."
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
            />
          </div>
        )}

        <Button
          onClick={handleRecovery}
          disabled={loading}
          className="w-full gap-2"
        >
          {loading ? <Loader className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {loading ? 'Processing...' : 'Run Recovery'}
        </Button>
      </Card>

      {error && (
        <Card className="p-4 bg-red-50 border-red-200">
          <div className="flex gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-red-900">Error</p>
              <p className="text-sm text-red-700 mt-1">{error}</p>
            </div>
          </div>
        </Card>
      )}

      {result && (
        <Card className="p-4 bg-emerald-50 border-emerald-200 space-y-3">
          <div className="flex gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-emerald-900">Success</p>
              <p className="text-sm text-emerald-700 mt-1">{result.message || 'Recovery completed'}</p>
            </div>
          </div>

          <div className="bg-white rounded-lg p-3 text-xs font-mono space-y-1 max-h-48 overflow-auto">
            {Object.entries(result).map(([key, value]) => (
              <div key={key} className="flex justify-between gap-4">
                <span className="text-gray-500 font-medium">{key}:</span>
                <span className="text-gray-700 text-right">
                  {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-4 bg-blue-50 border-blue-200">
        <p className="text-sm text-blue-900">
          <strong>How it works:</strong> This tool can recover orders from Stripe in case webhooks failed or events were missed. It fetches the latest data from Stripe and creates/updates orders in the NuVira database.
        </p>
      </Card>
    </div>
  );
}