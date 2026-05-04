import { useNavigate } from 'react-router-dom';
import { getStatusClasses } from '@/lib/statusColors';
import {
  FileText, ShoppingCart, Factory, ClipboardCheck, Truck,
  CalendarDays, Heart, Layers, Settings, ArrowRight
} from 'lucide-react';

const TYPE_ICON = {
  Page: FileText,
  Order: ShoppingCart,
  Batch: Factory,
  ComplianceLog: ClipboardCheck,
  DeliveryTask: Truck,
  Event: CalendarDays,
  Loyalty: Heart,
  Product: Layers,
  System: Settings,
};

function highlight(text, query) {
  if (!text || !query) return <span>{text}</span>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, idx)}
      <mark className="bg-primary/20 text-primary rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </span>
  );
}

export default function SearchResultItem({ result, query, onClose }) {
  const navigate = useNavigate();
  const Icon = TYPE_ICON[result.type] || FileText;

  const handleClick = () => {
    if (result.route) navigate(result.route);
    onClose?.();
  };

  return (
    <button
      onClick={handleClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/60 active:bg-muted transition-colors text-left group"
    >
      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="h-4 w-4 text-primary" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">
          {highlight(result.title, query)}
        </p>
        {result.subtitle && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {highlight(result.subtitle, query)}
          </p>
        )}
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {result.status && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold border ${getStatusClasses(result.status)}`}>
              {result.status.replace(/_/g, ' ')}
            </span>
          )}
          {result.meta && (
            <span className="text-[10px] text-muted-foreground/70">{result.meta}</span>
          )}
        </div>
      </div>

      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 transition-colors" />
    </button>
  );
}