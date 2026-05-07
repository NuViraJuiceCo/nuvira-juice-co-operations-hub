import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, XCircle, AlertCircle, Loader2 } from 'lucide-react';

export default function SubscriptionLiveVerificationPanel() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  const handleRunVerification = async () => {
    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const response = await base44.functions.invoke('finalSubscriptionLiveVerification', {});
      const data = response?.data || {};
      setResults(data);

      if (data.status !== 'LIVE_SUBSCRIPTION_CLEARANCE_APPROVED') {
        setError(data.blocker_message || 'Verification failed. See results below.');
      }
    } catch (err) {
      setError(err.message || 'Failed to run verification');
      console.error('Verification error:', err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status) => {
    if (status === 'PASS') return <CheckCircle2 className="w-5 h-5 text-green-600" />;
    if (status === 'FAIL') return <XCircle className="w-5 h-5 text-red-600" />;
    if (status === 'ERROR') return <AlertCircle className="w-5 h-5 text-amber-600" />;
    if (status === 'PENDING_RECALC') return <AlertCircle className="w-5 h-5 text-blue-600" />;
    return null;
  };

  const getStatusColor = (status) => {
    if (status === 'PASS') return 'bg-green-50 border-green-200';
    if (status === 'FAIL') return 'bg-red-50 border-red-200';
    if (status === 'ERROR') return 'bg-amber-50 border-amber-200';
    if (status === 'PENDING_RECALC') return 'bg-blue-50 border-blue-200';
    return 'bg-gray-50 border-gray-200';
  };

  const requirementLabels = {
    '1_handler_creates_order_and_task': 'Handler creates subscription ShopifyOrder & FulfillmentTask',
    '2_fulfillment_task_hub_visibility': 'FulfillmentTask visible in Hub',
    '3_driver_portal_eligibility': 'FulfillmentTask eligible for Driver Portal',
    '4_5_production_batch_subscription_source': 'ProductionBatch includes subscription_fulfillment source',
    '6_pending_exclusion': 'Pending/failed subscriptions excluded from operations',
    '7_idempotency': 'Replay creates no duplicates (idempotency)',
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Live Subscription Operational Verification</CardTitle>
          <CardDescription>
            Verify that handler-created subscription records are visible in all operational systems
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Button
              onClick={handleRunVerification}
              disabled={loading}
              className="w-full"
              size="lg"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Running Verification...
                </>
              ) : (
                'Run Final Live Verification'
              )}
            </Button>
          </div>

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex gap-2">
                <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-red-900">Verification Blocked</div>
                  <div className="text-red-700 text-sm mt-1">{error}</div>
                </div>
              </div>
            </div>
          )}

          {results && (
            <div className="space-y-4">
              {/* Final Verdict */}
              <div
                className={`p-4 border rounded-lg ${
                  results.final_clearance
                    ? 'bg-green-50 border-green-200'
                    : 'bg-red-50 border-red-200'
                }`}
              >
                <div className="flex gap-2 items-start">
                  {results.final_clearance ? (
                    <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  )}
                  <div>
                    <div
                      className={`font-bold text-lg ${
                        results.final_clearance ? 'text-green-900' : 'text-red-900'
                      }`}
                    >
                      {results.status === 'LIVE_SUBSCRIPTION_CLEARANCE_APPROVED'
                        ? '✓✓✓ LIVE SUBSCRIPTION CLEARANCE APPROVED'
                        : '✗✗✗ LIVE SUBSCRIPTION CLEARANCE BLOCKED'}
                    </div>
                    <div
                      className={`text-sm mt-1 ${
                        results.final_clearance ? 'text-green-700' : 'text-red-700'
                      }`}
                    >
                      {results.summary}
                    </div>
                  </div>
                </div>
              </div>

              {/* Test Subscription IDs */}
              {results.test_subscription_ids && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="font-semibold text-blue-900 mb-2">Test Subscription Records Created</div>
                  <div className="text-sm text-blue-700 space-y-1 font-mono">
                    <div><span className="font-semibold">Order ID:</span> {results.test_subscription_ids.operational_order_id}</div>
                    <div><span className="font-semibold">Task ID:</span> {results.test_subscription_ids.fulfillment_task_id}</div>
                    <div><span className="font-semibold">Subscription ID:</span> {results.test_subscription_ids.stripe_subscription_id}</div>
                    <div><span className="font-semibold">Customer Email:</span> {results.test_subscription_ids.customer_email}</div>
                    <div><span className="font-semibold">Delivery Date:</span> {results.test_subscription_ids.delivery_date}</div>
                    <div><span className="font-semibold">Production Date:</span> {results.test_subscription_ids.production_date}</div>
                  </div>
                </div>
              )}

              {/* Requirement Results */}
              <div className="space-y-2">
                <div className="font-semibold text-sm text-gray-700">Requirement Results</div>
                {Object.entries(results.requirement_verification || {}).map(([key, value]) => (
                  <div
                    key={key}
                    className={`p-3 border rounded-lg ${getStatusColor(value.status)}`}
                  >
                    <div className="flex gap-2 items-start">
                      {getStatusIcon(value.status)}
                      <div className="flex-1">
                        <div className="font-semibold text-sm">
                          {requirementLabels[key] || key}
                        </div>
                        {value.error && (
                          <div className="text-xs text-red-700 mt-1">{value.error}</div>
                        )}
                        {value.status === 'PASS' && (
                          <div className="text-xs text-gray-600 mt-1">
                            {key === '1_handler_creates_order_and_task' && (
                              <div>
                                Order: {value.operational_order_id?.slice(-8)} | Task: {value.fulfillment_task_id?.slice(-8)}
                              </div>
                            )}
                            {key === '2_fulfillment_task_hub_visibility' && (
                              <div>Task found with source_type=subscription_fulfillment</div>
                            )}
                            {key === '3_driver_portal_eligibility' && (
                              <div>Task meets all Driver Portal criteria (paid, active status)</div>
                            )}
                            {key === '4_5_production_batch_subscription_source' && (
                              <div>
                                {value.status === 'PENDING_RECALC' ? (
                                  <span>{value.note}</span>
                                ) : (
                                  <span>Batch: {value.batch_id?.slice(-8)} | Product: {value.batch_product_name} | Source: subscription_fulfillment</span>
                                )}
                              </div>
                            )}
                            {key === '6_pending_exclusion' && (
                              <div>Pending tasks correctly excluded from paid operations</div>
                            )}
                            {key === '7_idempotency' && (
                              <div>Task count stable: {value.task_count_before_replay} → {value.task_count_after_replay}</div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="text-xs font-semibold">
                        {value.status === 'PASS' && (
                          <span className="text-green-700">PASS</span>
                        )}
                        {value.status === 'FAIL' && (
                          <span className="text-red-700">FAIL</span>
                        )}
                        {value.status === 'ERROR' && (
                          <span className="text-amber-700">ERROR</span>
                        )}
                        {value.status === 'PENDING_RECALC' && (
                          <span className="text-blue-700">PENDING</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="pt-4 border-t flex gap-2">
                <Button variant="outline" onClick={handleRunVerification} disabled={loading}>
                  Run Again
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setResults(null);
                    setError(null);
                  }}
                >
                  Clear Results
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}