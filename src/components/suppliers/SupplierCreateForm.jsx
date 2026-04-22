import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

export default function SupplierCreateForm({ onClose, onSave }) {
  const [formData, setFormData] = useState({
    name: '',
    contact_name: '',
    email: '',
    phone: '',
    address: '',
    location: '',
    category: 'Produce',
    status: 'Active',
    lead_time_days: '',
    payment_terms: '',
    rating: '',
    notes: '',
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
      const dataToSubmit = {
        ...formData,
        lead_time_days: formData.lead_time_days ? parseFloat(formData.lead_time_days) : null,
        rating: formData.rating ? parseFloat(formData.rating) : null,
      };
      await base44.entities.Supplier.create(dataToSubmit);
      onSave();
    } catch (err) {
      setError(err.message || 'Failed to create supplier');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-card rounded-xl shadow-lg max-w-md w-full p-6 my-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Add Supplier</h2>
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
            <label className="text-sm font-medium">Business Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              required
            />
          </div>

          <div>
            <label className="text-sm font-medium">Contact Name</label>
            <input
              type="text"
              value={formData.contact_name}
              onChange={(e) => handleChange('contact_name', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => handleChange('email', e.target.value)}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Phone</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => handleChange('phone', e.target.value)}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
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
                <option>Exotic Produce</option>
                <option>Citrus</option>
                <option>Equipment</option>
                <option>Other</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Status</label>
              <select
                value={formData.status}
                onChange={(e) => handleChange('status', e.target.value)}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              >
                <option>Active</option>
                <option>Inactive</option>
                <option>Negotiating</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Address</label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => handleChange('address', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              placeholder="Street address, building, suite"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Location</label>
            <input
              type="text"
              value={formData.location}
              onChange={(e) => handleChange('location', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              placeholder="City/Province"
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