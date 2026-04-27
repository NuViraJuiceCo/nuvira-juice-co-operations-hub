import moment from "moment";

const typeStyles = {
  production: "bg-amber-100 text-amber-800 border-l-2 border-amber-400",
  delivery: "bg-cyan-100 text-cyan-800 border-l-2 border-cyan-400",
  event: "bg-purple-100 text-purple-800 border-l-2 border-purple-400",
  followup: "bg-rose-100 text-rose-800 border-l-2 border-rose-400",
};

const typeIcons = {
  production: "🧃",
  delivery: "🚚",
  event: "🏢",
  followup: "📧",
};

export default function CalendarGrid({ currentMonth, events }) {
  const startOfMonth = moment(currentMonth).startOf("month");
  const endOfMonth = moment(currentMonth).endOf("month");
  const startDay = startOfMonth.day();
  const daysInMonth = endOfMonth.date();
  const today = moment().format("YYYY-MM-DD");

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

            const dateStr = moment(currentMonth)
              .clone()
              .date(day)
              .format("YYYY-MM-DD");
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