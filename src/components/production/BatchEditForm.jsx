import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

export default function BatchEditForm({ batch, onClose, onSave }) {
  const [formData, setFormData] = useState({
    status: batch.status || 'Planned',
    actual_units: batch.actual_units || '',
    assigned_to: batch.assigned_to || '',
    notes: batch.notes || '',
  });
  const [loading, setLoading] = useState(false);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await base44.entities.ProductionBatch.update(batch.id, formData);
      onSave();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl shadow-lg max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Edit Batch</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground">Batch ID</label>
            <p className="text-sm text-muted-foreground mt-1">{batch.batch_id}</p>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Status</label>
            <select
              value={formData.status}
              onChange={(e) => handleChange('status', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
            >
              <option>Planned</option>
              <option>Awaiting Ingredients</option>
              <option>In Production</option>
              <option>In Packing</option>
              <option>Completed</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Planned Units</label>
            <p className="text-sm text-muted-foreground mt-1">{batch.planned_units}</p>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Actual Units Produced</label>
            <input
              type="number"
              value={formData.actual_units}
              onChange={(e) => handleChange('actual_units', e.target.value ? parseInt(e.target.value) : '')}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              placeholder="Leave blank if not yet completed"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Assigned To</label>
            <input
              type="text"
              value={formData.assigned_to}
              onChange={(e) => handleChange('assigned_to', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              placeholder="Staff member name"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background h-20 resize-none"
              placeholder="Production notes..."
            />
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}