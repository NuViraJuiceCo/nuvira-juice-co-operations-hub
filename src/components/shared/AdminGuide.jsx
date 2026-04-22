import { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { BookOpen, ChevronDown, ChevronUp, X } from "lucide-react";

export default function AdminGuide({ title, steps, tips }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (user?.role !== "admin" || dismissed) return null;

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl overflow-hidden mb-4">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 flex-1 text-left"
        >
          <BookOpen className="w-4 h-4 text-blue-600 shrink-0" />
          <span className="text-sm font-semibold text-blue-800">{title}</span>
          {open ? (
            <ChevronUp className="w-4 h-4 text-blue-500 ml-1" />
          ) : (
            <ChevronDown className="w-4 h-4 text-blue-500 ml-1" />
          )}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="text-blue-400 hover:text-blue-600 ml-2"
          title="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-blue-200 pt-3">
          {steps && steps.length > 0 && (
            <ol className="space-y-1.5">
              {steps.map((step, i) => (
                <li key={i} className="flex gap-2 text-sm text-blue-800">
                  <span className="font-bold text-blue-500 shrink-0">{i + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          )}
          {tips && tips.length > 0 && (
            <div className="bg-blue-100 rounded-lg px-3 py-2">
              <p className="text-xs font-semibold text-blue-700 mb-1">💡 Tips</p>
              <ul className="space-y-1">
                {tips.map((tip, i) => (
                  <li key={i} className="text-xs text-blue-700">• {tip}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}