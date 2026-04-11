export default function StatCard({ label, value, icon: Icon, iconColor = "text-primary" }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex items-center justify-between hover:shadow-sm transition-shadow">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="text-2xl font-semibold text-foreground mt-1">{value}</p>
      </div>
      {Icon && (
        <div className={`h-10 w-10 rounded-lg bg-muted flex items-center justify-center ${iconColor}`}>
          <Icon className="h-5 w-5" />
        </div>
      )}
    </div>
  );
}