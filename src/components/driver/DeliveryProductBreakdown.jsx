import { Package, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

export default function DeliveryProductBreakdown({ order, date }) {
  const [expanded, setExpanded] = useState(false);

  const NON_PRODUCT_KEYWORDS = ['delivery fee','delivery charge','shipping fee','shipping charge','tip','service fee'];
  const items = (order.deliveryItems || []).filter(item => !NON_PRODUCT_KEYWORDS.some(kw => (item.title||'').toLowerCase().includes(kw)));
  const totalBottles = items.reduce((sum, item) => sum + (item.quantity || 0), 0);

  if (!items || items.length === 0) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2.5 flex items-center gap-2">
        <Package className="w-4 h-4 text-yellow-600 shrink-0" />
        <p className="text-xs text-yellow-700">No items scheduled for this delivery</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5 text-left hover:bg-blue-100 transition-colors"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Package className="w-4 h-4 text-blue-600 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-blue-900">
              {totalBottles} Bottle{totalBottles !== 1 ? 's' : ''} in This Delivery
            </p>
            <p className="text-[10px] text-blue-600 mt-0.5">
              {items.length} product{items.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-blue-600 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-blue-600 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="bg-white border border-blue-100 rounded-lg p-3 space-y-2">
          {items.map((item, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between text-sm border-b border-blue-50 pb-2 last:border-b-0 last:pb-0"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground truncate">{item.title}</p>
                {item.price && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    ${item.price.toFixed(2)} each
                  </p>
                )}
              </div>
              <div className="text-right ml-3 shrink-0">
                <p className="font-bold text-primary text-lg">×{item.quantity}</p>
              </div>
            </div>
          ))}

          <div className="bg-blue-50 rounded px-2.5 py-2 mt-3 flex items-center justify-between border border-blue-100">
            <p className="text-xs font-semibold text-blue-900">Total for this delivery:</p>
            <p className="text-sm font-bold text-blue-700">{totalBottles} bottle{totalBottles !== 1 ? 's' : ''}</p>
          </div>

          {order.isSubscriptionDelivery && order.selectedFulfillment && (
            <div className="text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1.5 italic">
              Week {order.selectedFulfillment.fulfillment_number} of {order.selectedFulfillment.fulfillment_total || '?'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}