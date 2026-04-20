import React, { useState } from 'react';
import { MapPin, ChevronDown, ChevronRight, Recycle, Camera, Package } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';

function bagSummary(r) {
  const parts = [];
  if ((r.small_bags_requested || 0) > 0) parts.push(`${r.small_bags_requested} Small`);
  if ((r.tote_bags_requested || 0) > 0) parts.push(`${r.tote_bags_requested} Tote`);
  return parts.join(' + ') || '—';
}

export default function PreOptimizeOrderCard({ order, pendingReturn, onVerifyReturn, user, isUpdating }) {
  const [expanded, setExpanded] = useState(false);
  const [showBagVerify, setShowBagVerify] = useState(false);
  const [smallStatus, setSmallStatus] = useState('accepted');
  const [toteStatus, setToteStatus] = useState('accepted');
  const [smallAccepted, setSmallAccepted] = useState(pendingReturn?.small_bags_requested || 0);
  const [toteAccepted, setToteAccepted] = useState(pendingReturn?.tote_bags_requested || 0);
  const [reason, setReason] = useState('dirty_stained');
  const [notes, setNotes] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = React.useRef(null);

  const calcCredit = () => {
    let c = 0;
    if (smallStatus === 'accepted') c += smallAccepted;
    if (toteStatus === 'accepted') c += toteAccepted * 2;
    return c;
  };

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setPhotoUrl(file_url);
    } catch (err) {
      console.error('Photo upload error:', err);
      toast.error('Photo upload failed');
    }
    setUploading(false);
  };

  const handleSubmit = async () => {
    setSaving(true);
    const credit = calcCredit();
    let vStatus = 'verified';
    if (credit === 0) vStatus = (smallStatus === 'not_found' || toteStatus === 'not_found') ? 'not_found' : 'not_eligible';
    else if (smallAccepted < pendingReturn.small_bags_requested || toteAccepted < pendingReturn.tote_bags_requested) vStatus = 'partially_verified';

    onVerifyReturn(pendingReturn, {
      small_bag_status: smallStatus,
      tote_bag_status: toteStatus,
      small_bags_accepted: smallAccepted,
      tote_bags_accepted: toteAccepted,
      rejection_reason: (smallStatus === 'not_eligible' || toteStatus === 'not_eligible') ? reason : '',
      driver_notes: notes,
      photo_url: photoUrl || '',
      verification_status: vStatus,
      credit_issued: credit,
      verified_by: user?.email,
      verified_at: new Date().toISOString(),
      credit_applied: credit > 0,
    });
    setSaving(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-card border rounded-2xl overflow-hidden ${pendingReturn ? 'border-amber-300' : 'border-border/50'}`}
    >
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 p-4 text-left active:bg-secondary/30 transition-colors">
        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-primary/10 text-primary">
          <MapPin className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">#{order.order_number}</p>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{order.delivery_address}</p>
          {pendingReturn && (
            <div className="flex items-center gap-1 mt-1">
              <Recycle className="w-3 h-3 text-amber-600" />
              <p className="text-[10px] font-semibold text-amber-600">Bag return to collect</p>
            </div>
          )}
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="border-t border-border/40 px-4 pb-4 pt-3 space-y-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Customer</p>
                <p className="text-xs">{order.customer_email}</p>
              </div>

              {pendingReturn && !showBagVerify && (
                <button
                  onClick={() => setShowBagVerify(true)}
                  className="w-full py-2.5 border border-amber-300 text-amber-700 rounded-xl text-sm font-semibold active:scale-95 transition-transform flex items-center justify-center gap-2"
                >
                  <Package className="w-4 h-4" />
                  Verify Bag Return
                </button>
              )}

              {pendingReturn && showBagVerify && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <Recycle className="w-4 h-4 text-amber-600 shrink-0" />
                    <p className="text-sm font-bold text-amber-800">Bag Return — {bagSummary(pendingReturn)}</p>
                  </div>

                  {pendingReturn.small_bags_requested > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-amber-800 mb-2">Small Bags</p>
                      <div className="flex gap-2 flex-wrap mb-2">
                        {[
                          ['accepted', '✓ Accepted'],
                          ['not_eligible', '✗ Not Eligible'],
                          ['not_found', '? Not Found'],
                        ].map(([v, l]) => (
                          <button key={v} onClick={() => setSmallStatus(v)}
                            className={`text-[11px] font-medium px-3 py-2 rounded-xl border transition-colors ${smallStatus === v ? 'bg-amber-600 text-white border-amber-600' : 'border-amber-300 bg-white text-amber-800'}`}>
                            {l}
                          </button>
                        ))}
                      </div>
                      {smallStatus === 'accepted' && (
                        <div className="flex items-center gap-2 bg-white border border-amber-300 rounded-xl px-3 py-2">
                          <button onClick={() => setSmallAccepted(Math.max(0, smallAccepted - 1))} className="text-amber-700 font-bold text-lg">−</button>
                          <span className="flex-1 text-center text-sm font-semibold text-amber-800">{smallAccepted} collected</span>
                          <button onClick={() => setSmallAccepted(smallAccepted + 1)} className="text-amber-700 font-bold text-lg">+</button>
                        </div>
                      )}
                    </div>
                  )}

                  {pendingReturn.tote_bags_requested > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-amber-800 mb-2">Tote Bags</p>
                      <div className="flex gap-2 flex-wrap mb-2">
                        {[
                          ['accepted', '✓ Accepted'],
                          ['not_eligible', '✗ Not Eligible'],
                          ['not_found', '? Not Found'],
                        ].map(([v, l]) => (
                          <button key={v} onClick={() => setToteStatus(v)}
                            className={`text-[11px] font-medium px-3 py-2 rounded-xl border transition-colors ${toteStatus === v ? 'bg-amber-600 text-white border-amber-600' : 'border-amber-300 bg-white text-amber-800'}`}>
                            {l}
                          </button>
                        ))}
                      </div>
                      {toteStatus === 'accepted' && (
                        <div className="flex items-center gap-2 bg-white border border-amber-300 rounded-xl px-3 py-2">
                          <button onClick={() => setToteAccepted(Math.max(0, toteAccepted - 1))} className="text-amber-700 font-bold text-lg">−</button>
                          <span className="flex-1 text-center text-sm font-semibold text-amber-800">{toteAccepted} collected</span>
                          <button onClick={() => setToteAccepted(toteAccepted + 1)} className="text-amber-700 font-bold text-lg">+</button>
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-semibold text-amber-800 mb-1.5">Photo <span className="font-normal text-amber-600">(optional)</span></p>
                    <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} />
                    {photoUrl ? (
                      <img src={photoUrl} alt="Evidence" className="w-full max-w-xs rounded-xl border border-amber-200" />
                    ) : (
                      <button onClick={() => fileRef.current?.click()} disabled={uploading}
                        className="flex items-center gap-2 px-4 py-2.5 border-2 border-dashed border-amber-300 rounded-xl text-xs text-amber-700 w-full justify-center bg-white">
                        {uploading ? <div className="w-4 h-4 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" /> : <Camera className="w-4 h-4" />}
                        {uploading ? 'Uploading...' : 'Take Photo'}
                      </button>
                    )}
                  </div>

                  <button onClick={handleSubmit} disabled={saving || uploading}
                    className="w-full py-3 bg-amber-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-[0.98] transition-transform">
                    {saving ? 'Submitting...' : `Confirm Bag Return · $${calcCredit().toFixed(2)}`}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}