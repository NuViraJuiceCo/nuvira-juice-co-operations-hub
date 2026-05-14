import { useState } from "react";
import { Edit2, Trash2, Lock, Unlock, ChevronDown, ChevronUp, Play } from "lucide-react";
import StatusBadge from "../shared/StatusBadge";
import moment from "moment";
import { resolveBatchDeliveryStatus } from "../../lib/deliveryStatusHelper";

function SourceBreakdown({ sources }) {
  if (!sources || sources.length === 0) return null;

  const direct = sources.filter(s => s.source_type === 'direct');
  const bundles = sources.filter(s => s.source_type === 'bundle');
  // Match both 'subscription' and 'subscription_fulfillment' source types
  const subs = sources.filter(s => s.source_type === 'subscription' || s.source_type === 'subscription_fulfillment');
  const manualBatches = sources.filter(s => s.source_type === 'manual_internal_batch');

  // Zone badge helper for source rows
  const ZoneTag = ({ source }) => {
    const zone = source.delivery_zone_key || source.zone_key;
    if (!zone) return null;
    const isZ3 = zone === 'zone3' || zone === 'zone_zone3';
    const isZ2 = zone === 'zone2' || zone === 'zone_zone2';
    if (isZ3) return <span className="ml-1 text-[9px] font-bold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">Z3✓</span>;
    if (isZ2) return <span className="ml-1 text-[9px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">Z2</span>;
    return null;
  };

  return (
    <div className="mt-3 pt-3 border-t border-border space-y-2">
      {direct.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-foreground/80 mb-1">Direct orders ({direct.reduce((s, x) => s + x.quantity, 0)} units)</p>
          {direct.map((s, i) => (
            <p key={i} className="text-xs text-foreground/70 pl-2 flex items-center gap-1 flex-wrap">
              · {s.order_number} — {s.customer_name || s.customer_email} × {s.quantity}
              <ZoneTag source={s} />
            </p>
          ))}
        </div>
      )}
      {bundles.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-foreground/80 mb-1">From packages ({bundles.reduce((s, x) => s + x.quantity, 0)} units)</p>
          {bundles.map((s, i) => (
            <p key={i} className="text-xs text-foreground/70 pl-2">
              · {s.order_number} — {s.customer_name || s.customer_email} × {s.quantity} (via {s.source_item})
            </p>
          ))}
        </div>
      )}
      {subs.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-foreground/80 mb-1">
            <span className="inline-flex items-center gap-1">
              <span className="bg-blue-100 text-blue-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">SUB</span>
              Subscriptions ({subs.reduce((s, x) => s + x.quantity, 0)} units)
            </span>
          </p>
          {subs.map((s, i) => {
            const fulfillmentLabel = s.fulfillment_number
              ? ` — Fulfillment #${s.fulfillment_number}`
              : (s.fulfillment_index && s.fulfillment_total ? ` (${s.fulfillment_index}/${s.fulfillment_total})` : '');
            return (
              <p key={i} className="text-xs text-foreground/70 pl-2 flex items-center gap-1 flex-wrap">
                · <span className="font-medium text-blue-700">{s.customer_name || s.customer_email}</span>
                {' '}— {s.order_number}{fulfillmentLabel} × {s.quantity}
                <ZoneTag source={s} />
              </p>
            );
          })}
        </div>
      )}
      {manualBatches.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-foreground/80 mb-1">
            <span className="inline-flex items-center gap-1">
              <span className="bg-purple-100 text-purple-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">INTERNAL</span>
              Internal Batches ({manualBatches.reduce((s, x) => s + x.quantity, 0)} units)
            </span>
          </p>
          {manualBatches.map((s, i) => (
            <p key={i} className="text-xs text-purple-700 pl-2">
              · {s.manual_batch_title || s.customer_name} × {s.quantity}
              {s.manual_batch_purpose && <span className="text-purple-500 ml-1">({s.manual_batch_purpose})</span>}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function BatchCard({ batch, onEdit, onDelete, onToggleLock, onStart, fulfillmentTasksByOrderId = {} }) {
  const [expanded, setExpanded] = useState(false);
  const isShot = batch.product_category === 'shot';
  const categoryColor = isShot ? 'border-l-status-warning' : 'border-l-primary';
  const statusLower = (batch.status || '').toLowerCase();
  const canStart = ['planned', 'ready_for_production'].includes(statusLower);
  const deliveryDisplay = resolveBatchDeliveryStatus(batch, fulfillmentTasksByOrderId);

  return (
    <div className={`bg-card border border-border border-l-4 ${categoryColor} rounded-xl p-5 hover:shadow-md transition-shadow overflow-hidden flex flex-col h-full`}>
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1 justify-between">
          {/* Product name — high contrast, never muted */}
          <h4 className="font-bold text-foreground text-base break-words flex-1 min-w-0 leading-snug">{batch.product_name}</h4>
          <div className="flex items-center gap-1 shrink-0 ml-2">
            {isShot && (
              <span className="text-[10px] font-semibold bg-status-warning-bg text-status-warning border border-status-warning-border px-1.5 py-0.5 rounded-full whitespace-nowrap">
                Shot
              </span>
            )}
            {batch.is_locked && (
              <span className="text-[10px] font-semibold bg-muted text-foreground border border-border px-1.5 py-0.5 rounded-full flex items-center gap-0.5 whitespace-nowrap">
                <Lock className="h-2.5 w-2.5" /> Locked
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          {/* Batch ID — readable, not invisible */}
          <p className="text-xs font-medium text-foreground/70 truncate flex-1 min-w-0">{batch.batch_id}</p>
          <div className="flex items-center gap-1 shrink-0">
            {canStart && onStart && (
              <button
                onClick={() => onStart(batch)}
                className="text-primary hover:text-primary/80 p-1 shrink-0"
                title="Start batch production"
              >
                <Play className="h-3.5 w-3.5" />
              </button>
            )}
            <button onClick={() => onToggleLock(batch)} className="text-muted-foreground hover:text-foreground p-1 shrink-0" title={batch.is_locked ? "Unlock" : "Lock"}>
              {batch.is_locked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
            </button>
            <button onClick={() => onEdit(batch)} className="text-primary hover:text-primary/80 p-1 shrink-0">
              <Edit2 className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => onDelete(batch.id)} className="text-status-danger hover:text-status-danger/80 p-1 shrink-0">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <StatusBadge status={batch.status} />
          </div>
        </div>
      </div>

      {/* Stats — labels readable, values bold and high contrast */}
      <div className="grid grid-cols-4 gap-3 mt-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Needed</p>
          <p className="text-xl font-bold text-primary leading-tight">{batch.planned_units}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Produced</p>
          <p className="text-xl font-bold text-foreground leading-tight">{batch.actual_units ?? "—"}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Orders</p>
          <p className="text-xl font-bold text-foreground leading-tight">{batch.order_sources?.length ?? 0}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Delivery</p>
          <p className="text-xs font-semibold text-foreground truncate leading-tight mt-0.5" title={deliveryDisplay}>{deliveryDisplay}</p>
        </div>
      </div>

      {/* Notes — readable, not invisible */}
      {batch.notes && (
        <p className="text-xs text-foreground/70 mt-3 line-clamp-2 break-words leading-relaxed border-t border-border pt-2">{batch.notes}</p>
      )}

      {/* Expand source breakdown */}
      {batch.order_sources && batch.order_sources.length > 0 && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-3 flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? 'Hide' : 'Show'} order sources
          </button>
          {expanded && <SourceBreakdown sources={batch.order_sources} />}
        </>
      )}
    </div>
  );
}

export default function ProductionDayCard({ date, batches, today, fulfillmentTasksByOrderId = {}, onEdit, onDelete, onToggleLock, onStart }) {
  const isToday = date === today;
  const isPast = date < today;
  const isSoon = !isToday && !isPast && moment(date).diff(moment(), 'days') <= 3;
  const dateLabel = isToday
    ? `Today — ${moment(date).format("dddd, MMMM D, YYYY")}`
    : isPast
    ? `📦 Retrospective — ${moment(date).format("dddd, MMMM D, YYYY")}`
    : isSoon
    ? `${moment(date).format("dddd, MMMM D, YYYY")} (in ${moment(date).diff(moment().startOf('day'), 'days')} days)`
    : moment(date).format("dddd, MMMM D, YYYY");

  const juices = batches.filter(b => b.product_category !== 'shot');
  const shots = batches.filter(b => b.product_category === 'shot');
  const totalUnits = batches.reduce((s, b) => s + (b.planned_units || 0), 0);
  const totalJuices = juices.reduce((s, b) => s + (b.planned_units || 0), 0);
  const totalShots = shots.reduce((s, b) => s + (b.planned_units || 0), 0);
  const anyLocked = batches.some(b => b.is_locked);

  return (
    <div>
      {/* Date header — uses theme-aware tokens, never raw light/dark colors */}
      <div className={`flex flex-wrap items-center gap-3 mb-4 p-3 rounded-xl border ${
        isToday
          ? 'bg-primary/10 border-primary/30'
          : isPast
          ? 'bg-muted/40 border-border'
          : isSoon
          ? 'bg-status-warning-bg border-status-warning-border'
          : 'bg-muted/30 border-border'
      }`}>
        <div>
          <h3 className={`text-sm font-bold ${
            isToday ? 'text-primary' : isSoon ? 'text-status-warning' : 'text-foreground'
          }`}>{dateLabel}</h3>
          <p className="text-xs text-foreground/70 mt-0.5 font-medium">
            {batches.length} product{batches.length !== 1 ? 's' : ''} · {totalUnits} total bottles
            {totalJuices > 0 && ` · ${totalJuices} juice${totalJuices !== 1 ? 's' : ''}`}
            {totalShots > 0 && ` · ${totalShots} shot${totalShots !== 1 ? 's' : ''}`}
          </p>
        </div>
        {anyLocked && (
          <span className="ml-auto flex items-center gap-1 text-xs text-foreground/70 bg-muted border border-border px-2 py-1 rounded-full font-medium">
            <Lock className="h-3 w-3" /> Day partially locked
          </span>
        )}
      </div>

      {/* Batch cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {batches.map(batch => (
          <BatchCard
            key={batch.id}
            batch={batch}
            fulfillmentTasksByOrderId={fulfillmentTasksByOrderId}
            onEdit={onEdit}
            onDelete={onDelete}
            onToggleLock={onToggleLock}
            onStart={onStart}
          />
        ))}
      </div>
    </div>
  );
}