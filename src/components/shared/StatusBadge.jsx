const statusStyles = {
  "New": "bg-blue-50 text-blue-700 border-blue-200",
  "Confirmed": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Scheduled for Production": "bg-cyan-50 text-cyan-700 border-cyan-200",
  "In Production": "bg-orange-50 text-orange-700 border-orange-200",
  "Completed": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Cancelled": "bg-red-50 text-red-700 border-red-200",
  "Planned": "bg-blue-50 text-blue-700 border-blue-200",
  "Awaiting Ingredients": "bg-amber-50 text-amber-700 border-amber-200",
  "In Packing": "bg-cyan-50 text-cyan-700 border-cyan-200",
  "Paid": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Pending": "bg-amber-50 text-amber-700 border-amber-200",
  "Refunded": "bg-red-50 text-red-700 border-red-200",
  "Unassigned": "bg-gray-50 text-gray-700 border-gray-200",
  "Scheduled": "bg-blue-50 text-blue-700 border-blue-200",
  "Packed": "bg-cyan-50 text-cyan-700 border-cyan-200",
  "In Transit": "bg-purple-50 text-purple-700 border-purple-200",
};

export default function StatusBadge({ status }) {
  const style = statusStyles[status] || "bg-gray-50 text-gray-700 border-gray-200";

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${style}`}>
      {status}
    </span>
  );
}