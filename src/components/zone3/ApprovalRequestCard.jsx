import { useState } from 'react';
import { MapPin, Clock, DollarSign, User, Phone, Mail, Package, ShieldCheck, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import moment from 'moment';

function TimeRemaining({ expiresAt }) {
  if (!expiresAt) return <span className="text-muted-foreground text-xs">—</span>;
  const diff = moment(expiresAt).diff(moment(), 'hours');
  const color = diff < 24 ? 'text-red-600 font-bold' : diff < 48 ? 'text-amber-600 font-semibold' : 'text-green-600';
  return (
    <span className={`text-xs ${color}`}>
      {diff < 0 ? 'EXPIRED' : diff < 1 ? `${moment(expiresAt).diff(moment(), 'minutes')}m left` : `${diff}h left`}
    </span>
  );
}

export default function ApprovalRequestCard({ request, onApprove, onDeny, readOnly }) {
  const [expanded, setExpanded] = useState(false);

  const statusColors = {
    pending_review: 'bg-amber-100 text-amber-800',
    approved: 'bg-green-100 text-green-800',
    denied: 'bg-red-100 text-red-800',
    expired: 'bg-gray-100 text-gray-700',
    captured: 'bg-blue-100 text-blue-800',
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
      {/* Card Header */}
      <div className="px-4 py-3 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono font-bold text-primary">{request.request_number || `ZR3-${request.id?.slice(-6).toUpperCase()}`}</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColors[request.status] || 'bg-muted text-muted-foreground'}`}>
              {(request.status || '').replace(/_/g, ' ').toUpperCase()}
            </span>
            {request.zone_name && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">
                {request.zone_name}
              </span>
            )}
          </div>
          <p className="font-semibold text-sm mt-1 truncate">{request.customer_name}</p>
          <p className="text-xs text-muted-foreground truncate">{request.delivery_address}</p>
        </div>
        <button onClick={() => setExpanded(v => !v)} className="shrink-0 text-muted-foreground hover:text-foreground p-1">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Key metrics row */}
      <div className="px-4 pb-3 grid grid-cols-3 gap-2">
        <div className="bg-muted/30 rounded-lg p-2 text-center">
          <p className="text-[10px] text-muted-foreground">Distance</p>
          <p className="text-sm font-bold">{request.estimated_distance_miles ?? '—'} mi</p>
        </div>
        <div className="bg-muted/30 rounded-lg p-2 text-center">
          <p className="text-[10px] text-muted-foreground">Drive Time</p>
          <p className="text-sm font-bold">{request.estimated_drive_time_minutes ?? '—'} min</p>
        </div>
        <div className="bg-muted/30 rounded-lg p-2 text-center">
          <p className="text-[10px] text-muted-foreground">Cart</p>
          <p className="text-sm font-bold">${(request.cart_subtotal || 0).toFixed(2)}</p>
        </div>
      </div>

      {/* Auth info row */}
      <div className="px-4 pb-3 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-green-600" />
          <span className="text-xs text-muted-foreground">Auth: <span className="font-semibold text-foreground">${(request.amount_authorized || 0).toFixed(2)}</span></span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <TimeRemaining expiresAt={request.authorization_expires_at} />
        </div>
        {request.requested_delivery_date && (
          <span className="text-xs text-muted-foreground">Delivery: <span className="font-medium">{moment(request.requested_delivery_date).format('MMM D')}</span></span>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3 text-sm">
          {/* Contact */}
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Contact</p>
            <div className="flex items-center gap-2"><Mail className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-xs">{request.customer_email}</span></div>
            {request.customer_phone && <div className="flex items-center gap-2"><Phone className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-xs">{request.customer_phone}</span></div>}
          </div>

          {/* Cart items */}
          {(request.cart_items || []).length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Cart Items</p>
              <div className="space-y-0.5">
                {request.cart_items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span>{item.quantity}x {item.title || item.product_name}</span>
                    <span className="text-muted-foreground">${((item.price || 0) * (item.quantity || 1)).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Payment details */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Payment Authorization</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
              <span className="text-muted-foreground">Intent ID</span>
              <span className="font-mono truncate">{request.stripe_payment_intent_id}</span>
              <span className="text-muted-foreground">Authorized</span>
              <span>${(request.amount_authorized || 0).toFixed(2)}</span>
              <span className="text-muted-foreground">Capturable</span>
              <span>${(request.amount_capturable || 0).toFixed(2)}</span>
              <span className="text-muted-foreground">Expires</span>
              <span>{request.authorization_expires_at ? moment(request.authorization_expires_at).format('MMM D, h:mm A') : '—'}</span>
              <span className="text-muted-foreground">Cust. Ack. Hold</span>
              <span>{request.customer_acknowledged_hold ? '✓ Yes' : '—'}</span>
            </div>
          </div>

          {/* Suggested fee */}
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            <DollarSign className="w-3.5 h-3.5 text-green-600" />
            <span className="text-xs text-green-800 font-medium">
              Suggested fee: ${request.estimated_distance_miles <= 30 ? '12.99' : '15.99'}
              {' '}({request.estimated_distance_miles <= 30 ? '25–30 mi' : '30–35 mi'} tier)
            </span>
          </div>

          {/* Audit trail */}
          {(request.audit_trail || []).length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Audit Trail</p>
              <div className="space-y-1">
                {request.audit_trail.map((e, i) => (
                  <div key={i} className="text-[10px] text-muted-foreground bg-muted/30 rounded px-2 py-1">
                    <span className="font-semibold text-foreground">{e.action}</span> by {e.performed_by} · {moment(e.timestamp).format('MMM D h:mm A')}
                    {e.reason && <span> — {e.reason}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {request.status === 'denied' && request.denial_reason && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
              <span className="font-bold">Denial Reason: </span>{request.denial_reason}
            </div>
          )}

          {request.status === 'captured' && request.created_hub_order_id && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700">
              <span className="font-bold">Hub Order Created: </span>{request.created_hub_order_id}
            </div>
          )}
        </div>
      )}

      {/* Actions — only for pending */}
      {!readOnly && request.status === 'pending_review' && (
        <div className="border-t border-border px-4 py-3 flex gap-2">
          <Button onClick={() => onDeny(request)} variant="outline" size="sm" className="flex-1 border-red-300 text-red-700 hover:bg-red-50">
            Deny
          </Button>
          <Button onClick={() => onApprove(request)} size="sm" className="flex-1 bg-green-600 hover:bg-green-700 text-white">
            Approve
          </Button>
        </div>
      )}
    </div>
  );
}