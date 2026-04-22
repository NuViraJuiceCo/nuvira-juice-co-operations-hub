import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

export default function PartnershipCreateForm({ onClose, onSave }) {
  const [formData, setFormData] = useState({
    business_name: '',
    contact_name: '',
    email: '',
    phone: '',
    type: 'Wholesale',
    stage: 'New',
    estimated_value: '',
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
     const { estimated_value, ...rest } = formData;
     const dataToSubmit = {
       ...rest,
       ...(estimated_value && { estimated_value: parseFloat(estimated_value) }),
     };
     await base44.entities.Lead.create(dataToSubmit);
     await onSave();
     onClose();
   } catch (err) {
     setError(err.message || 'Failed to create lead');
     setLoading(false);
   }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-card rounded-xl shadow-lg max-w-md w-full p-6 my-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Add Lead</h2>
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
              value={formData.business_name}
              onChange={(e) => handleChange('business_name', e.target.value)}
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
              <label className="text-sm font-medium">Type</label>
              <select
                value={formData.type}
                onChange={(e) => handleChange('type', e.target.value)}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              >
                <option>Wholesale</option>
                <option>Retail</option>
                <option>Corporate</option>
                <option>Event</option>
                <option>Distributor</option>
                <option>Referral</option>
                <option>Other</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Stage</label>
              <select
                value={formData.stage}
                onChange={(e) => handleChange('stage', e.target.value)}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              >
                <option>New</option>
                <option>Contacted</option>
                <option>Proposal Sent</option>
                <option>Negotiating</option>
                <option>Won</option>
                <option>Lost</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Est. Value (monthly)</label>
            <input
              type="number"
              value={formData.estimated_value}
              onChange={(e) => handleChange('estimated_value', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              placeholder="0"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              rows="3"
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