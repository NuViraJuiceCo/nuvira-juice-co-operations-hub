import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

export default function EventEditForm({ event, selectedDate, onClose, onSave }) {
  const isCreating = !event;
  
  // Initialize date: if creating, use selectedDate; if editing, use event.date; fallback to today
  const getInitialDate = () => {
    if (event?.date) return event.date;
    if (selectedDate) return selectedDate;
    return new Date().toISOString().split('T')[0];
  };

  const [formData, setFormData] = useState({
    name: event?.name || '',
    type: event?.type || 'Pop-Up',
    status: event?.status || 'Pending',
    date: getInitialDate(),
    end_date: event?.end_date || '',
    location: event?.location || '',
    expected_attendees: event?.expected_attendees || '',
    products: event?.products || '',
    contact_name: event?.contact_name || '',
    contact_email: event?.contact_email || '',
    revenue: event?.revenue || '',
    notes: event?.notes || '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setError('Event name is required');
      return;
    }
    if (!formData.date) {
      setError('Event date is required');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      if (isCreating) {
        await base44.entities.Event.create(formData);
      } else {
        await base44.entities.Event.update(event.id, formData);
      }
      onSave();
    } catch (err) {
      setError(err.message || 'Failed to save changes');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-card rounded-xl shadow-lg max-w-2xl w-full p-6 my-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{isCreating ? 'Add Event' : 'Edit Event'}</h2>
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
          {/* Name */}
          <div>
            <label className="text-sm font-medium">Event Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              required
            />
          </div>

          {/* Type and Status */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Type *</label>
              <select
                value={formData.type}
                onChange={(e) => handleChange('type', e.target.value)}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              >
                <option>Pop-Up</option>
                <option>Market</option>
                <option>Corporate</option>
                <option>Tasting</option>
                <option>Festival</option>
                <option>Wholesale Meeting</option>
                <option>Other</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Status *</label>
              <select
                value={formData.status}
                onChange={(e) => handleChange('status', e.target.value)}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              >
                <option>Pending</option>
                <option>Confirmed</option>
                <option>Applied</option>
                <option>Cancelled</option>
                <option>Completed</option>
              </select>
            </div>
          </div>

          {/* Date and End Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Date *</label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => handleChange('date', e.target.value)}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium">End Date</label>
              <input
                type="date"
                value={formData.end_date}
                onChange={(e) => handleChange('end_date', e.target.value)}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              />
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="text-sm font-medium">Location</label>
            <input
              type="text"
              value={formData.location}
              onChange={(e) => handleChange('location', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              placeholder="Venue/address"
            />
          </div>

          {/* Contact Info */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Contact Name</label>
              <input
                type="text"
                value={formData.contact_name}
                onChange={(e) => handleChange('contact_name', e.target.value)}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Contact Email</label>
              <input
                type="email"
                value={formData.contact_email}
                onChange={(e) => handleChange('contact_email', e.target.value)}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              />
            </div>
          </div>

          {/* Expected Attendees and Revenue */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Expected Attendees</label>
              <input
                type="number"
                value={formData.expected_attendees}
                onChange={(e) => handleChange('expected_attendees', e.target.value ? parseInt(e.target.value) : '')}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Revenue</label>
              <input
                type="number"
                step="0.01"
                value={formData.revenue}
                onChange={(e) => handleChange('revenue', e.target.value ? parseFloat(e.target.value) : '')}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Products */}
          <div>
            <label className="text-sm font-medium">Products</label>
            <textarea
              value={formData.products}
              onChange={(e) => handleChange('products', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background h-12 resize-none"
              placeholder="e.g., 5 Re-Nu, 13 Aura, 12 Oasis"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-sm font-medium">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background h-16 resize-none"
              placeholder="Setup logistics, parking info, contact instructions..."
            />
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? 'Saving...' : isCreating ? 'Create Event' : 'Save'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}