import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle, XCircle, Clock } from "lucide-react";
import StatusBadge from "../components/shared/StatusBadge";
import moment from "moment";

export default function OrderReviewQueue() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("pending");
  const [selectedItem, setSelectedItem] = useState(null);

  useEffect(() => {
    async function load() {
      const allItems = await base44.entities.OrderReviewQueue.list("-created_date", 500);
      setQueue(allItems);
      setLoading(false);
    }
    load();
  }, []);

  const incidentColors = {
    unknown_order_attempt: "bg-orange-50 border-orange-200 text-orange-700",
    incomplete_payload: "bg-yellow-50 border-yellow-200 text-yellow-700",
    subscription_downgrade_attempt: "bg-red-50 border-red-200 text-red-700",
    duplicate_event: "bg-blue-50 border-blue-200 text-blue-700",
    stale_update: "bg-purple-50 border-purple-200 text-purple-700",
    missing_subscription_metadata: "bg-red-50 border-red-200 text-red-700",
    recovery_needs_review: "bg-orange-50 border-orange-200 text-orange-700",
    zero_total_with_items: "bg-red-50 border-red-200 text-red-700",
    missing_customer_info: "bg-yellow-50 border-yellow-200 text-yellow-700",
    overwrite_rejection: "bg-red-50 border-red-200 text-red-700",
    source_conflict: "bg-orange-50 border-orange-200 text-orange-700",
  };

  const filtered = queue.filter(item => {
    if (filter === "all") return true;
    return item.status === filter;
  });

  const handleResolve = async (itemId, action) => {
    await base44.entities.OrderReviewQueue.update(itemId, {
      status: 'resolved',
      resolved_action: action,
      resolved_at: new Date().toISOString(),
    });
    setQueue(queue.map(q => q.id === itemId ? { ...q, status: 'resolved', resolved_action: action } : q));
    setSelectedItem(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Order Review Queue</h1>
        <p className="text-muted-foreground mt-1">Suspicious orders flagged for manual review</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Button
          variant={filter === "pending" ? "default" : "outline"}
          onClick={() => setFilter("pending")}
        >
          Pending ({queue.filter(q => q.status === "pending").length})
        </Button>
        <Button
          variant={filter === "resolved" ? "default" : "outline"}
          onClick={() => setFilter("resolved")}
        >
          Resolved ({queue.filter(q => q.status === "resolved").length})
        </Button>
        <Button
          variant={filter === "all" ? "default" : "outline"}
          onClick={() => setFilter("all")}
        >
          All ({queue.length})
        </Button>
      </div>

      <div className="grid gap-4">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            No items in {filter} status
          </div>
        ) : (
          filtered.map((item) => (
            <div
              key={item.id}
              className={`border rounded-lg p-4 cursor-pointer transition-all ${incidentColors[item.incident_type] || 'bg-gray-50'}`}
              onClick={() => setSelectedItem(selectedItem?.id === item.id ? null : item)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {item.incident_type === 'subscription_downgrade_attempt' && (
                      <AlertCircle className="w-4 h-4" />
                    )}
                    {item.incident_type === 'overwrite_rejection' && (
                      <XCircle className="w-4 h-4" />
                    )}
                    {item.status === 'resolved' && (
                      <CheckCircle className="w-4 h-4" />
                    )}
                    {item.status === 'pending' && (
                      <Clock className="w-4 h-4" />
                    )}
                    <span className="font-semibold">{item.incident_type.replace(/_/g, ' ')}</span>
                    <StatusBadge status={item.status} />
                  </div>
                  <p className="text-sm mb-2">{item.issue_description}</p>
                  <div className="text-xs space-y-1">
                    <p><strong>Customer:</strong> {item.customer_email} ({item.customer_name || 'N/A'})</p>
                    {item.existing_order_number && (
                      <p><strong>Existing Order:</strong> {item.existing_order_number} (type: {item.existing_order_type})</p>
                    )}
                    <p><strong>Source:</strong> {item.incoming_source}</p>
                    <p><strong>Recommended:</strong> {item.recommended_action}</p>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground whitespace-nowrap ml-4">
                  {moment(item.created_date).format("MMM D, h:mm A")}
                </div>
              </div>

              {selectedItem?.id === item.id && item.status === 'pending' && (
                <div className="mt-4 pt-4 border-t space-y-3">
                  <div className="text-sm">
                    <p className="font-semibold mb-2">Incoming Payload:</p>
                    <pre className="bg-black/5 p-2 rounded text-xs max-h-48 overflow-auto">
                      {JSON.stringify(item.incoming_payload, null, 2)}
                    </pre>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleResolve(item.id, 'manually_reviewed_and_rejected')}
                    >
                      Reject
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleResolve(item.id, 'approved_for_merge')}
                    >
                      Approve & Merge
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleResolve(item.id, 'escalated_to_admin')}
                    >
                      Escalate
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}