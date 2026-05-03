import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { X, AlertCircle } from 'lucide-react';
import moment from 'moment';

export default function BatchCompleteForm({ batch, onClose, onSave }) {
  const [staffInput, setStaffInput] = useState('');

  const [formData, setFormData] = useState({
    actual_quantity_produced: batch.planned_units || '',
    staff_on_duty: batch.staff_on_duty || [],
    actual_end_time: '',
    bottles_produced: '',
    bottles_rejected_or_wasted: '',
    final_usable_quantity: '',
    storage_location: '',
    use_by_date: '',
    pH_result: '',
    pH_passed_failed: 'passed',
    pH_meter_id: '',
    calibration_checked: false,
    ccp_check_complete: false,
    sanitation_verification_complete: false,
    labels_applied: false,
    passed_failed: 'passed',
    corrective_action_required: false,
    issue_identified: '',
    detection_method: '',
    product_involved: '',
    action_taken: '',
    disposed: false,
    quantity_disposed: '',
    preventive_steps: '',
    notes: '',
  });

  const handleAddStaff = () => {
    if (staffInput.trim()) {
      setFormData(prev => ({ ...prev, staff_on_duty: [...prev.staff_on_duty, staffInput.trim()] }));
      setStaffInput('');
    }
  };
  const handleRemoveStaff = (idx) => {
    setFormData(prev => ({ ...prev, staff_on_duty: prev.staff_on_duty.filter((_, i) => i !== idx) }));
  };
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.actual_end_time) {
      setError('End Time is required.');
      return;
    }
    if (formData.staff_on_duty.length === 0) {
      setError('At least one staff member on duty is required.');
      return;
    }
    if (formData.pH_result === '' || formData.pH_result === null) {
      setError('pH Result is required.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await base44.functions.invoke('completeBatchProduction', {
        batch_id: batch.batch_id,
        ...formData,
        actual_end_time: formData.actual_end_time ? new Date(formData.actual_end_time).toISOString() : undefined,
      });
      onSave();
    } catch (err) {
      setError(err.message || 'Failed to complete batch');
      setLoading(false);
    }
  };

  const showCorrectiveActionFields = formData.corrective_action_required;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-card rounded-xl shadow-lg max-w-2xl w-full p-6 my-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Complete Batch Production</h2>
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

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Batch Info */}
          <div className="bg-muted/30 rounded-lg p-3 grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Batch ID</p>
              <p className="text-sm font-medium">{batch.batch_id}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Juice / Product</p>
              <p className="text-sm font-medium">{batch.product_name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Start Time</p>
              <p className="text-sm font-medium">{batch.actual_start_time ? moment(batch.actual_start_time).format('MMM D, HH:mm') : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Planned Qty</p>
              <p className="text-sm font-medium">{batch.planned_units || '—'}</p>
            </div>
          </div>

          {/* Quantity & Output */}
          <div className="border-t pt-4 space-y-4">
            <h3 className="font-semibold text-sm">Production Output</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">End Time *</label>
                <input
                  type="datetime-local"
                  value={formData.actual_end_time}
                  onChange={(e) => handleChange('actual_end_time', e.target.value)}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium">Actual Quantity Produced *</label>
                <input
                  type="number"
                  value={formData.actual_quantity_produced}
                  onChange={(e) => handleChange('actual_quantity_produced', parseInt(e.target.value) || '')}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                  placeholder="Units"
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium">Bottles Produced</label>
                <input
                  type="number"
                  value={formData.bottles_produced}
                  onChange={(e) => handleChange('bottles_produced', parseInt(e.target.value) || '')}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                  placeholder="Count"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Bottles Rejected/Wasted</label>
                <input
                  type="number"
                  value={formData.bottles_rejected_or_wasted}
                  onChange={(e) => handleChange('bottles_rejected_or_wasted', parseInt(e.target.value) || '')}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Final Usable Quantity</label>
                <input
                  type="number"
                  value={formData.final_usable_quantity}
                  onChange={(e) => handleChange('final_usable_quantity', parseInt(e.target.value) || '')}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Storage Location</label>
                <input
                  type="text"
                  value={formData.storage_location}
                  onChange={(e) => handleChange('storage_location', e.target.value)}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                  placeholder="e.g., Cold Room A"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Use By Date</label>
                <input
                  type="date"
                  value={formData.use_by_date}
                  onChange={(e) => handleChange('use_by_date', e.target.value)}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                />
              </div>
            </div>
          </div>

          {/* Staff on Duty */}
          <div className="border-t pt-4 space-y-3">
            <h3 className="font-semibold text-sm">Staff on Duty *</h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={staffInput}
                onChange={(e) => setStaffInput(e.target.value)}
                placeholder="Add staff member"
                className="flex-1 p-2 border border-border rounded-lg bg-background text-sm"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddStaff(); } }}
              />
              <Button type="button" variant="outline" size="sm" onClick={handleAddStaff}>Add</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {formData.staff_on_duty.map((s, i) => (
                <div key={i} className="bg-primary/10 px-3 py-1 rounded-full text-sm flex items-center gap-2">
                  {s}
                  <button type="button" onClick={() => handleRemoveStaff(i)} className="text-primary hover:text-primary/70">×</button>
                </div>
              ))}
            </div>
          </div>

          {/* Compliance */}
          <div className="border-t pt-4 space-y-4">
            <h3 className="font-semibold text-sm">Quality Check</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">pH Result *</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="14"
                  value={formData.pH_result}
                  onChange={(e) => handleChange('pH_result', parseFloat(e.target.value) || '')}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                  placeholder="0.0 – 14.0"
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium">pH Pass/Fail *</label>
                <select
                  value={formData.pH_passed_failed}
                  onChange={(e) => handleChange('pH_passed_failed', e.target.value)}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                  required
                >
                  <option value="passed">Passed</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">pH Meter ID</label>
                <input
                  type="text"
                  value={formData.pH_meter_id}
                  onChange={(e) => handleChange('pH_meter_id', e.target.value)}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                  placeholder="Meter ID"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Batch Passed / Failed *</label>
                <select
                  value={formData.passed_failed}
                  onChange={(e) => handleChange('passed_failed', e.target.value)}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                  required
                >
                  <option value="passed">Passed</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={formData.calibration_checked}
                  onChange={(e) => handleChange('calibration_checked', e.target.checked)}
                  className="w-4 h-4"
                />
                Calibration checked
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={formData.ccp_check_complete}
                  onChange={(e) => handleChange('ccp_check_complete', e.target.checked)}
                  className="w-4 h-4"
                />
                CCP check complete
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={formData.sanitation_verification_complete}
                  onChange={(e) => handleChange('sanitation_verification_complete', e.target.checked)}
                  className="w-4 h-4"
                />
                Sanitation verification complete
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={formData.labels_applied}
                  onChange={(e) => handleChange('labels_applied', e.target.checked)}
                  className="w-4 h-4"
                />
                Labels applied
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={formData.corrective_action_required}
                  onChange={(e) => handleChange('corrective_action_required', e.target.checked)}
                  className="w-4 h-4"
                />
                Corrective action required
              </label>
            </div>
          </div>

          {/* Corrective Action */}
          {showCorrectiveActionFields && (
            <div className="border-t border-red-200 bg-red-50/50 pt-4 p-4 rounded-lg space-y-4">
              <h3 className="font-semibold text-sm text-red-700">Corrective Action Details *</h3>
              <div>
                <label className="text-sm font-medium">Issue Identified *</label>
                <textarea
                  value={formData.issue_identified}
                  onChange={(e) => handleChange('issue_identified', e.target.value)}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm h-16 resize-none"
                  placeholder="Description of issue"
                  required={showCorrectiveActionFields}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Action Taken *</label>
                <textarea
                  value={formData.action_taken}
                  onChange={(e) => handleChange('action_taken', e.target.value)}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm h-16 resize-none"
                  placeholder="What was done to correct it"
                  required={showCorrectiveActionFields}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Detection Method</label>
                  <input
                    type="text"
                    value={formData.detection_method}
                    onChange={(e) => handleChange('detection_method', e.target.value)}
                    className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Product Involved</label>
                  <input
                    type="text"
                    value={formData.product_involved}
                    onChange={(e) => handleChange('product_involved', e.target.value)}
                    className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={formData.disposed}
                    onChange={(e) => handleChange('disposed', e.target.checked)}
                    className="w-4 h-4"
                  />
                  Product disposed
                </label>
                {formData.disposed && (
                  <input
                    type="number"
                    value={formData.quantity_disposed}
                    onChange={(e) => handleChange('quantity_disposed', parseInt(e.target.value) || '')}
                    className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                    placeholder="Quantity disposed"
                  />
                )}
              </div>
              <div>
                <label className="text-sm font-medium">Preventive Steps</label>
                <textarea
                  value={formData.preventive_steps}
                  onChange={(e) => handleChange('preventive_steps', e.target.value)}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm h-12 resize-none"
                  placeholder="How will this be prevented in the future?"
                />
              </div>
            </div>
          )}

          <div>
            <label className="text-sm font-medium">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm h-16 resize-none"
              placeholder="Additional production notes..."
            />
          </div>

          <div className="flex gap-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? 'Completing...' : 'Mark Completed'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}