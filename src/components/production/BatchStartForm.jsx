import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { X, AlertCircle } from 'lucide-react';

export default function BatchStartForm({ batch, onClose, onSave }) {
  const [formData, setFormData] = useState({
    staff_on_duty: [],
    equipment_used: [],
    pre_op_sanitation_confirmed: false,
    refrigerator_temp_checked: false,
    notes: '',
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
    setError(null);
    setLoading(true);
    try {
      await base44.functions.invoke('startBatchProduction', {
        batch_id: batch.batch_id,
        ...formData,
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

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Batch ID</label>
            <p className="text-sm text-muted-foreground mt-1">{batch.batch_id}</p>
          </div>

          <div>
            <label className="text-sm font-medium">Product</label>
            <p className="text-sm text-muted-foreground mt-1">{batch.product_name}</p>
          </div>

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
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? 'Starting...' : 'Start Batch'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}