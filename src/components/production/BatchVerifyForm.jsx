import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { X, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function BatchVerifyForm({ batch, onClose, onSave }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Validate required fields for verification
  const requiredFields = {
    'Production Date': batch.production_date,
    'Batch ID': batch.batch_id,
    'Product': batch.product_name,
    'Quantity Produced': batch.actual_quantity_produced,
    'Start Time': batch.actual_start_time,
    'End Time': batch.actual_end_time,
    'Staff on Duty': batch.staff_on_duty?.length > 0,
    'pH Result': batch.pH_result !== null && batch.pH_result !== undefined,
    'Pass/Failed': batch.passed_failed,
  };

  const missingFields = Object.entries(requiredFields)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  const canVerify = missingFields.length === 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canVerify) return;

    setError(null);
    setLoading(true);
    try {
      await base44.functions.invoke('verifyAndLogBatch', {
        batch_id: batch.batch_id,
      });
      onSave();
    } catch (err) {
      setError(err.message || 'Failed to verify batch');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-card rounded-xl shadow-lg max-w-lg w-full p-6 my-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Verify & Create Compliance Log</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Batch Info */}
          <div className="bg-muted/50 p-4 rounded-lg space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Batch ID:</span>
              <span className="font-medium">{batch.batch_id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Product:</span>
              <span className="font-medium">{batch.product_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Quantity Produced:</span>
              <span className="font-medium">{batch.actual_quantity_produced}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">pH Result:</span>
              <span className="font-medium">{batch.pH_result}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status:</span>
              <span className={`font-medium ${batch.passed_failed === 'passed' ? 'text-green-600' : 'text-red-600'}`}>
                {batch.passed_failed?.toUpperCase()}
              </span>
            </div>
          </div>

          {/* Validation Status */}
          <div className="space-y-2">
            <h3 className="font-semibold text-sm">Required Fields Check</h3>
            {Object.entries(requiredFields).map(([field, present]) => (
              <div key={field} className="flex items-center gap-2 text-sm">
                {present ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-red-600" />
                )}
                <span className={present ? 'text-muted-foreground' : 'text-red-600'}>
                  {field} {present ? '✓' : '(missing)'}
                </span>
              </div>
            ))}
          </div>

          {missingFields.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700">
                <strong>Cannot verify:</strong> Missing required data: {missingFields.join(', ')}
              </p>
              <p className="text-xs text-red-600 mt-1">Please complete the batch form before verification.</p>
            </div>
          )}

          {/* What happens on verify */}
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700 space-y-1">
            <p className="font-semibold">On verification:</p>
            <ul className="list-disc pl-5 text-xs space-y-1">
              <li>BatchComplianceLog will be created with all batch data</li>
              <li>Batch status will change to verified_logged</li>
              <li>Batch will be locked from editing</li>
              <li>Audit trail will be recorded</li>
              {batch.ccp_check_complete && <li>CCPMonitoringLog will be created</li>}
              {batch.corrective_action_required && <li>CorrectiveActionLog will be created</li>}
              {batch.sanitation_verification_complete && <li>SanitationVerificationLog will be linked</li>}
            </ul>
          </div>

          <div className="flex gap-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !canVerify}
              className="flex-1"
              title={!canVerify ? 'Complete required fields first' : ''}
            >
              {loading ? 'Verifying...' : 'Verify & Log'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}