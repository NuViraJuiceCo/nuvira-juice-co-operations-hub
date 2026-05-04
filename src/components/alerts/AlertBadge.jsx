import { cn } from '@/lib/utils';

const SEVERITY = {
  critical: { label: 'Critical', classes: 'bg-status-danger-bg text-status-danger border-status-danger-border' },
  warning:  { label: 'Warning',  classes: 'bg-status-warning-bg text-status-warning border-status-warning-border' },
  info:     { label: 'Info',     classes: 'bg-status-info-bg text-status-info border-status-info-border' },
};

const STATUS = {
  unread:       { label: 'Unread',       classes: 'bg-status-danger-bg text-status-danger border-status-danger-border' },
  read:         { label: 'Read',         classes: 'bg-muted text-muted-foreground border-border' },
  acknowledged: { label: 'Acknowledged', classes: 'bg-status-info-bg text-status-info border-status-info-border' },
  resolved:     { label: 'Resolved',     classes: 'bg-status-success-bg text-status-success border-status-success-border' },
  dismissed:    { label: 'Dismissed',    classes: 'bg-muted text-muted-foreground border-border' },
};

export function SeverityBadge({ severity, className }) {
  const cfg = SEVERITY[severity] || SEVERITY.info;
  return (
    <span className={cn('text-xs px-2 py-0.5 rounded-full border font-semibold', cfg.classes, className)}>
      {cfg.label}
    </span>
  );
}

export function StatusBadge({ status, className }) {
  const cfg = STATUS[status] || STATUS.read;
  return (
    <span className={cn('text-xs px-2 py-0.5 rounded-full border font-semibold', cfg.classes, className)}>
      {cfg.label}
    </span>
  );
}

export function SeverityDot({ severity }) {
  const colors = { critical: 'bg-status-danger', warning: 'bg-status-warning', info: 'bg-status-info' };
  return <span className={cn('inline-block h-2 w-2 rounded-full shrink-0', colors[severity] || colors.info)} />;
}