import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { X, AlertCircle, History } from 'lucide-react';
import moment from 'moment';

export default function BatchStartForm({ batch, onClose, onSave }) {
  const today = moment().format('YYYY-MM-DD');
  const isRetrospective = batch.production_date < today;

  const [formData, setFormData] = useState({
    staff_on_duty: batch.staff_on_duty || [],
    equipment_used: batch.equipment_used || [],
    pre_op_sanitation_confirmed: false,
    refrigerator_temp_checked: false,
    notes: '',
    retrospective_reason: '',
    actual_start_time_override: isRetrospective ? `${batch.production_date}T06:00` : '',
    ingredients_notes: batch.ingredient_lot_notes || '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [staffInput, setStaffInput] = useState('');
  const [equipmentInput, setEquipmentInput] = useState('');

  const handleAddStaff = () => {
    if (staffInput.trim()) {
      setFormData(prev => ({
        ...prev,
        staff_on_duty: [...prev.staff_on_duty, staffInput.trim()],
      }));
      setStaffInput('');
    }
  };

  const handleAddEquipment = () => {
    if (equipmentInput.trim()) {
      setFormData(prev => ({
        ...prev,
        equipment_used: [...prev.equipment_used, equipmentInput.trim()],
      }));
      setEquipmentInput('');
    }
  };

  const handleRemoveStaff = (idx) => {
    setFormData(prev => ({
      ...prev,
      staff_on_duty: prev.staff_on_duty.filter((_, i) => i !== idx),
    }));
  };

  const handleRemoveEquipment = (idx) => {
    setFormData(prev => ({
      ...prev,
      equipment_used: prev.equipment_used.filter((_, i) => i !== idx),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isRetrospective && !formData.retrospective_reason.trim()) {
      setError('A reason is required for retrospective batch logging.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await base44.functions.invoke('startBatchProduction', {
        batch_id: batch.batch_id,
        ...formData,
        ingredient_lot_notes: formData.ingredients_notes,
        actual_start_time_override: isRetrospective && formData.actual_start_time_override
          ? new Date(formData.actual_start_time_override).toISOString()
          : undefined,
      });
      onSave();
    } catch (err) {
      setError(err.message || 'Failed to start batch');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-card rounded-xl shadow-lg max-w-lg w-full p-6 my-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Start Batch Production</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isRetrospective && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 flex gap-2">
            <History className="h-4 w-4 flex-shrink-0 mt-0.5 text-amber-600" />
            <div>
              <p className="font-semibold">Retrospective Logging Mode</p>
              <p className="mt-0.5">This batch is for a past production date ({batch.production_date}). Logging will create compliance records only — it will <strong>not</strong> affect delivery status, Driver Portal, or customer notifications.</p>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Batch Details */}
          <div className="bg-muted/30 rounded-lg p-3 space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Batch Details</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Batch ID</p>
                <p className="text-sm font-medium">{batch.batch_id}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Juice / Product</p>
                <p className="text-sm font-medium">{batch.product_name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Category</p>
                <p className="text-sm font-medium capitalize">{batch.product_category || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Planned Quantity</p>
                <p className="text-sm font-medium">{batch.planned_units || '—'}</p>
              </div>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Ingredients / Formula Notes</label>
            <textarea
              value={formData.ingredients_notes}
              onChange={(e) => setFormData(prev => ({ ...prev, ingredients_notes: e.target.value }))}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background h-14 resize-none text-sm"
              placeholder="e.g. Cold-pressed apple, ginger, lemon — lot #A214"
            />
          </div>

          {isRetrospective && (
            <>
              <div>
                <label className="text-sm font-medium text-amber-700">Retrospective Reason <span className="text-red-500">*</span></label>
                <textarea
                  value={formData.retrospective_reason}
                  onChange={(e) => setFormData(prev => ({ ...prev, retrospective_reason: e.target.value }))}
                  className="mt-1 w-full p-2 border border-amber-300 rounded-lg bg-background h-14 resize-none text-sm"
                  placeholder="e.g. May 1 production was completed before batch logging workflow was active. Logging for compliance accuracy."
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium text-amber-700">Actual Start Time (Historical)</label>
                <input
                  type="datetime-local"
                  value={formData.actual_start_time_override}
                  onChange={(e) => setFormData(prev => ({ ...prev, actual_start_time_override: e.target.value }))}
                  className="mt-1 w-full p-2 border border-amber-300 rounded-lg bg-background text-sm"
                />
              </div>
            </>
          )}

          <div>
            <label className="text-sm font-medium">Staff on Duty</label>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={staffInput}
                onChange={(e) => setStaffInput(e.target.value)}
                placeholder="Add staff member"
                className="flex-1 p-2 border border-border rounded-lg bg-background text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddStaff();
                  }
                }}
              />
              <Button type="button" variant="outline" size="sm" onClick={handleAddStaff}>
                Add
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {formData.staff_on_duty.map((staff, idx) => (
                <div key={idx} className="bg-primary/10 px-3 py-1 rounded-full text-sm flex items-center gap-2">
                  {staff}
                  <button type="button" onClick={() => handleRemoveStaff(idx)} className="text-primary hover:text-primary/70">
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Equipment Used</label>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={equipmentInput}
                onChange={(e) => setEquipmentInput(e.target.value)}
                placeholder="Add equipment"
                className="flex-1 p-2 border border-border rounded-lg bg-background text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddEquipment();
                  }
                }}
              />
              <Button type="button" variant="outline" size="sm" onClick={handleAddEquipment}>
                Add
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {formData.equipment_used.map((eq, idx) => (
                <div key={idx} className="bg-secondary/20 px-3 py-1 rounded-full text-sm flex items-center gap-2">
                  {eq}
                  <button type="button" onClick={() => handleRemoveEquipment(idx)} className="text-secondary hover:text-secondary/70">
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={formData.pre_op_sanitation_confirmed}
                onChange={(e) => setFormData(prev => ({ ...prev, pre_op_sanitation_confirmed: e.target.checked }))}
                className="w-4 h-4"
              />
              Pre-op sanitation confirmed
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={formData.refrigerator_temp_checked}
                onChange={(e) => setFormData(prev => ({ ...prev, refrigerator_temp_checked: e.target.checked }))}
                className="w-4 h-4"
              />
              Refrigerator temp checked
            </label>
          </div>

          <div>
            <label className="text-sm font-medium">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background h-16 resize-none text-sm"
              placeholder="Production start notes..."
            />
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className={`flex-1 ${isRetrospective ? 'bg-amber-600 hover:bg-amber-700' : ''}`}>
              {loading ? 'Starting...' : isRetrospective ? '📦 Log Retrospective Batch' : 'Start Batch'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}