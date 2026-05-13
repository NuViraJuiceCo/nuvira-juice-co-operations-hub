import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle, XCircle, Clock, ShieldAlert, TrendingUp } from "lucide-react";
import StatusBadge from "../components/shared/StatusBadge";
import moment from "moment";

export default function OrderReviewQueue() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("pending");
  const [selectedItem, setSelectedItem] = useState(null);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);

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
    if (filter === "active") {
      // Active = not archived/ignored
      return item.status !== 'archived' && item.status !== 'ignored';
    }
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

  const handleArchive = async (itemId, reason = 'admin_cleanup') => {
    await base44.entities.OrderReviewQueue.update(itemId, {
      status: 'archived',
      queue_visibility_status: 'archived',
      archived_at: new Date().toISOString(),
      archived_reason: reason,
    });
    setQueue(queue.map(q => q.id === itemId ? { ...q, status: 'archived', queue_visibility_status: 'archived' } : q));
    setSelectedItem(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const pending = queue.filter(q => q.status === "pending");
  const ALERT_THRESHOLD = 20;

  // Incident type breakdown of pending items
  const incidentBreakdown = pending.reduce((acc, item) => {
    const t = item.incident_type || 'unknown';
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl lg:text-3xl font-semibold text-foreground">Order Review Queue</h1>
        <p className="text-muted-foreground mt-1">Suspicious orders flagged for manual review</p>
      </div>

      {/* Summary Dashboard */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card border rounded-lg p-4 text-center">
          <p className={`text-3xl font-bold ${pending.length >= ALERT_THRESHOLD ? 'text-red-600' : pending.length > 0 ? 'text-amber-600' : 'text-primary'}`}>
            {pending.length}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Pending Review</p>
          {pending.length >= ALERT_THRESHOLD && (
            <p className="text-[10px] text-red-600 font-semibold mt-1 flex items-center justify-center gap-1">
              <ShieldAlert className="w-3 h-3" /> Above threshold
            </p>
          )}
        </div>
        <div className="bg-card border rounded-lg p-4 text-center">
          <p className="text-3xl font-bold text-green-600">{queue.filter(q => q.status === 'resolved').length}</p>
          <p className="text-xs text-muted-foreground mt-1">Resolved</p>
        </div>
        <div className="bg-card border rounded-lg p-4 text-center">
          <p className="text-3xl font-bold text-foreground">{queue.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Total All Time</p>
        </div>
        <div className="bg-card border rounded-lg p-4 text-center">
          <p className="text-3xl font-bold text-muted-foreground">{ALERT_THRESHOLD}</p>
          <p className="text-xs text-muted-foreground mt-1">Alert Threshold</p>
        </div>
      </div>

      {/* Incident Type Breakdown */}
      {pending.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-amber-700" />
            <p className="text-sm font-semibold text-amber-800">Pending Breakdown by Type</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(incidentBreakdown).map(([type, count]) => (
              <span key={type} className={`text-xs font-medium px-2.5 py-1 rounded-full border ${incidentColors[type] || 'bg-gray-50 border-gray-200 text-gray-700'}`}>
                {type.replace(/_/g, ' ')} · {count}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <Button
          variant={filter === "active" ? "default" : "outline"}
          onClick={() => setFilter("active")}
        >
          Active ({queue.filter(q => q.status !== 'archived' && q.status !== 'ignored').length})
        </Button>
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
          variant={filter === "archived" ? "default" : "outline"}
          onClick={() => setFilter("archived")}
        >
          Archived ({queue.filter(q => q.status === "archived").length})
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

              {selectedItem?.id === item.id && (
                <div className="mt-4 pt-4 border-t space-y-3">
                  <div className="text-sm">
                    <p className="font-semibold mb-2">Incoming Payload:</p>
                    <pre className="bg-black/5 p-2 rounded text-xs max-h-48 overflow-auto">
                      {JSON.stringify(item.incoming_payload, null, 2)}
                    </pre>
                  </div>
                  <div className="flex gap-2 justify-end flex-wrap">
                    {item.status === 'pending' && (
                      <>
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
                      </>
                    )}
                    {item.status !== 'archived' && item.status !== 'ignored' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleArchive(item.id, 'admin_cleanup')}
                      >
                        Archive (No-Op Cleanup)
                      </Button>
                    )}
                  </div>
                  {(item.status === 'archived' || item.status === 'ignored') && (
                    <div className="text-xs text-muted-foreground bg-muted/30 p-2 rounded">
                      <strong>Archived:</strong> {item.archived_reason} — Only queue visibility affected. No orders/subscriptions modified.
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}