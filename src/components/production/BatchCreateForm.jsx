import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import moment from 'moment';

export default function BatchCreateForm({ onClose, onSave }) {
  const [formData, setFormData] = useState({
    batch_id: '',
    product_name: '',
    status: 'Planned',
    planned_units: '',
    production_date: moment().format('YYYY-MM-DD'),
    assigned_to: '',
    notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [recipes, setRecipes] = useState([]);
  const [bundles, setBundles] = useState([]);

  useEffect(() => {
    // Set default production date based on schedule (after May 1st, use Tue/Fri/Sat)
    const today = moment();
    let defaultDate = '2026-05-01'; // Before May 1st, use May 1st
    
    if (today.isAfter(moment('2026-05-01'))) {
      const productionDays = [2, 5, 6]; // Tuesday (2), Friday (5), Saturday (6)
      let checkDate = today.clone();
      while (!productionDays.includes(checkDate.day())) {
        checkDate.add(1, 'day');
      }
      defaultDate = checkDate.format('YYYY-MM-DD');
    }
    
    setFormData(prev => ({ ...prev, production_date: defaultDate }));
    
    Promise.all([
      base44.entities.Recipe.list('-updated_date', 100),
      base44.entities.Bundle.list('-updated_date', 100),
    ]).then(([recipeData, bundleData]) => {
      setRecipes(recipeData.filter(r => r.is_active !== false));
      setBundles(bundleData.filter(b => b.is_active !== false));
    });
  }, []);

  const handleChange = (field, value) => {
   setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
   e.preventDefault();
   setError(null);

   if (!formData.product_name || !formData.planned_units || !formData.production_date) {
     setError('Please fill in all required fields');
     return;
   }

   if (isNaN(parseInt(formData.planned_units)) || parseInt(formData.planned_units) <= 0) {
     setError('Planned units must be a positive number');
     return;
   }

   setLoading(true);
   try {
     const { planned_units, ...rest } = formData;
     const dataToSubmit = {
       ...rest,
       planned_units: parseInt(planned_units),
     };
     await base44.entities.ProductionBatch.create(dataToSubmit);
     await onSave();
     onClose();
   } catch (err) {
     setError(err.message || 'Failed to create batch');
     setLoading(false);
   }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-card rounded-xl shadow-lg max-w-md w-full p-6 my-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Add Production Batch</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Batch ID</label>
            <input
              type="text"
              value={formData.batch_id}
              onChange={(e) => handleChange('batch_id', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              placeholder="e.g., BATCH-2026-W15-A"
            />
          </div>

          <div>
             <label className="text-sm font-medium">Product Name</label>
             <select
               value={formData.product_name}
               onChange={(e) => handleChange('product_name', e.target.value)}
               className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
               required
             >
               <option value="">Select product</option>
               {recipes.map(recipe => (
                 <option key={recipe.id} value={recipe.product_name}>{recipe.product_name}</option>
               ))}
             </select>
             <p className="text-xs text-muted-foreground mt-1">Only base products shown. Bundles auto-decompose in orders.</p>
           </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Status</label>
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
              <label className="text-sm font-medium">Planned Units</label>
              <input
                type="number"
                value={formData.planned_units}
                onChange={(e) => handleChange('planned_units', e.target.value)}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
                required
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Production Date</label>
            <input
              type="date"
              value={formData.production_date}
              onChange={(e) => handleChange('production_date', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              required
            />
          </div>

          <div>
            <label className="text-sm font-medium">Assigned To</label>
            <input
              type="text"
              value={formData.assigned_to}
              onChange={(e) => handleChange('assigned_to', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              rows="2"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}