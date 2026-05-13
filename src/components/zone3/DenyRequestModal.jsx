import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { XCircle, X, AlertTriangle } from 'lucide-react';

const DEFAULT_CUSTOMER_MESSAGE = 'Thank you for your interest in NuVira deliveries. Unfortunately, we are currently unable to service your delivery area at this time. We have added you to our priority waitlist and will reach out as soon as service expands to your neighborhood.';

const DENIAL_REASONS = [
  'Outside current service area',
  'Driver capacity not available for this route',
  'Route logistics not feasible at this time',
  'Insufficient cart value for extended delivery',
  'Customer request / order cancelled',
];

export default function DenyRequestModal({ request, onClose, onSuccess }) {
  const [denialReason, setDenialReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [customerMessage, setCustomerMessage] = useState(DEFAULT_CUSTOMER_MESSAGE);
  const [addWaitlist, setAddWaitlist] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const finalReason = denialReason === 'custom' ? customReason : denialReason;
  const canSubmit = finalReason.trim() && customerMessage.trim() && !loading;

  const handleDeny = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await base44.functions.invoke('denyZone3DeliveryRequest', {
        request_id: request.id,
        denial_reason: finalReason,
        customer_message: customerMessage,
        add_to_waitlist: addWaitlist,
      });
      if (res.data?.error) throw new Error(res.data.error);
      onSuccess(res.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-md my-6">
        {/* Header */}
        <div className="bg-red-600 px-5 py-4 rounded-t-2xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <XCircle className="w-5 h-5 text-white" />
            <div>
              <p className="text-white font-bold text-sm">Deny Zone 3 Request</p>
              <p className="text-white/80 text-[11px]">{request.request_number} · {request.customer_name}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700">
            This will cancel the payment hold on the customer's card and release the authorization.
          </div>

          {/* Denial reason */}
          <div>
            <p className="text-xs font-semibold mb-2">Reason for Denial <span className="text-red-500">*</span></p>
            <div className="space-y-1.5">
              {DENIAL_REASONS.map(r => (
                <label key={r} className={`flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer text-sm transition-colors ${
                  denialReason === r ? 'bg-red-50 border-red-300' : 'border-border hover:bg-muted/30'
                }`}>
                  <input type="radio" name="reason" checked={denialReason === r} onChange={() => setDenialReason(r)} className="accent-red-600" />
                  {r}
                </label>
              ))}
              <label className={`flex items-center gap-2.5 p-2.5 rounded-xl border cursor-pointer text-sm transition-colors ${
                denialReason === 'custom' ? 'bg-red-50 border-red-300' : 'border-border hover:bg-muted/30'
              }`}>
                <input type="radio" name="reason" checked={denialReason === 'custom'} onChange={() => setDenialReason('custom')} className="accent-red-600" />
                Other (specify)
              </label>
            </div>
            {denialReason === 'custom' && (
              <textarea
                rows={2}
                placeholder="Describe the reason..."
                value={customReason}
                onChange={e => setCustomReason(e.target.value)}
                className="mt-2 w-full text-sm border border-border rounded-lg px-3 py-2 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              />
            )}
          </div>

          {/* Customer-facing message */}
          <div>
            <p className="text-xs font-semibold mb-1">Customer-Facing Message <span className="text-red-500">*</span></p>
            <p className="text-[10px] text-muted-foreground mb-1.5">Keep this polite and operational. Do not use location judgment language.</p>
            <textarea
              rows={4}
              value={customerMessage}
              onChange={e => setCustomerMessage(e.target.value)}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Waitlist toggle */}
          <label className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl border border-border cursor-pointer">
            <input type="checkbox" checked={addWaitlist} onChange={e => setAddWaitlist(e.target.checked)} className="accent-primary w-4 h-4" />
            <div>
              <p className="text-sm font-medium">Add to Zone 3 Waitlist</p>
              <p className="text-[10px] text-muted-foreground">Customer will be contacted when delivery service expands to their area.</p>
            </div>
          </label>

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <Button variant="outline" onClick={onClose} className="flex-1" disabled={loading}>Cancel</Button>
            <Button
              onClick={handleDeny}
              disabled={!canSubmit}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white gap-2"
            >
              <XCircle className="w-4 h-4" />
              {loading ? 'Denying...' : 'Deny & Cancel Hold'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}