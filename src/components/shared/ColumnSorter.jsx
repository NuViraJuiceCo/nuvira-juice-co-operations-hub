import { ChevronUp, ChevronDown } from "lucide-react";

export default function ColumnSorter({ column, sortBy, sortDir, onSort }) {
  const isActive = sortBy === column;
  const icon = isActive && sortDir === "asc" ? ChevronUp : ChevronDown;
  const Icon = icon;

  return (
    <button
      onClick={() => onSort(column)}
      className="flex items-center gap-1 hover:text-primary transition-colors"
      title={`Sort by ${column}`}
    >
      {column}
      {isActive && <Icon className="h-4 w-4" />}
    </button>
  );
}