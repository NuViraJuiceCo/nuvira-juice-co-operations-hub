import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';

export default function TemperatureLogForm({ onClose }) {
  const [user, setUser] = useState(null);
  const [formData, setFormData] = useState({
    log_date: new Date().toISOString().split('T')[0],
    log_time: new Date().toTimeString().slice(0, 5),
    staff_member: '',
    location: 'Cold Room 1',
    temperature: '',
    min_range: 2,
    max_range: 8,
    shift: 'Morning',
    notes: '',
  });
  const [warning, setWarning] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      setFormData(prev => ({ ...prev, staff_member: u.full_name }));
    });
  }, []);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Check if temperature is in range
    if (field === 'temperature') {
      const temp = parseFloat(value);
      if (temp < formData.min_range || temp > formData.max_range) {
        setWarning(`Temperature ${temp}°C is outside range ${formData.min_range}-${formData.max_range}°C`);
      } else {
        setWarning('');
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.temperature) return;

    setIsSubmitting(true);
    try {
      const temp = parseFloat(formData.temperature);
      const isInRange = temp >= formData.min_range && temp <= formData.max_range;

      const entry = await base44.entities.TemperatureLog.create({
        ...formData,
        temperature: temp,
        within_range: isInRange,
      });

      // If out of range, create corrective action prompt
      if (!isInRange) {
        await base44.functions.invoke('validateComplianceEntry', {
          log_type: 'temperature',
          data: formData,
          min_value: formData.min_range,
          max_value: formData.max_range,
        });
      }

      queryClient.invalidateQueries({ queryKey: ['temperature_logs'] });
      queryClient.invalidateQueries({ queryKey: ['temp_logs_today'] });
      onClose?.();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>🌡️ Temperature Log</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Date</label>
              <input
                type="date"
                value={formData.log_date}
                onChange={(e) => handleChange('log_date', e.target.value)}
                className="w-full border rounded-md p-2 mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Time</label>
              <input
                type="time"
                value={formData.log_time}
                onChange={(e) => handleChange('log_time', e.target.value)}
                className="w-full border rounded-md p-2 mt-1"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Staff Member</label>
            <input
              type="text"
              value={formData.staff_member}
              onChange={(e) => handleChange('staff_member', e.target.value)}
              className="w-full border rounded-md p-2 mt-1"
              disabled
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Location</label>
              <select
                value={formData.location}
                onChange={(e) => handleChange('location', e.target.value)}
                className="w-full border rounded-md p-2 mt-1"
              >
                <option>Cold Room 1</option>
                <option>Cold Room 2</option>
                <option>Freezer</option>
                <option>Walk-in Cooler</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Shift</label>
              <select
                value={formData.shift}
                onChange={(e) => handleChange('shift', e.target.value)}
                className="w-full border rounded-md p-2 mt-1"
              >
                <option>Morning</option>
                <option>Afternoon</option>
                <option>Night</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Temperature (°C)</label>
            <input
              type="number"
              step="0.1"
              value={formData.temperature}
              onChange={(e) => handleChange('temperature', e.target.value)}
              placeholder="e.g., 4.5"
              className="w-full border rounded-md p-2 mt-1"
              required
            />
            <p className="text-xs text-muted-foreground mt-1">Target range: {formData.min_range}°C - {formData.max_range}°C</p>
          </div>

          {warning && (
            <div className="flex gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
              <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-yellow-800">
                <p className="font-semibold">Out of Range</p>
                <p>{warning}</p>
                <p className="mt-1">A corrective action log will be required.</p>
              </div>
            </div>
          )}

          <div>
            <label className="text-sm font-medium">Notes (Optional)</label>
            <textarea
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              placeholder="Any additional observations..."
              className="w-full border rounded-md p-2 mt-1 resize-none"
              rows="3"
            />
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={isSubmitting} className="flex-1">
              {isSubmitting ? 'Saving...' : 'Save Temperature Log'}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}