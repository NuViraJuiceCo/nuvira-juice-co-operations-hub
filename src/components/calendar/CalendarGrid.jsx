import moment from "moment";

const typeStyles = {
  production: "bg-status-info-bg text-status-info border-l-2 border-status-info-border",
  delivery:   "bg-status-success-bg text-status-success border-l-2 border-status-success-border",
  event:      "bg-status-admin-bg text-status-admin border-l-2 border-status-admin-border",
  compliance: "bg-status-warning-bg text-status-warning border-l-2 border-status-warning-border",
  followup:   "bg-status-danger-bg text-status-danger border-l-2 border-status-danger-border",
};

const typeIcons = {
  production: "🧃",
  delivery: "🚚",
  event: "🏢",
  compliance: "📋",
  followup: "📧",
};

export default function CalendarGrid({ currentMonth, events }) {
  const startOfMonth = moment(currentMonth).startOf("month");
  const endOfMonth = moment(currentMonth).endOf("month");
  const startDay = startOfMonth.day();
  const daysInMonth = endOfMonth.date();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const days = [];
  for (let i = 0; i < startDay; i++) {
    days.push(null);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(d);
  }

  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  // Pad the last week
  while (weeks[weeks.length - 1]?.length < 7) {
    weeks[weeks.length - 1].push(null);
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-7 border-b border-border">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div key={day} className="px-2 py-2.5 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider bg-muted/30">
            {day}
          </div>
        ))}
      </div>

      {/* Body */}
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 border-b border-border last:border-0">
          {week.map((day, di) => {
            if (!day) {
              return <div key={di} className="min-h-[100px] bg-muted/10" />;
            }

            const year = currentMonth.year();
            const month = currentMonth.month() + 1;
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isToday = dateStr === today;
            const dayEvents = events.filter((e) => e.date === dateStr);

            return (
              <div
                key={di}
                className={`min-h-[100px] p-1.5 border-r border-border last:border-0 ${
                  isToday ? "bg-primary/5" : ""
                }`}
              >
                <span
                  className={`text-xs font-medium inline-flex items-center justify-center h-6 w-6 rounded-full ${
                    isToday
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground"
                  }`}
                >
                  {day}
                </span>
                <div className="space-y-1 mt-1">
                  {dayEvents.slice(0, 3).map((event, ei) => (
                    <div
                      key={ei}
                      className={`text-[10px] leading-tight px-1.5 py-1 rounded ${
                        typeStyles[event.type] || "bg-gray-100 text-gray-700"
                      } truncate`}
                    >
                      {typeIcons[event.type]} {event.label}
                    </div>
                  ))}
                  {dayEvents.length > 3 && (
                    <p className="text-[10px] text-muted-foreground px-1.5">
                      +{dayEvents.length - 3} more
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}