/**
 * StatCard — NuVira Hub
 * Semantic variant system: default | success | info | warning | danger | admin
 */
const VARIANT_STYLES = {
  default: {
    icon: 'bg-primary/10 text-primary',
    accent: 'border-l-primary/40',
    value: 'text-foreground',
  },
  success: {
    icon: 'bg-status-success-bg text-status-success',
    accent: 'border-l-status-success',
    value: 'text-status-success',
  },
  info: {
    icon: 'bg-status-info-bg text-status-info',
    accent: 'border-l-status-info',
    value: 'text-status-info',
  },
  warning: {
    icon: 'bg-status-warning-bg text-status-warning',
    accent: 'border-l-status-warning',
    value: 'text-status-warning',
  },
  danger: {
    icon: 'bg-status-danger-bg text-status-danger',
    accent: 'border-l-status-danger',
    value: 'text-status-danger',
  },
  admin: {
    icon: 'bg-status-admin-bg text-status-admin',
    accent: 'border-l-status-admin',
    value: 'text-status-admin',
  },
};

export default function StatCard({ label, value, icon: Icon, variant = 'default', subtitle }) {
  const styles = VARIANT_STYLES[variant] || VARIANT_STYLES.default;

  return (
    <div className={`bg-card border border-border border-l-4 ${styles.accent} rounded-xl p-4 flex items-start justify-between hover:shadow-md transition-all duration-150 gap-3`}>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground leading-none mb-1.5">
          {label}
        </p>
        <p className={`text-2xl font-bold ${styles.value} leading-none`}>{value}</p>
        {subtitle && <p className="text-[10px] text-muted-foreground mt-1.5 leading-tight">{subtitle}</p>}
      </div>
      {Icon && (
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 ${styles.icon}`}>
          <Icon className="h-5 w-5" />
        </div>
      )}
    </div>
  );
}