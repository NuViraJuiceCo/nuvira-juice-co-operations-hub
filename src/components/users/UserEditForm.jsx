import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

export default function UserEditForm({ user, onClose, onSave }) {
  const [formData, setFormData] = useState({
    title: user.title || '',
    phone: user.phone || '',
    role: user.role || 'user',
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
      await base44.auth.updateMe(formData);
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
          <h2 className="text-lg font-semibold">Edit User</h2>
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
            <label className="text-sm font-medium text-foreground">Name</label>
            <p className="text-sm text-muted-foreground mt-1">{user.full_name}</p>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Email</label>
            <p className="text-sm text-muted-foreground mt-1">{user.email}</p>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Title</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => handleChange('title', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
              placeholder="e.g., Production Manager"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Phone</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => handleChange('phone', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Role</label>
            <select
              value={formData.role}
              onChange={(e) => handleChange('role', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
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