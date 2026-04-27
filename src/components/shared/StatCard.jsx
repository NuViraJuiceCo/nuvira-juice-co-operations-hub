export default function StatCard({ label, value, icon: Icon, iconColor = "text-primary" }) {
  return (
    <div className="bg-card border border-border rounded-lg p-3.5 flex items-center justify-between hover:shadow-sm transition-shadow">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="text-xl font-semibold text-foreground mt-0.5">{value}</p>
      </div>
      {Icon && (
        <div className={`h-9 w-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 ${iconColor}`}>
          <Icon className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}