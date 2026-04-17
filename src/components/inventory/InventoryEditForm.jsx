import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

export default function InventoryEditForm({ item, onClose, onSave }) {
  const [formData, setFormData] = useState({
    ingredient: item.ingredient || '',
    unit: item.unit || 'kg',
    stock: item.stock || '',
    reorder_point: item.reorder_point || '',
    max_stock: item.max_stock || '',
    cost_per_unit: item.cost_per_unit || '',
    supplier: item.supplier || '',
    location: item.location || '',
    category: item.category || 'Produce',
    notes: item.notes || '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await base44.entities.InventoryItem.update(item.id, formData);
      onSave();
    } catch (err) {
      setError(err.message || 'Failed to save changes');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-card rounded-xl shadow-lg max-w-md w-full p-6 my-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Edit Item</h2>
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
            <label className="text-sm font-medium">Ingredient</label>
            <input
              type="text"
              value={formData.ingredient}
              onChange={(e) => handleChange('ingredient', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Stock</label>
              <input
                type="number"
                value={formData.stock}
                onChange={(e) => handleChange('stock', parseFloat(e.target.value) || '')}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Unit</label>
              <select
                value={formData.unit}
                onChange={(e) => handleChange('unit', e.target.value)}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              >
                <option>kg</option>
                <option>g</option>
                <option>L</option>
                <option>mL</option>
                <option>units</option>
                <option>cases</option>
                <option>bottles</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Reorder Point</label>
              <input
                type="number"
                value={formData.reorder_point}
                onChange={(e) => handleChange('reorder_point', parseFloat(e.target.value) || '')}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Max Stock</label>
              <input
                type="number"
                value={formData.max_stock}
                onChange={(e) => handleChange('max_stock', parseFloat(e.target.value) || '')}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Category</label>
            <select
              value={formData.category}
              onChange={(e) => handleChange('category', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
            >
              <option>Produce</option>
              <option>Juice Base</option>
              <option>Spices & Herbs</option>
              <option>Packaging</option>
              <option>Supplies</option>
              <option>Other</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium">Supplier</label>
            <input
              type="text"
              value={formData.supplier}
              onChange={(e) => handleChange('supplier', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}