import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { CheckCircle2, X, AlertTriangle, DollarSign } from 'lucide-react';
import moment from 'moment';

const FEE_OPTIONS = [
  { label: '$12.99 — Standard (25–30 mi)', value: 12.99 },
  { label: '$15.99 — Extended (30–35 mi)', value: 15.99 },
  { label: 'Custom Fee', value: 'custom' },
];

export default function ApproveRequestModal({ request, onClose, onSuccess }) {
  const [selectedFee, setSelectedFee] = useState(() => {
    const dist = request.estimated_distance_miles || 0;
    return dist <= 30 ? 12.99 : 15.99;
  });
  const [customFee, setCustomFee] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [feeReason, setFeeReason] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const finalFee = useCustom ? parseFloat(customFee) || 0 : selectedFee;
  const totalCapture = (request.cart_subtotal || 0) + finalFee;
  const canSubmit = (!useCustom || (customFee && feeReason.trim())) && !loading;

  const handleApprove = async () => {
    if (useCustom && !feeReason.trim()) {
      setError('A reason is required for custom delivery fees.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await base44.functions.invoke('approveZone3DeliveryRequest', {
        request_id: request.id,
        approved_delivery_fee: finalFee,
        fee_reason: feeReason,
        admin_notes: adminNotes,
      });
      if (res.data?.error) throw new Error(res.data.error);
      onSuccess({ ...res.data, approved_fee: finalFee });
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
        <div className="bg-green-600 px-5 py-4 rounded-t-2xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-white" />
            <div>
              <p className="text-white font-bold text-sm">Approve Zone 3 Request</p>
              <p className="text-white/80 text-[11px]">{request.request_number} · {request.customer_name}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Order summary */}
          <div className="bg-muted/30 rounded-xl p-3 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Cart Subtotal</span><span className="font-medium">${(request.cart_subtotal || 0).toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Distance</span><span className="font-medium">{request.estimated_distance_miles} mi · {request.estimated_drive_time_minutes} min</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Auth on Hold</span><span className="font-medium">${(request.amount_authorized || 0).toFixed(2)}</span></div>
            <div className="flex justify-between text-amber-700 text-xs">
              <span>Auth Expires</span>
              <span>{request.authorization_expires_at ? moment(request.authorization_expires_at).format('MMM D, YYYY h:mm A') : '—'}</span>
            </div>
          </div>

          {/* Delivery fee selection */}
          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Select Delivery Fee</p>
            <div className="space-y-2">
              {FEE_OPTIONS.map(opt => (
                <label key={opt.label} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  (opt.value === 'custom' ? useCustom : !useCustom && selectedFee === opt.value)
                    ? 'bg-green-50 border-green-400'
                    : 'bg-background border-border hover:bg-muted/30'
                }`}>
                  <input
                    type="radio"
                    name="fee"
                    checked={opt.value === 'custom' ? useCustom : !useCustom && selectedFee === opt.value}
                    onChange={() => {
                      if (opt.value === 'custom') { setUseCustom(true); }
                      else { setUseCustom(false); setSelectedFee(opt.value); }
                    }}
                    className="accent-green-600"
                  />
                  <span className="text-sm font-medium">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Custom fee input */}
          {useCustom && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-muted-foreground" />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Custom fee e.g. 18.00"
                  value={customFee}
                  onChange={e => setCustomFee(e.target.value)}
                  className="flex-1 text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <textarea
                rows={2}
                placeholder="Reason for custom fee (required) *"
                value={feeReason}
                onChange={e => setFeeReason(e.target.value)}
                className="w-full text-sm border border-amber-300 rounded-lg px-3 py-2 bg-amber-50 resize-none focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
            </div>
          )}

          {/* Total capture */}
          <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex justify-between items-center">
            <span className="text-sm font-semibold text-green-800">Total to Capture</span>
            <span className="text-lg font-bold text-green-700">${totalCapture.toFixed(2)}</span>
          </div>

          {/* Admin notes */}
          <textarea
            rows={2}
            placeholder="Route notes / approval notes (optional)"
            value={adminNotes}
            onChange={e => setAdminNotes(e.target.value)}
            className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          />

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <Button variant="outline" onClick={onClose} className="flex-1" disabled={loading}>Cancel</Button>
            <Button
              onClick={handleApprove}
              disabled={!canSubmit}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              {loading ? 'Capturing...' : 'Approve & Capture'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}