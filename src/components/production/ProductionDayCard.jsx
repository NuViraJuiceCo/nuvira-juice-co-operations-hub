import { useState } from "react";
import { Edit2, Trash2, Lock, Unlock, ChevronDown, ChevronUp } from "lucide-react";
import StatusBadge from "../shared/StatusBadge";
import moment from "moment";

function SourceBreakdown({ sources }) {
  if (!sources || sources.length === 0) return null;

  const direct = sources.filter(s => s.source_type === 'direct');
  const bundles = sources.filter(s => s.source_type === 'bundle');
  const subs = sources.filter(s => s.source_type === 'subscription');

  return (
    <div className="mt-3 pt-3 border-t border-border space-y-2">
      {direct.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Direct orders ({direct.reduce((s, x) => s + x.quantity, 0)} units)</p>
          {direct.map((s, i) => (
            <p key={i} className="text-xs text-muted-foreground pl-2">
              · {s.order_number} — {s.customer_name || s.customer_email} × {s.quantity}
            </p>
          ))}
        </div>
      )}
      {bundles.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">From packages ({bundles.reduce((s, x) => s + x.quantity, 0)} units)</p>
          {bundles.map((s, i) => (
            <p key={i} className="text-xs text-muted-foreground pl-2">
              · {s.order_number} — {s.customer_name || s.customer_email} × {s.quantity} (via {s.source_item})
            </p>
          ))}
        </div>
      )}
      {subs.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Subscriptions ({subs.reduce((s, x) => s + x.quantity, 0)} units)</p>
          {subs.map((s, i) => (
            <p key={i} className="text-xs text-muted-foreground pl-2">
              · {s.order_number} — {s.customer_name || s.customer_email} × {s.quantity}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function BatchCard({ batch, onEdit, onDelete, onToggleLock }) {
  const [expanded, setExpanded] = useState(false);
  const categoryColor = batch.product_category === 'shot'
    ? 'border-l-amber-400'
    : 'border-l-primary';

  return (
    <div className={`bg-card border border-border border-l-4 ${categoryColor} rounded-xl p-5 hover:shadow-sm transition-shadow`}>
      {/* Header row */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-foreground">{batch.product_name}</h4>
            {batch.product_category === 'shot' && (
              <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">Shot</span>
            )}
            {batch.is_locked && (
              <span className="text-xs bg-slate-100 text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                <Lock className="h-2.5 w-2.5" /> Locked
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{batch.batch_id}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => onToggleLock(batch)} className="text-muted-foreground hover:text-foreground p-1" title={batch.is_locked ? "Unlock" : "Lock"}>
            {batch.is_locked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
          </button>
          <button onClick={() => onEdit(batch)} className="text-primary hover:text-primary/80 p-1">
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => onDelete(batch.id)} className="text-red-500 hover:text-red-600 p-1">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <StatusBadge status={batch.status} />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mt-4">
        <div>
          <p className="text-xs text-muted-foreground">Needed</p>
          <p className="text-xl font-bold text-primary">{batch.planned_units}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Produced</p>
          <p className="text-xl font-bold text-foreground">{batch.actual_units ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Orders</p>
          <p className="text-xl font-bold text-foreground">{batch.order_sources?.length ?? 0}</p>
        </div>
      </div>

      {/* Notes */}
      {batch.notes && (
        <p className="text-xs text-muted-foreground mt-3 italic">{batch.notes}</p>
      )}

      {/* Expand source breakdown */}
      {batch.order_sources && batch.order_sources.length > 0 && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-3 flex items-center gap-1 text-xs text-primary hover:text-primary/80"
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

export default function ProductionDayCard({ date, batches, today, onEdit, onDelete, onToggleLock }) {
  const isToday = date === today;
  const isSoon = !isToday && moment(date).diff(moment(), 'days') <= 3;
  const dateLabel = isToday
    ? `Today — ${moment(date).format("dddd, MMMM D, YYYY")}`
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
      {/* Date header */}
      <div className={`flex flex-wrap items-center gap-3 mb-4 p-3 rounded-xl ${isToday ? 'bg-primary/5 border border-primary/20' : isSoon ? 'bg-amber-50 border border-amber-200' : 'bg-muted/30'}`}>
        <div>
          <h3 className={`text-sm font-bold ${isToday ? 'text-primary' : 'text-foreground'}`}>{dateLabel}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {batches.length} product{batches.length !== 1 ? 's' : ''} · {totalUnits} total bottles
            {totalJuices > 0 && ` · ${totalJuices} juice${totalJuices !== 1 ? 's' : ''}`}
            {totalShots > 0 && ` · ${totalShots} shot${totalShots !== 1 ? 's' : ''}`}
          </p>
        </div>
        {anyLocked && (
          <span className="ml-auto flex items-center gap-1 text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-full border border-slate-200">
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
            onEdit={onEdit}
            onDelete={onDelete}
            onToggleLock={onToggleLock}
          />
        ))}
      </div>
    </div>
  );
}