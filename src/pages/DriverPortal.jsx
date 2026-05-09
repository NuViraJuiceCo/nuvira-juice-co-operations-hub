import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { formatAdminTimestamp, formatDeliveryDate } from '@/lib/timezoneUtils';
import {
  Leaf, MapPin, Navigation, CheckCircle2, ChevronDown, ChevronRight,
  RefreshCw, Clock, Route, XCircle, Recycle, Package, Camera, X,
  AlertTriangle, Truck, RotateCcw, ArrowLeft, Trash2
} from 'lucide-react';
import { toast } from 'sonner';
import PreOptimizeOrderCard from '@/components/driver/PreOptimizeOrderCard';
import DeliveryProductBreakdown from '@/components/driver/DeliveryProductBreakdown';

// ─── Constants ──────────────────────────────────────────────────────────────

// Canonical FulfillmentTask status enum values (must match entities/FulfillmentTask.json)
const FULFILLMENT_STATUS = {
  SCHEDULED: 'Scheduled',
  PACKED: 'Packed',
  IN_TRANSIT: 'In Transit',
  OUT_FOR_DELIVERY: 'Out For Delivery',
  COMPLETED: 'Completed',
  UNABLE_TO_DELIVER: 'Unable To Deliver',
  CANCELLED: 'Cancelled',
};

// DELIVERY_STAGES: key = canonical DB status to save, label = what driver sees on button
// EXCEPTION: 'Out For Delivery' button saves 'In Transit' (see handleMarkStage)
// We keep key='Out For Delivery' as a sentinel to trigger the updateDriverDeliveryTask path
const DELIVERY_STAGES = [
  { key: 'Packed', label: 'Packed' },
  { key: 'In Transit', label: 'In Transit' },
  { key: 'Out For Delivery', label: 'Out for Delivery' },
];

const UNABLE_TO_DELIVER_REASONS = [
  { key: 'customer_not_home', label: 'Customer Not Home' },
  { key: 'wrong_address', label: 'Wrong Address' },
  { key: 'access_issue', label: 'Access Issue' },
  { key: 'refused_delivery', label: 'Customer Refused' },
  { key: 'other', label: 'Other' },
];

const REJECTION_REASONS = [
  { key: 'dirty_stained', label: 'Dirty / Stained' },
  { key: 'odor', label: 'Odor' },
  { key: 'damaged', label: 'Damaged' },
  { key: 'customer_not_home', label: 'Customer Not Home' },
  { key: 'other', label: 'Other' },
];

const RETURN_STATUS_COLOR = {
  requested: 'bg-amber-50 text-amber-700',
  verified: 'bg-green-50 text-green-700',
  partially_verified: 'bg-amber-50 text-amber-700',
  not_found: 'bg-secondary text-muted-foreground',
  not_eligible: 'bg-red-50 text-red-600',
  unable_to_collect: 'bg-red-50 text-red-600',
};

const STATUS_LABEL = {
  order_received: 'Received', scheduled_for_juicing: 'Scheduled',
  in_production: 'In Production', bottled_packed: 'Packed',
  out_for_delivery: 'Out for Delivery', arriving_soon: 'Arriving Soon', delivered: 'Delivered',
};

const STATUS_COLOR = {
  order_received: 'bg-blue-100 text-blue-700', scheduled_for_juicing: 'bg-purple-100 text-purple-700',
  in_production: 'bg-amber-100 text-amber-700', bottled_packed: 'bg-orange-100 text-orange-700',
  out_for_delivery: 'bg-cyan-100 text-cyan-700', arriving_soon: 'bg-teal-100 text-teal-700',
  delivered: 'bg-green-100 text-green-700',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function mapsUrl(address) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;
}

const DEPOT = "619 N Main St Unit 3, O'Fallon, MO 63366";
const DEPOT_LAT = 38.6849;
const DEPOT_LNG = -90.6639;

const DONE_STATUSES_GLOBAL = new Set(['Completed', 'Unable To Deliver', 'Cancelled', 'completed', 'delivered', 'fulfilled', 'cancelled']);

