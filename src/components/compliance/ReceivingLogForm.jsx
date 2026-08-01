import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { getChicagoDateInput, getChicagoShift, getChicagoTimeInput } from '@/lib/compliancePersistence';

export default function ReceivingLogForm({ initialDate, onClose }) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    log_date: initialDate || getChicagoDateInput(),
    log_time: getChicagoTimeInput(),
    staff_member: '',
    shift: getChicagoShift(),
    supplier: '',
    item: '',
    quantity: '',
    condition: 'Acceptable',
    accepted: true,
    stored_at: '',
    notes: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    base44.auth.me()
      .then((user) => setFormData((current) => ({ ...current, staff_member: user.full_name || user.email })))
      .catch(() => setMessage({ type: 'error', text: 'Unable to confirm the current operator.' }));
  }, []);

  useEffect(() => {
    if (initialDate) {
      setFormData((current) => ({ ...current, log_date: initialDate }));
    }
  }, [initialDate]);

  const handleChange = (field, value) => {
    setFormData((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    try {
      const saved = await base44.entities.ComplianceLog.create({
        log_type: 'receiving',
        log_date: formData.log_date,
        log_time: formData.log_time,
        staff_member: formData.staff_member,
        shift: formData.shift,
        status: formData.accepted ? 'complete' : 'fail',
        notes: formData.notes,
        data: {
          supplier: formData.supplier,
          item: formData.item,
          quantity: formData.quantity,
          condition: formData.condition,
          accepted: formData.accepted,
          stored_at: formData.stored_at,
        },
      });

      await base44.entities.ComplianceLog.get(saved.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['other_compliance_logs'] }),
        queryClient.invalidateQueries({ queryKey: ['production_audit_packet'] }),
      ]);
      setMessage({ type: 'success', text: 'Receiving log saved and verified.' });
      onClose?.();
    } catch (error) {
      setMessage({ type: 'error', text: `Receiving log was not saved: ${error.message}` });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Receiving Log</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Receiving Date</label>
              <input
                type="date"
                value={formData.log_date}
                onChange={(event) => handleChange('log_date', event.target.value)}
                className="w-full border rounded-md p-2 mt-1 bg-background text-foreground"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium">Time</label>
              <input
                type="time"
                value={formData.log_time}
                onChange={(event) => handleChange('log_time', event.target.value)}
                className="w-full border rounded-md p-2 mt-1 bg-background text-foreground"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Supplier</label>
              <input
                value={formData.supplier}
                onChange={(event) => handleChange('supplier', event.target.value)}
                className="w-full border rounded-md p-2 mt-1 bg-background text-foreground"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium">Item Received</label>
              <input
                value={formData.item}
                onChange={(event) => handleChange('item', event.target.value)}
                className="w-full border rounded-md p-2 mt-1 bg-background text-foreground"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium">Quantity</label>
              <input
                value={formData.quantity}
                onChange={(event) => handleChange('quantity', event.target.value)}
                className="w-full border rounded-md p-2 mt-1 bg-background text-foreground"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium">Condition</label>
              <select
                value={formData.condition}
                onChange={(event) => handleChange('condition', event.target.value)}
                className="w-full border rounded-md p-2 mt-1 bg-background text-foreground"
              >
                <option>Acceptable</option>
                <option>Damaged</option>
                <option>Temperature Concern</option>
                <option>Rejected</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Stored At</label>
              <input
                value={formData.stored_at}
                onChange={(event) => handleChange('stored_at', event.target.value)}
                placeholder="Cooler, prep area, dry storage"
                className="w-full border rounded-md p-2 mt-1 bg-background text-foreground"
                required
              />
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-md border p-3">
            <Checkbox
              id="receiving-accepted"
              checked={formData.accepted}
              onCheckedChange={(checked) => handleChange('accepted', Boolean(checked))}
            />
            <label htmlFor="receiving-accepted" className="text-sm cursor-pointer">
              Shipment accepted for production use
            </label>
          </div>

          <div>
            <label className="text-sm font-medium">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(event) => handleChange('notes', event.target.value)}
              className="w-full border rounded-md p-2 mt-1 bg-background text-foreground resize-none"
              rows="3"
            />
          </div>

          {message && (
            <div className={`rounded-md p-3 text-sm ${message.type === 'error' ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'}`}>
              {message.text}
            </div>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={isSubmitting || !formData.staff_member} className="flex-1">
              {isSubmitting ? 'Saving...' : 'Save Receiving Log'}
            </Button>
            {onClose && (
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
