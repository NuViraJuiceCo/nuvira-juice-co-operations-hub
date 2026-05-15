import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
} 

export const isIframe = window.self !== window.top;

// Helper to identify POS/Event orders
export function isPOSOrder(order) {
  if (!order) return false;
  const sourceType = order.source_type?.toLowerCase();
  const orderType = order.order_type?.toLowerCase();
  const tags = Array.isArray(order.tags) ? order.tags.map(t => t?.toLowerCase()) : [];
  
  return (
    sourceType === 'shopify_pos' ||
    orderType === 'pos' ||
    order.fulfillment_method === 'pos' ||
    tags.includes('shopify_pos') ||
    tags.includes('pos_order')
  );
}