function buildFullRouteUrl(orders) {
  const remaining = orders.filter(o => !DONE_STATUSES_GLOBAL.has(o.status || ''));
  if (remaining.length === 0) return null;

  const formatAddress = (order) => {
    if (order.address_line1) {
      return `${order.address_line1}${order.address_line2 ? ' ' + order.address_line2 : ''}, ${order.address_city}, ${order.address_state} ${order.address_postal_code}`.trim();
    }
    if (order.fulfillments?.[0]?.address_line1) {
      const f = order.fulfillments[0];
      return `${f.address_line1}${f.address_line2 ? ' ' + f.address_line2 : ''}, ${f.address_city}, ${f.address_state} ${f.address_postal_code}`.trim();
    }
    return order.delivery_address || '';
  };

  // Google Maps: origin=depot, waypoints=stops 1..N-1, destination=last stop
  // Max 23 intermediate waypoints (Google limit)
  const stops = remaining.slice(0, 25); // depot + up to 23 waypoints + destination = 25 total
  const origin = encodeURIComponent(DEPOT);
  const destination = encodeURIComponent(formatAddress(stops[stops.length - 1]));
  // All stops before the last one are waypoints (none for a 1-stop route)
  const waypointAddresses = stops.slice(0, -1).map(o => encodeURIComponent(formatAddress(o))).filter(Boolean);
  const waypointsParam = waypointAddresses.length > 0 ? `&waypoints=${waypointAddresses.join('|')}` : '';

  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypointsParam}&travelmode=driving`;
}

function formatDuration(seconds) {
  if (!seconds) return null;
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function bagSummary(r) {
  const parts = [];
  if ((r.small_bags_requested || 0) > 0) parts.push(`${r.small_bags_requested} Small`);
  if ((r.tote_bags_requested || 0) > 0) parts.push(`${r.tote_bags_requested} Tote`);
  return parts.join(' + ') || '—';
}

// ─── Inline Bag Return Verifier ──────────────────────────────────────────────

function InlineBagReturn({ ret, user, onVerifyComplete }) {
  const [smallStatus, setSmallStatus] = useState('accepted');
  const [toteStatus, setToteStatus] = useState('accepted');
  const [smallAccepted, setSmallAccepted] = useState(ret.small_bags_requested || 0);
  const [toteAccepted, setToteAccepted] = useState(ret.tote_bags_requested || 0);
  const [reason, setReason] = useState('dirty_stained');
  const [notes, setNotes] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const bagStatusOptions = [
    ['accepted', '✓ Accepted'],
    ['not_eligible', '✗ Not Eligible'],
    ['not_found', '? Not Found'],
  ];

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
      toast.error('Photo upload failed — submission may proceed without photo');
    }
    setUploading(false);
  };

  const handleSubmit = async () => {
    setSaving(true);
    const credit = calcCredit();
    let vStatus = 'verified';
    if (credit === 0) vStatus = (smallStatus === 'not_found' || toteStatus === 'not_found') ? 'not_found' : 'not_eligible';
    else if (smallAccepted < ret.small_bags_requested || toteAccepted < ret.tote_bags_requested) vStatus = 'partially_verified';

    onVerifyComplete(ret, {
      small_bag_status: smallStatus, tote_bag_status: toteStatus,
      small_bags_accepted: smallAccepted, tote_bags_accepted: toteAccepted,
      rejection_reason: (smallStatus === 'not_eligible' || toteStatus === 'not_eligible') ? reason : '',
      driver_notes: notes, photo_url: photoUrl || '',
      verification_status: vStatus, credit_issued: credit,
      verified_by: user?.email, verified_at: new Date().toISOString(), credit_applied: credit > 0,
    });
    setSaving(false);
  };

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Recycle className="w-4 h-4 text-amber-600 shrink-0" />
        <p className="text-sm font-bold text-amber-800">Bag Return — {bagSummary(ret)}</p>
      </div>

      {ret.small_bags_requested > 0 && (
        <div>
          <p className="text-xs font-semibold text-amber-800 mb-2">Small Bags</p>
          <div className="flex gap-2 flex-wrap mb-2">
            {bagStatusOptions.map(([v, l]) => (
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

      {ret.tote_bags_requested > 0 && (
        <div>
          <p className="text-xs font-semibold text-amber-800 mb-2">Tote Bags</p>
          <div className="flex gap-2 flex-wrap mb-2">
            {bagStatusOptions.map(([v, l]) => (
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

      {(smallStatus === 'not_eligible' || toteStatus === 'not_eligible') && (
        <div>
          <p className="text-xs font-semibold text-amber-800 mb-2">Rejection Reason</p>
          <div className="flex gap-2 flex-wrap">
            {REJECTION_REASONS.map(r => (
              <button key={r.key} onClick={() => setReason(r.key)}
                className={`text-[11px] px-3 py-1.5 rounded-xl border transition-colors ${reason === r.key ? 'bg-red-100 border-red-300 text-red-700' : 'border-amber-300 bg-white text-amber-800'}`}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-amber-800 mb-1.5">Photo <span className="font-normal text-amber-600">(optional)</span></p>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} />
        {photoUrl ? (
          <div className="relative inline-block w-full">
            <img src={photoUrl} alt="Evidence" className="w-full max-w-xs rounded-xl border border-amber-200" />
            <button onClick={() => setPhotoUrl('')} className="absolute top-2 right-2 w-7 h-7 bg-black/50 rounded-full flex items-center justify-center">
              <X className="w-3.5 h-3.5 text-white" />
            </button>
          </div>
        ) : (
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="flex items-center gap-2 px-4 py-2.5 border-2 border-dashed border-amber-300 rounded-xl text-xs text-amber-700 w-full justify-center bg-white">
            {uploading ? <div className="w-4 h-4 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" /> : <Camera className="w-4 h-4" />}
            {uploading ? 'Uploading...' : 'Take or Upload Photo'}
          </button>
        )}
      </div>

      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Driver notes (optional)"
        className="w-full text-xs border border-amber-300 rounded-xl px-3 py-2.5 bg-white resize-none focus:outline-none focus:ring-1 focus:ring-amber-400 text-amber-900 placeholder:text-amber-400" />

      <div className="bg-white border border-amber-200 rounded-xl p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Leaf className="w-4 h-4 text-amber-600" />
          <p className="text-sm font-semibold text-amber-800">Credit to Issue</p>
        </div>
        <p className="font-heading text-xl font-bold text-amber-700">${calcCredit().toFixed(2)}</p>
      </div>

      <button onClick={handleSubmit} disabled={saving || uploading}
        className="w-full py-3 bg-amber-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-[0.98] transition-transform">
        {saving ? 'Submitting...' : 'Confirm Bag Return'}
      </button>
    </div>
  );
}

// ─── Stop Card ──────────────────────────────────────────────────────────────

const DROP_LOCATIONS = [
  'Front Door', 'Back Door', 'Garage', 'Side Door',
  'With Neighbor', 'Mailroom / Lobby', 'Left on Porch', 'Other',
];

function StopCard({ order, pendingReturn, onMarkDelivered, onMarkUnableToDeliver, onMarkStage, onReturnVerified, allCredits, user, isUpdating, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [showDeliverForm, setShowDeliverForm] = useState(false);
  const [showUnableForm, setShowUnableForm] = useState(false);
  const [unableReason, setUnableReason] = useState('customer_not_home');
  const [unableNotes, setUnableNotes] = useState('');
  const [proofPhotoUrl, setProofPhotoUrl] = useState('');
  const [dropLocation, setDropLocation] = useState('Front Door');
  const [uploadingProof, setUploadingProof] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const proofFileRef = useRef(null);

  const isDelivered = order.status === FULFILLMENT_STATUS.COMPLETED;
  const isUnableToDeliver = order.status === FULFILLMENT_STATUS.UNABLE_TO_DELIVER;
  // Map DB canonical status to stage index
  // 'In Transit' and 'Out For Delivery' both map to index 1 (In Transit stage done, show OFD next)
  const statusToStageIndex = {
    'Scheduled': -1,
    'Packed': 0,
    'In Transit': 1,
    'Out For Delivery': 2, // also canonical for completed staging
  };
  const currentStageIndex = statusToStageIndex[order.status] !== undefined ? statusToStageIndex[order.status] : -1;
  const nextStage = currentStageIndex < DELIVERY_STAGES.length - 1 ? DELIVERY_STAGES[currentStageIndex + 1] : null;

  const handleUnableSubmit = () => {
    onMarkUnableToDeliver(order, unableReason, unableNotes);
    setShowUnableForm(false);
  };

  const handleProofPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingProof(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setProofPhotoUrl(file_url);
    } catch { toast.error('Photo upload failed'); }
    setUploadingProof(false);
  };

  const handleConfirmDelivery = () => {
    if (!proofPhotoUrl) {
      toast.error('Please take a proof of delivery photo');
      return;
    }
    onMarkDelivered(order, proofPhotoUrl, dropLocation);
    setShowDeliverForm(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-card border rounded-2xl overflow-hidden ${
        isDelivered ? 'border-green-200 opacity-75'
        : isUnableToDeliver ? 'border-red-200 opacity-75'
        : pendingReturn ? 'border-amber-300'
        : 'border-border/50'
      }`}
    >
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 p-4 text-left active:bg-secondary/30 transition-colors">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${isDelivered ? 'bg-green-100 text-green-600' : isUnableToDeliver ? 'bg-red-100 text-red-600' : 'bg-primary/10 text-primary'}`}>
          {isDelivered ? <CheckCircle2 className="w-4 h-4" /> : isUnableToDeliver ? <XCircle className="w-4 h-4" /> : <MapPin className="w-4 h-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-semibold">#{order.order_number}</p>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${isDelivered ? 'bg-green-100 text-green-700' : isUnableToDeliver ? 'bg-red-100 text-red-700' : 'bg-primary/10 text-primary'}`}>
              {isDelivered ? 'Delivered ✓' : isUnableToDeliver ? 'Unable to Deliver' : (order.status || 'Scheduled')}
            </span>
          </div>
          <p className="text-xs font-medium text-foreground mt-0.5">{order.customer_name || order.customer_email}</p>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{order.delivery_address || order.address || '(address missing)'}</p>
          {pendingReturn && (
            <div className="flex items-center gap-1 mt-1">
              <Recycle className="w-3 h-3 text-amber-600" />
              <p className="text-[10px] font-semibold text-amber-600">
                {pendingReturn.verification_status === 'requested' ? 'Bag return to collect' : 'Return handled ✓'}
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {order.leg_duration_seconds && <span className="text-[10px] text-muted-foreground">{formatDuration(order.leg_duration_seconds)}</span>}
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="border-t border-border/40 px-4 pb-4 pt-3 space-y-3">

              <div className="space-y-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Customer</p>
                <p className="text-xs">{order.customer_email}</p>
                {order.contact_phone && <p className="text-xs font-semibold">{order.contact_phone}</p>}
              </div>

              {/* DEBUG: Visible raw status for live verification */}
              <div className="bg-slate-100 border border-slate-300 rounded-lg p-2.5 space-y-1">
                <p className="text-[9px] font-mono text-slate-700">
                  <span className="font-bold">Task ID:</span> {order.id}
                </p>
                <p className="text-[9px] font-mono text-slate-700">
                  <span className="font-bold">Status:</span> <span className="bg-yellow-200 px-1 rounded">{order.status || '(none)'}</span>
                </p>
              </div>

              <div className="space-y-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Delivery Address</p>
                <p className="text-xs">{order.delivery_address || order.address || '(address missing)'}</p>
                {!order.delivery_address && !order.address && (
                  <div className="mt-1 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3 text-red-600 shrink-0" />
                    <p className="text-[10px] text-red-700 font-semibold">Missing delivery address — contact admin before delivery</p>
                  </div>
                )}
              </div>

              <div>
                <DeliveryProductBreakdown order={order} deliveryItems={order.items} />
              </div>

              {pendingReturn && pendingReturn.verification_status === 'requested' && (
                <InlineBagReturn
                  ret={pendingReturn}
                  user={user}
                  onVerifyComplete={onReturnVerified}
                />
              )}

              {pendingReturn && pendingReturn.verification_status !== 'requested' && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-green-700">Return Verified</p>
                    <p className="text-[10px] text-green-600">{pendingReturn.verification_status?.replace(/_/g, ' ')} · ${(pendingReturn.credit_issued || 0).toFixed(2)} credit issued</p>
                  </div>
                </div>
              )}

              <a href={mapsUrl((() => {
                const addr = order.address_line1 ? `${order.address_line1}${order.address_line2 ? ', ' + order.address_line2 : ''}, ${order.address_city}, ${order.address_state} ${order.address_postal_code}` : order.delivery_address;
                if (addr) return addr;
                return order.fulfillments?.[0]?.address_line1 ? `${order.fulfillments[0].address_line1}, ${order.fulfillments[0].address_city}, ${order.fulfillments[0].address_state} ${order.fulfillments[0].address_postal_code}` : '';
              })())} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-3 bg-blue-500 text-white rounded-xl text-sm font-semibold active:scale-95 transition-transform">
                <Navigation className="w-4 h-4" />
                Navigate to Stop
              </a>

              {!isDelivered && !isUnableToDeliver && (
                <>
                  {!showDeliverForm && !showUnableForm && (
                    <>
                      {nextStage && (
                        <button onClick={() => onMarkStage(order, nextStage)} disabled={isUpdating}
                          className="w-full py-2.5 border border-primary text-primary rounded-xl text-xs font-semibold active:scale-95 transition-transform disabled:opacity-50">
                          {isUpdating ? 'Updating...' : `→ Mark ${nextStage.label}`}
                        </button>
                      )}

                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setShowDeliverForm(true)} disabled={isUpdating}
                          className="py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform flex items-center justify-center gap-1.5">
                          <Truck className="w-4 h-4" />
                          Delivered
                        </button>
                        <button onClick={() => setShowUnableForm(true)} disabled={isUpdating}
                          className="py-3 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform flex items-center justify-center gap-1.5">
                          <AlertTriangle className="w-4 h-4" />
                          Unable to Deliver
                        </button>
                      </div>
                    </>
                  )}

                  {showDeliverForm && (
                    <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-bold text-green-800">Proof of Delivery</p>
                        <button onClick={() => setShowDeliverForm(false)} className="text-green-400">
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div>
                        <p className="text-xs font-semibold text-green-800 mb-2">
                          Delivery Photo <span className="text-red-500">*</span>
                          <span className="font-normal text-green-600 ml-1">— required</span>
                        </p>
                        <input ref={proofFileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleProofPhoto} />
                        {proofPhotoUrl ? (
                          <div className="relative">
                            <img src={proofPhotoUrl} alt="Proof of delivery" className="w-full rounded-xl border-2 border-green-300 object-cover max-h-48" />
                            <button onClick={() => setProofPhotoUrl('')} className="absolute top-2 right-2 w-7 h-7 bg-black/60 rounded-full flex items-center justify-center">
                              <X className="w-3.5 h-3.5 text-white" />
                            </button>
                            <div className="absolute bottom-2 left-2 bg-green-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Photo captured
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => proofFileRef.current?.click()} disabled={uploadingProof}
                            className="flex flex-col items-center gap-2 w-full py-6 border-2 border-dashed border-green-300 rounded-xl bg-white text-green-700 active:scale-95 transition-transform">
                            {uploadingProof
                              ? <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                              : <Camera className="w-7 h-7" />}
                            <p className="text-sm font-semibold">{uploadingProof ? 'Uploading...' : 'Take Delivery Photo'}</p>
                            <p className="text-[10px] text-green-500">Show package at the door / drop location</p>
                          </button>
                        )}
                      </div>

                      <div>
                        <p className="text-xs font-semibold text-green-800 mb-2">Left At</p>
                        <div className="flex flex-wrap gap-2">
                          {DROP_LOCATIONS.map(loc => (
                            <button key={loc} onClick={() => setDropLocation(loc)}
                              className={`text-[11px] px-3 py-1.5 rounded-xl border transition-colors font-medium ${dropLocation === loc ? 'bg-green-600 text-white border-green-600' : 'border-green-200 bg-white text-green-800'}`}>
                              {loc}
                            </button>
                          ))}
                        </div>
                      </div>

                      <button onClick={handleConfirmDelivery} disabled={isUpdating || uploadingProof || !proofPhotoUrl}
                        className="w-full py-3.5 bg-green-600 text-white rounded-xl text-sm font-bold disabled:opacity-50 active:scale-[0.98] transition-transform flex items-center justify-center gap-2">
                        {isUpdating ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Confirming...</> : <><CheckCircle2 className="w-4 h-4" /> Confirm Delivery</>}
                      </button>
                    </div>
                  )}

                  {showUnableForm && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-bold text-red-700">Unable to Deliver</p>
                        <button onClick={() => setShowUnableForm(false)} className="text-red-400"><X className="w-4 h-4" /></button>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-red-700 mb-2">Reason</p>
                        <div className="flex flex-wrap gap-2">
                          {UNABLE_TO_DELIVER_REASONS.map(r => (
                            <button key={r.key} onClick={() => setUnableReason(r.key)}
                              className={`text-[11px] px-3 py-1.5 rounded-xl border transition-colors ${unableReason === r.key ? 'bg-red-600 text-white border-red-600' : 'border-red-200 bg-white text-red-700'}`}>
                              {r.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <textarea value={unableNotes} onChange={e => setUnableNotes(e.target.value)} rows={2}
                        placeholder="Additional notes..."
                        className="w-full text-xs border border-red-200 rounded-xl px-3 py-2.5 bg-white resize-none focus:outline-none focus:ring-1 focus:ring-red-300 text-red-900 placeholder:text-red-300" />
                      <button onClick={handleUnableSubmit} disabled={isUpdating}
                        className="w-full py-3 bg-red-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 active:scale-95 transition-transform">
                        {isUpdating ? 'Submitting...' : 'Submit & Move On'}
                      </button>
                    </div>
                  )}
                </>
              )}

              {isDelivered && (
                <div className="space-y-2">
                  <div className="py-3 bg-green-50 text-green-700 rounded-xl text-sm font-semibold text-center border border-green-200 flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> Delivered
                    {order.delivery_drop_location && <span className="font-normal text-xs text-green-600">· {order.delivery_drop_location}</span>}
                  </div>
                  {order.delivery_photo_url && (
                    <div className="relative rounded-xl overflow-hidden border border-green-200">
                      <img src={order.delivery_photo_url} alt="Proof of delivery" className="w-full object-cover max-h-40" />
                      <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-3 py-1.5 flex items-center justify-between">
                        <p className="text-white text-[10px] font-semibold">Proof of Delivery</p>
                        {order.delivered_at && <p className="text-white/70 text-[10px]">{formatAdminTimestamp(order.delivered_at)}</p>}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!showDeleteConfirm && (
                <button onClick={() => setShowDeleteConfirm(true)} disabled={isUpdating}
                  className="w-full py-2 text-red-600 border border-red-200 rounded-xl text-xs font-semibold hover:bg-red-50 disabled:opacity-50 active:scale-95 transition-all flex items-center justify-center gap-2">
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Order
                </button>
              )}

              {showDeleteConfirm && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-semibold text-red-800">Delete this order?</p>
                  <p className="text-xs text-red-700">This will remove the order and all fulfillment tasks. This cannot be undone.</p>
                  <div className="flex gap-2">
                    <button onClick={() => setShowDeleteConfirm(false)} disabled={isUpdating}
                      className="flex-1 py-2 bg-white border border-red-200 text-red-700 rounded-xl text-xs font-semibold">
                      Cancel
                    </button>
                    <button onClick={() => { onDelete(order); setShowDeleteConfirm(false); }} disabled={isUpdating}
                      className="flex-1 py-2 bg-red-600 text-white rounded-xl text-xs font-semibold disabled:opacity-50">
                      {isUpdating ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Route Tab ──────────────────────────────────────────────────────────────

function RouteTab({ bagReturns, allCredits, user, onBagReturnVerified }) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]); // Default to today
  const [deliveryScheduleItems, setDeliveryScheduleItems] = useState(null);
  const [routeData, setRouteData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [manualOrder, setManualOrder] = useState(null); // Track manual reordering
  const [isDragging, setIsDragging] = useState(null);

  const getDateLabel = (dateStr) => {
    if (!dateStr) return '';
    const target = new Date(dateStr + 'T00:00:00');
    if (isNaN(target.getTime())) return dateStr;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (target.getTime() === today.getTime()) return 'Today';
    if (target.getTime() === tomorrow.getTime()) return 'Tomorrow';
    if (target.getTime() === yesterday.getTime()) return 'Yesterday';
    return format(target, 'MMM d');
  };

  const getQuickDates = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return {
      yesterday: yesterday.toISOString().split('T')[0],
      today: today.toISOString().split('T')[0],
      tomorrow: tomorrow.toISOString().split('T')[0],
    };
  };

  const handleQuickDate = (quickDate) => {
    const dates = getQuickDates();
    setDate(dates[quickDate]);
    setRouteData(null);
  };

  const loadQueue = async (selectedDate = date) => {
    setLoading(true);
    setRouteData(null);
    try {
      // Resolve all delivery obligations for the date — ALL statuses, not just ready ones
      const resolveRes = await base44.functions.invoke('resolveDeliveryScheduleForDate', { selectedDate });
      const allDeliveries = resolveRes.data?.deliveries || [];
      setDeliveryScheduleItems(allDeliveries);
    } catch {
      toast.error('Failed to load delivery queue');
    } finally {
      setLoading(false);
    }
  };

  const optimizeRoute = async () => {
    // Include ALL non-completed stops for optimization — Scheduled AND ready-status stops.
    // FulfillmentTasks from Hub are commonly Scheduled until driver marks them out_for_delivery.
    const allTasksToOptimize = (deliveryScheduleItems || []).filter(d => {
      return !isCompleted(d);
    });
    // Only optimize stops with a valid address
    const optimizableStops = allTasksToOptimize.filter(d => d.address_line1 || d.delivery_address);
    if (!optimizableStops.length) {
      toast.error('No stops with valid addresses to optimize');
      return;
    }
    setOptimizing(true);
    setManualOrder(null);
    try {
      const res = await base44.functions.invoke('optimizeDeliveryRoute', { date: date || undefined, optimize: true, orders: optimizableStops });
      setRouteData(res.data);
      
      const stats = res.data?.route_stats;
      if (stats?.time_saved_minutes > 0) {
        toast.success(`Route optimized! ~${stats.time_saved_minutes} min saved (${stats.total_distance_miles} mi, ${stats.optimized_duration_minutes} min)`);
      } else if (stats) {
        toast.success(`Route optimized (${stats.optimized_duration_minutes} min, ${stats.total_distance_miles} mi)`);
      }
    } catch {
      toast.error('Optimization failed');
    } finally {
      setOptimizing(false);
    }
  };

  useEffect(() => { 
    loadQueue(date);
    setRouteData(null); // Reset route when date changes
    setManualOrder(null); // Reset manual ordering
  }, [date]);

  const handleMarkDelivered = async (order, proofPhotoUrl, dropLocation) => {
    if (!proofPhotoUrl) {
      toast.error('Proof of delivery photo is required');
      return;
    }
    setUpdatingId(order.id);
    console.log(`[DriverPortal] handleMarkDelivered: task_id=${order.id}, drop_location=${dropLocation}`);
    try {
      const res = await base44.functions.invoke('recordDriverDelivery', {
        task_id: order.id,
        driver_email: user?.email,
        driver_name: user?.full_name || user?.email,
        photo_url: proofPhotoUrl,
        drop_location: dropLocation,
        timestamp: new Date().toISOString(),
      });
      if (res?.data?.status !== 'success') throw new Error(res?.data?.error || 'Save failed');
      console.log(`[DriverPortal] recordDriverDelivery succeeded:`, res.data);
      toast.success('✓ Delivery confirmed & saved');
      await new Promise(resolve => setTimeout(resolve, 500)); // brief pause for DB commit
      await loadQueue();
      setRouteData(null);
    } catch (err) {
      console.error('[DriverPortal] Delivery save error:', err);
      toast.error('Failed to save delivery: ' + (err.message || 'Unknown error'));
    } finally {
      setUpdatingId(null);
    }
  };

  const handleMarkUnableToDeliver = async (order, reason, notes) => {
    setUpdatingId(order.id);
    try {
      const taskId = order.fulfillment_task_id || order.id;
      if (taskId) {
        const res = await base44.functions.invoke('updateDriverDeliveryTask', {
          task_id: taskId,
          action: 'mark_unable_to_deliver',
          driver_email: user?.email,
          failure_reason: reason,
          note: notes,
          timestamp: new Date().toISOString(),
        });
        if (res?.data?.status !== 'success') throw new Error(res?.data?.error || 'Task update failed');
      } else {
        await base44.functions.invoke('receiveDriverStatusUpdate', {
          order_id: order.id,
          order_number: order.order_number,
          driver_email: user?.email,
          action: 'unable_to_deliver',
          unable_reason: reason,
          delivery_notes: notes,
        });
      }
      const linkedReturn = bagReturns.find(r => r.customer_email === order.customer_email && r.verification_status === 'requested');
      if (linkedReturn) {
        await base44.entities.BagReturn.update(linkedReturn.id, {
          verification_status: 'unable_to_collect',
          rejection_reason: reason === 'customer_not_home' ? 'customer_not_home' : 'other',
          driver_notes: `Unable to deliver — ${reason}${notes ? `. ${notes}` : ''}`,
          verified_by: user?.email,
          verified_at: new Date().toISOString(),
        });
      }
      toast.success('Stop marked — admin notified');
      loadQueue();
      setRouteData(null);
    } catch {
      toast.error('Update failed');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleMarkStage = async (order, nextStage) => {
    setUpdatingId(order.id);
    console.log(`[DriverPortal] handleMarkStage called: order_id=${order.id}, nextStage.key=${nextStage.key}, driver_email=${user?.email}`);
    try {
      // CRITICAL: 'Out For Delivery' button saves canonical status='In Transit'
      // Only 'Out For Delivery' button calls updateDriverDeliveryTask (which handles the mapping)
      // Other stages (Packed, In Transit) save directly to their canonical status values
      if (nextStage.key === 'Out For Delivery') {
        // The 'Out For Delivery' button triggers updateDriverDeliveryTask
        // which will map to canonical status 'In Transit' in the backend
        const taskId = order.fulfillment_task_id || order.id;
        console.log(`[DriverPortal] Calling updateDriverDeliveryTask: task_id=${taskId}, action=mark_out_for_delivery`);
        const res = await base44.functions.invoke('updateDriverDeliveryTask', {
          task_id: taskId,
          action: 'mark_out_for_delivery',
          driver_email: user?.email,
          timestamp: new Date().toISOString(),
        });
        if (res?.data?.status !== 'success') throw new Error(res?.data?.error || 'Task update failed');
        console.log(`[DriverPortal] updateDriverDeliveryTask succeeded:`, res.data);
      } else {
        // For Packed/In Transit — direct entity update with the ACTUAL canonical status key
        console.log(`[DriverPortal] Direct update: task_id=${order.id}, status=${nextStage.key}`);
        const updateResult = await base44.entities.FulfillmentTask.update(order.id, { status: nextStage.key });
        console.log(`[DriverPortal] Direct update succeeded:`, updateResult);
      }
      toast.success(`✓ Marked ${nextStage.label}`);
      await new Promise(resolve => setTimeout(resolve, 300));
      await loadQueue();
      setRouteData(null);
    } catch (err) {
      console.error(`[DriverPortal] handleMarkStage error:`, err);
      toast.error('Update failed: ' + (err.message || 'Unknown error'));
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDeleteOrder = async (order) => {
    // Delete is admin-only — deletion is not an order write, it's a removal
    if (user?.role !== 'admin') {
      toast.error('Only admins can delete orders');
      return;
    }
    setDeletingId(order.id);
    try {
      await base44.asServiceRole.entities.ShopifyOrder.delete(order.id);
      console.log('Order deleted successfully');
      toast.success('Order deleted');
      loadQueue();
      setRouteData(null);
    } catch (err) {
      console.error('Delete error:', err);
      toast.error('Delete failed: ' + (err.message || 'Unknown error'));
    } finally {
      setDeletingId(null);
    }
  };

  // Resolve task delivery date — scheduled_date is canonical
  const resolveTaskDeliveryDate = (task) => {
    return task.scheduled_date || task.scheduled_delivery_date || task.delivery_date || task.assigned_delivery_date;
  };

  // CANONICAL STATUSES: Completed, Unable To Deliver, Cancelled = done
  // ACTIVE STATUSES: Scheduled, Packed, In Transit, Out For Delivery = show in route
  const DONE_STATUSES = new Set(['Completed', 'Unable To Deliver', 'Cancelled', 'completed', 'delivered', 'fulfilled', 'cancelled']);

  // Determine if task is route-eligible (active, non-completed)
  const isRouteEligible = (task) => {
    return !DONE_STATUSES.has(task.status || '');
  };

  // Determine if task is completed/done
  const isCompleted = (task) => {
    return DONE_STATUSES.has(task.status || '');
  };

  // All deliveries are already scoped to the selected date by the resolver
  const allTasksForDate = deliveryScheduleItems || [];
  const readyForRouteOrders = allTasksForDate.filter(isRouteEligible);
  const scheduledNotReadyOrders = allTasksForDate.filter(task => !isRouteEligible(task) && !isCompleted(task));
  const completedOrders = allTasksForDate.filter(isCompleted);
  
  // For display, combine all non-completed tasks, then organize by readiness section
  let displayOrders = allTasksForDate.filter(task => !isCompleted(task));

  if (manualOrder) {
    displayOrders = manualOrder;
  }
  const readyCount = readyForRouteOrders.length;
  const scheduledCount = scheduledNotReadyOrders.length;
  const completedCount = completedOrders.length;

  const todaysOrderIds = new Set(allTasksForDate.map(o => o.id));
  const todaysBagReturns = bagReturns.filter(r => todaysOrderIds.has(r.order_id));
  const pendingBagReturns = bagReturns.filter(r => !todaysOrderIds.has(r.order_id) && r.verification_status === 'requested');

  const pendingReturnsByEmail = {};
  todaysBagReturns.forEach(r => {
    if (!pendingReturnsByEmail[r.customer_email]) {
      pendingReturnsByEmail[r.customer_email] = r;
    }
  });

  const routeReturnCount = todaysBagReturns.filter(r => r.verification_status === 'requested').length;

  const quickDates = getQuickDates();

  return (
    <div className="pb-10">
      {/* Date Navigation */}
      <div className="px-4 pt-4 space-y-3">
        {/* Quick Date Tabs */}
        <div className="flex gap-1.5 sm:gap-2 items-center">
          <button onClick={() => handleQuickDate('yesterday')}
            className={`flex-1 py-2 sm:py-2.5 px-2 sm:px-3 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-semibold transition-colors whitespace-nowrap ${date === quickDates.yesterday ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-foreground'}`}>
            <span className="hidden sm:inline">← Previous</span>
            <span className="sm:hidden">Prev</span>
          </button>
          <button onClick={() => handleQuickDate('today')}
            className={`flex-1 py-2 sm:py-2.5 px-2 sm:px-3 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-semibold transition-colors whitespace-nowrap ${date === quickDates.today ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-foreground'}`}>
            <span className="hidden sm:inline">📅 Today</span>
            <span className="sm:hidden">Today</span>
          </button>
          <button onClick={() => handleQuickDate('tomorrow')}
            className={`flex-1 py-2 sm:py-2.5 px-2 sm:px-3 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-semibold transition-colors whitespace-nowrap ${date === quickDates.tomorrow ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-foreground'}`}>
            <span className="hidden sm:inline">Tomorrow →</span>
            <span className="sm:hidden">Next</span>
          </button>
          <button onClick={() => setShowCalendar(!showCalendar)}
            className="w-9 h-9 sm:w-10 sm:h-10 bg-card border border-border rounded-lg sm:rounded-xl flex items-center justify-center hover:bg-secondary transition-colors shrink-0">
            <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Calendar & Date Input */}
        {showCalendar && (
          <div className="bg-card border border-border rounded-lg p-3.5 space-y-2.5 w-full">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-foreground">Select Date</p>
              <button onClick={() => setShowCalendar(false)} className="text-muted-foreground hover:text-foreground p-0.5">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <input type="date" value={date} onChange={e => { setDate(e.target.value); setShowCalendar(false); }}
              className="w-full bg-background border border-border text-sm text-foreground px-3 py-2.5 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer" style={{minWidth: 0}} />
            <p className="text-[9px] text-muted-foreground">
              <span className="font-medium text-foreground">{getDateLabel(date)}</span>
            </p>
          </div>
        )}

        {/* Refresh Button & Current Date Label */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">
              {getDateLabel(date)} Deliveries
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Showing tasks for {date}</p>
          </div>
          <button onClick={() => loadQueue(date)} disabled={loading}
            className="w-9 h-9 bg-secondary rounded-xl flex items-center justify-center hover:bg-secondary/80 transition-colors disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 text-muted-foreground ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 divide-x divide-border border-y border-border bg-card mt-4">
        {[
          { label: 'Total Stops', value: allTasksForDate.length, color: 'text-primary' },
          { label: 'Active', value: readyCount + scheduledCount, color: 'text-blue-600' },
          { label: 'Completed', value: completedCount, color: 'text-green-600' },
          { label: 'Bag Returns', value: routeReturnCount, color: 'text-amber-600' },
        ].map(s => (
          <div key={s.label} className="py-3 text-center">
            <p className={`text-xl font-bold font-heading ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {routeData?.route_stats && (
        <div className="px-4 mt-4 bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center gap-2">
          <Navigation className="w-4 h-4 text-blue-600 shrink-0" />
          <p className="text-xs text-blue-700"><span className="font-semibold">Round-trip route:</span> After final delivery, return to NuVira Base</p>
        </div>
      )}

      {allTasksForDate.filter(d => !isCompleted(d)).length > 0 && !routeData?.route_stats && (
        <div className="px-4 mt-4 space-y-2">
          <button onClick={optimizeRoute} disabled={optimizing}
            className="w-full py-3.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform">
            {optimizing
              ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Optimizing...</>
              : <><Route className="w-4 h-4" /> Optimize Route ({allTasksForDate.filter(d => !isCompleted(d)).length} stops)</>
            }
          </button>
          {(() => {
            const nonCompleted = allTasksForDate.filter(d => !isCompleted(d));
            const url = buildFullRouteUrl(nonCompleted);
            const copyAddresses = () => {
              const addrs = nonCompleted.map((o, i) => `Stop ${i+1}: ${o.customer_name} — ${o.address_line1 || o.delivery_address}`).join('\n');
              navigator.clipboard.writeText(addrs);
              toast.success('Addresses copied');
            };
            return url ? (
              <div className="flex gap-2">
                <a href={url} target="_blank" rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-semibold active:scale-95 transition-transform">
                  <Navigation className="w-3.5 h-3.5" /> Open in Maps
                </a>
                <button onClick={copyAddresses}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-secondary text-secondary-foreground border border-border rounded-xl text-xs font-semibold active:scale-95 transition-transform">
                  Copy Addresses
                </button>
              </div>
            ) : null;
          })()}
        </div>
      )}

      {routeData?.route_stats && (
        <div className="px-4 mt-4 space-y-2">
          {routeData?.route_stats && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-600 shrink-0" />
                  <p className="text-sm font-bold text-blue-900">Route Optimized</p>
                </div>
                <button onClick={() => setRouteData(null)} className="text-[10px] text-blue-500 font-semibold underline">Reset</button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="bg-white rounded-lg px-2 py-1.5 border border-blue-200">
                  <p className="text-blue-600 font-medium">Duration</p>
                  <p className="text-lg font-bold text-blue-900">{routeData.route_stats.optimized_duration_minutes || 0}</p>
                  <p className="text-[10px] text-blue-500">minutes</p>
                </div>
                <div className="bg-white rounded-lg px-2 py-1.5 border border-blue-200">
                  <p className="text-blue-600 font-medium">Distance</p>
                  <p className="text-lg font-bold text-blue-900">{routeData.route_stats.total_distance_miles}</p>
                  <p className="text-[10px] text-blue-500">miles</p>
                </div>
                <div className="bg-white rounded-lg px-2 py-1.5 border border-blue-200">
                  <p className="text-blue-600 font-medium">Stops</p>
                  <p className="text-lg font-bold text-blue-900">{routeData.route_stats.stops_count}</p>
                  <p className="text-[10px] text-blue-500">in route</p>
                </div>
                {routeData.route_stats.time_saved_minutes > 0 && (
                  <div className="bg-green-50 rounded-lg px-2 py-1.5 border border-green-300">
                    <p className="text-green-700 font-medium">Savings</p>
                    <p className="text-lg font-bold text-green-900">~{routeData.route_stats.time_saved_minutes}</p>
                    <p className="text-[10px] text-green-600">min saved</p>
                  </div>
                )}
              </div>
              <p className="text-[10px] text-blue-600">Method: {routeData.route_stats.optimization_method === 'google_routes_api' ? 'Google Routes API' : 'Cluster-based sorting'}</p>
            </div>
          )}
          {(() => {
            const optimizedStops = (routeData?.optimized_orders || []).filter(o =>
              !DONE_STATUSES_GLOBAL.has(o.status || '')
            );
            const url = buildFullRouteUrl(optimizedStops);
            const copyAddresses = () => {
              const addrs = optimizedStops.map((o, i) =>
                `Stop ${i+1}: ${o.customer_name} — ${o.address_line1 || o.delivery_address}, ${o.address_city}, ${o.address_state}`
              ).join('\n');
              navigator.clipboard.writeText(`NuVira Delivery Route\n\n${addrs}\n\nReturn to: ${DEPOT}`);
              toast.success('Route addresses copied');
            };
            return url ? (
              <div className="flex gap-2">
                <a href={url} target="_blank" rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-blue-600 text-white rounded-xl text-sm font-bold active:scale-[0.98] transition-transform">
                  <Navigation className="w-4 h-4" />
                  Open in Google Maps
                </a>
                <button onClick={copyAddresses}
                  className="px-4 py-3.5 bg-secondary text-secondary-foreground border border-border rounded-xl text-sm font-semibold active:scale-95 transition-transform">
                  Copy
                </button>
              </div>
            ) : null;
          })()}
        </div>
      )}

      <div className="px-4 mt-4 space-y-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">Loading delivery queue...</p>
          </div>
        ) : allTasksForDate.length === 0 ? (
          <div className="text-center py-16">
            <CheckCircle2 className="w-10 h-10 text-primary mx-auto mb-3" />
            <p className="text-sm font-semibold">No delivery tasks scheduled for {getDateLabel(date).toLowerCase()}</p>
            <p className="text-xs text-muted-foreground mt-1">Try selecting a different date.</p>
          </div>
        ) : (
          <>
            {/* Ready For Route Section — show all non-completed active stops */}
            {(readyForRouteOrders.length > 0 || scheduledNotReadyOrders.length > 0) && (
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-primary px-1 flex items-center gap-1">
                  <Route className="w-3.5 h-3.5" />
                  {routeData?.optimized_orders ? `Optimized Route (${routeData.optimized_orders.filter(o => !isCompleted(o)).length} stops)` : `Delivery Stops (${readyForRouteOrders.length + scheduledNotReadyOrders.length})`}
                </p>
                {routeData?.optimized_orders ? (
                  // Show optimized route order with stop numbers
                  routeData.optimized_orders
                    .filter(o => !isCompleted(o))
                    .map((order, idx) => (
                      <div key={`${order.id}-${idx}`} className="relative">
                        <div className="absolute -left-4 top-4 w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold text-xs">
                          {idx + 1}
                        </div>
                        <StopCard
                          order={order}
                          pendingReturn={pendingReturnsByEmail[order.customer_email] || null}
                          onMarkDelivered={(order, photo, loc) => handleMarkDelivered(order, photo, loc)}
                          onMarkUnableToDeliver={handleMarkUnableToDeliver}
                          onMarkStage={handleMarkStage}
                          onReturnVerified={(ret, data) => onBagReturnVerified(ret, data)}
                          allCredits={allCredits}
                          user={user}
                          isUpdating={updatingId === order.id || deletingId === order.id}
                          onDelete={handleDeleteOrder}
                        />
                      </div>
                    ))
                ) : (
                  // Show all non-completed stops before optimization
                  [...readyForRouteOrders, ...scheduledNotReadyOrders].map((order) => (
                    <StopCard
                      key={order.id}
                      order={order}
                      pendingReturn={pendingReturnsByEmail[order.customer_email] || null}
                      onMarkDelivered={(order, photo, loc) => handleMarkDelivered(order, photo, loc)}
                      onMarkUnableToDeliver={handleMarkUnableToDeliver}
                      onMarkStage={handleMarkStage}
                      onReturnVerified={(ret, data) => onBagReturnVerified(ret, data)}
                      allCredits={allCredits}
                      user={user}
                      isUpdating={updatingId === order.id || deletingId === order.id}
                      onDelete={handleDeleteOrder}
                    />
                  ))
                )}
              </div>
            )}

            {/* Scheduled stops without route optimization are shown in the unified section above */}

            {/* Completed Section */}
            {completedOrders.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground px-1 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Completed ({completedCount})
                </p>
                {completedOrders.map((order) => (
                  <StopCard
                    key={order.id}
                    order={order}
                    pendingReturn={pendingReturnsByEmail[order.customer_email] || null}
                    onMarkDelivered={(order, photo, loc) => handleMarkDelivered(order, photo, loc)}
                    onMarkUnableToDeliver={handleMarkUnableToDeliver}
                    onMarkStage={handleMarkStage}
                    onReturnVerified={(ret, data) => onBagReturnVerified(ret, data)}
                    allCredits={allCredits}
                    user={user}
                    isUpdating={updatingId === order.id || deletingId === order.id}
                    onDelete={handleDeleteOrder}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {pendingBagReturns.length > 0 && (
        <div className="px-4 mt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Pending Collections — Future Deliveries
          </p>
          <div className="space-y-2">
            {pendingBagReturns.map(ret => (
              <div key={ret.id} className="bg-card border border-border/40 rounded-xl p-3 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{ret.customer_email}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{bagSummary(ret)}</p>
                </div>
                <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-1 rounded-full shrink-0 ml-2">Pending</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">These will appear in Route when their delivery is scheduled for today.</p>
        </div>
      )}
    </div>
  );
}

// ─── Returns Tab ────────────────────────────────────────────────────────────

function ReturnCard({ ret, user, onVerify }) {
  const [expanded, setExpanded] = useState(false);
  const isPending = ret.verification_status === 'requested';

  return (
    <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3.5 p-4 text-left active:bg-secondary/40 transition-colors">
        <div className="w-10 h-10 bg-primary/8 rounded-full flex items-center justify-center shrink-0">
          <Package className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{ret.customer_email}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[10px] text-muted-foreground">{bagSummary(ret)}</span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${RETURN_STATUS_COLOR[ret.verification_status] || ''}`}>
              {ret.verification_status?.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {ret.created_date && !isNaN(new Date(ret.created_date).getTime()) ? format(new Date(ret.created_date), 'MMM d · h:mm a') : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {ret.credit_issued > 0 && <span className="text-xs font-semibold text-primary">+${ret.credit_issued.toFixed(2)}</span>}
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="p-4 border-t border-border/40 space-y-3">
              {!isPending ? (
                <div className="space-y-1.5 text-sm text-muted-foreground">
                  <p><span className="text-foreground font-medium">Small bags:</span> {ret.small_bags_accepted || 0} of {ret.small_bags_requested || 0} accepted</p>
                  <p><span className="text-foreground font-medium">Tote bags:</span> {ret.tote_bags_accepted || 0} of {ret.tote_bags_requested || 0} accepted</p>
                  {ret.rejection_reason && <p><span className="text-foreground font-medium">Reason:</span> {ret.rejection_reason.replace(/_/g, ' ')}</p>}
                  {ret.driver_notes && <p><span className="text-foreground font-medium">Notes:</span> {ret.driver_notes}</p>}
                  {ret.photo_url && <img src={ret.photo_url} alt="Evidence" className="w-full max-w-xs rounded-xl border border-border mt-2" />}
                  {ret.verified_by && <p className="text-[10px]">Verified by {ret.verified_by}</p>}
                </div>
              ) : (
                <InlineBagReturn ret={ret} user={user} onVerifyComplete={onVerify} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ReturnsTab({ returns, user, isLoading, onVerify }) {
  const [filter, setFilter] = useState('pending');
  const pending = returns.filter(r => r.verification_status === 'requested');
  const completed = returns.filter(r => r.verification_status !== 'requested');
  const todayDone = completed.filter(r => r.verified_at?.startsWith(new Date().toISOString().slice(0, 10))).length;
  const displayed = filter === 'pending' ? pending : completed;

  return (
    <div className="pb-10">
      <div className="grid grid-cols-3 divide-x divide-border border-b border-border bg-card">
        {[
          { label: 'Pending', value: pending.length, color: 'text-amber-600' },
          { label: 'Done Today', value: todayDone, color: 'text-primary' },
          { label: 'All Done', value: completed.length, color: 'text-foreground' },
        ].map(s => (
          <div key={s.label} className="py-4 text-center">
            <p className={`text-xl font-bold font-heading ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 px-4 mt-4 mb-3">
        {[
          { key: 'pending', label: `Pending (${pending.length})` },
          { key: 'done', label: `Done (${completed.length})` },
        ].map(tab => (
          <button key={tab.key} onClick={() => setFilter(tab.key)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${filter === tab.key ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="px-4 space-y-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : displayed.length === 0 ? (
          <div className="text-center py-20">
            <CheckCircle2 className="w-10 h-10 text-primary mx-auto mb-3" />
            <p className="text-sm font-semibold">{filter === 'pending' ? 'All caught up.' : 'No completed returns yet.'}</p>
          </div>
        ) : (
          displayed.map(ret => (
            <ReturnCard key={ret.id} ret={ret} user={user} onVerify={(data) => onVerify(ret, data)} />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Main Portal ────────────────────────────────────────────────────────────

export default function DriverPortal() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('route');

  const isAuthorized = user?.role === 'driver' || user?.role === 'admin';

  const { data: bagReturns = [], isLoading: returnsLoading } = useQuery({
    queryKey: ['driver-bag-returns'],
    queryFn: () => base44.entities.BagReturn.list('-created_date', 200),
    enabled: isAuthorized,
    refetchInterval: 30000,
  });

  const { data: allCredits = [] } = useQuery({
    queryKey: ['driver-all-credits'],
    queryFn: () => base44.entities.NuViraCredit.list('-created_date', 500),
    enabled: isAuthorized,
  });

  const pendingReturns = bagReturns.filter(r => r.verification_status === 'requested');

  const verifyMutation = useMutation({
    mutationFn: async ({ ret, data }) => {
      // Update local bag return record
      await base44.entities.BagReturn.update(ret.id, data);
      
      // Send to Hub via receiveDriverStatusUpdate
      if (ret.order_id) {
        await base44.functions.invoke('receiveDriverStatusUpdate', {
          order_id: ret.order_id,
          order_number: ret.order_id, // Will be resolved in the function
          driver_email: user?.email,
          action: 'bag_return_verified',
          bag_data: {
            small_bags_requested: ret.small_bags_requested,
            small_bags_accepted: data.small_bags_accepted,
            tote_bags_requested: ret.tote_bags_requested,
            tote_bags_accepted: data.tote_bags_accepted,
            credit_issued: data.credit_issued,
            verification_status: data.verification_status,
          },
        }).catch(err => console.warn('Bag return audit log failed (non-critical):', err.message));
      }
      
      if (data.credit_issued > 0) {
        const existing = allCredits.find(c => c.customer_email === ret.customer_email);
        const entry = {
          amount: data.credit_issued, type: 'issued',
          description: `Return + Reward${data.verification_status === 'partially_verified' ? ' (Partial)' : ''}`,
          order_id: ret.order_id, timestamp: new Date().toISOString(),
        };
        if (existing) {
          await base44.entities.NuViraCredit.update(existing.id, {
            balance: (existing.balance || 0) + data.credit_issued,
            lifetime_issued: (existing.lifetime_issued || 0) + data.credit_issued,
            history: [...(existing.history || []), entry],
          });
        } else {
          await base44.entities.NuViraCredit.create({
            customer_email: ret.customer_email, balance: data.credit_issued,
            lifetime_issued: data.credit_issued, lifetime_used: 0, history: [entry],
          });
        }
        await base44.integrations.Core.SendEmail({
          to: ret.customer_email,
          subject: 'Return Verified — NuVira Credits Added',
          body: `Your NuVira return has been verified and $${data.credit_issued.toFixed(2)} in NuVira Credits has been added to your account.\n\nSustainability, The NuVira Way.`,
        });
      } else if (data.verification_status === 'not_eligible') {
        await base44.integrations.Core.SendEmail({
          to: ret.customer_email,
          subject: 'Return Not Eligible',
          body: `Your bag was not eligible for reuse this time. Bags must be clean, odor-free, and free of damage to qualify.\n\nThank you for participating.`,
        });
      } else if (data.verification_status === 'unable_to_collect') {
        await base44.integrations.Core.SendEmail({
          to: ret.customer_email,
          subject: 'Bag Return — Unable to Collect Today',
          body: `We were unable to collect your bags during today's delivery. We'll try again on your next delivery. Thank you for your patience!`,
        });
      } else if (data.verification_status === 'not_found') {
        await base44.integrations.Core.SendEmail({
          to: ret.customer_email,
          subject: 'Return Not Located',
          body: `We were unable to locate a bag at your delivery address. If you believe this is an error, please contact us through the Support section.`,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['driver-bag-returns'] });
      queryClient.invalidateQueries({ queryKey: ['driver-all-credits'] });
      toast.success('Return submitted');
    },
    onError: () => toast.error('Submission failed'),
  });

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center">
        <Leaf className="w-10 h-10 text-primary mb-4" />
        <h1 className="font-heading text-xl font-bold mb-2">Sign In Required</h1>
        <p className="text-sm text-muted-foreground mb-6">Please sign in with your driver account.</p>
        <button onClick={() => base44.auth.redirectToLogin('/driver')}
          className="px-6 py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold">
          Sign In
        </button>
      </div>
    );
  }

  if (!isAuthorized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center">
        <XCircle className="w-10 h-10 text-destructive mb-4" />
        <h1 className="font-heading text-xl font-bold mb-2">Access Restricted</h1>
        <p className="text-sm text-muted-foreground">This area is for NuVira drivers only.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-primary px-4 pb-4" style={{ paddingTop: 'max(2.5rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-2 mb-0.5">
          {user?.role === 'admin' && (
            <button onClick={() => navigate('/admin/orders')} className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors">
              <ArrowLeft className="w-4 h-4 text-white" />
            </button>
          )}
          <Leaf className="w-5 h-5 text-primary-foreground/70" />
          <h1 className="font-heading text-2xl font-bold text-primary-foreground">Driver Portal</h1>
        </div>
        <p className="text-primary-foreground/50 text-[11px]">{user.email}</p>

        <div className="flex gap-2 mt-4">
          <button onClick={() => setTab('route')}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-colors ${tab === 'route' ? 'bg-white text-primary' : 'bg-white/20 text-white'}`}>
            <Route className="w-3.5 h-3.5 inline mr-1.5" />
            Route
          </button>
          <button onClick={() => setTab('returns')}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-colors relative ${tab === 'returns' ? 'bg-white text-primary' : 'bg-white/20 text-white'}`}>
            <Recycle className="w-3.5 h-3.5 inline mr-1.5" />
            Bag Returns
            {pendingReturns.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-400 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {pendingReturns.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {tab === 'route' ? (
        <RouteTab
          bagReturns={bagReturns}
          allCredits={allCredits}
          user={user}
          onBagReturnVerified={(ret, data) => verifyMutation.mutate({ ret, data })}
        />
      ) : (
        <ReturnsTab
          returns={bagReturns}
          user={user}
          isLoading={returnsLoading}
          onVerify={(ret, data) => verifyMutation.mutate({ ret, data })}
        />
      )}
    </div>
  );
}