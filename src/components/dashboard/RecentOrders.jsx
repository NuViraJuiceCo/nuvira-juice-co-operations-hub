import { Link } from "react-router-dom";
import StatusBadge from "../shared/StatusBadge";

export default function RecentOrders({ orders }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between border-b border-border">
        <h3 className="font-semibold text-foreground">Recent Orders</h3>
        <Link to="/orders" className="text-sm text-primary hover:text-primary/80 font-medium transition-colors">
          View all →
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Order</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Customer</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Channel</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Total</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-5 py-3.5">
                  <span className="text-sm font-medium text-primary">{order.shopify_order_number}</span>
                </td>
                <td className="px-5 py-3.5 text-sm text-foreground">{order.customer_email}</td>
                <td className="px-5 py-3.5 text-sm text-muted-foreground">{order.source_channel}</td>
                <td className="px-5 py-3.5"><StatusBadge status={order.production_status} /></td>
                <td className="px-5 py-3.5 text-sm font-medium text-foreground text-right">
                  ${order.total_price?.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}