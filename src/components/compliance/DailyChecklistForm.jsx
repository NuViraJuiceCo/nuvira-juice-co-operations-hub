import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertCircle } from 'lucide-react';
import {
  calculateDailyChecklistStatus,
  getChicagoDateInput,
  isDailyChecklistPreProductionComplete,
} from '@/lib/compliancePersistence';

export default function DailyChecklistForm({ initialDate }) {
  const checklistDate = initialDate || getChicagoDateInput();
  const [existingChecklist, setExistingChecklist] = useState(null);
  const [formData, setFormData] = useState({
    checklist_date: checklistDate,
    staff_member: '',
    shift: 'Morning',
    morning_fridge_temp_logged: false,
    morning_fridge_time: '',
    evening_fridge_temp_logged: false,
    evening_fridge_time: '',
    sanitizer_levels_checked: false,
    sanitizer_check_time: '',
    equipment_sanitized: false,
    sanitization_time: '',
    work_areas_cleaned: false,
    cleaning_time: '',
    batch_logs_completed: false,
    batches_logged: '',
    ccp_logs_completed: false,
    ccp_notes: '',
    issues_reported: '',
    overall_status: 'Incomplete',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(u => {
      const staffName = u.full_name || u.email;
      setFormData(prev => ({ ...prev, staff_member: staffName }));
      checkExistingChecklist(staffName, checklistDate);
    }).catch(() => setMessage({ type: 'error', text: 'Unable to confirm the current operator.' }));
  }, [checklistDate]);

  const checkExistingChecklist = async (staffName, date) => {
    const existing = await base44.entities.DailyChecklist.filter({
      checklist_date: date,
      staff_member: staffName,
    });
    if (existing && existing.length > 0) {
      setExistingChecklist(existing[0]);
      setFormData(prev => ({
        ...prev,
        ...existing[0],
      }));
    }
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const status = calculateDailyChecklistStatus(formData);
    setIsSubmitting(true);
    setMessage(null);

    try {
      const dataToSave = {
        checklist_date: formData.checklist_date,
        staff_member: formData.staff_member,
        shift: formData.shift,
        morning_fridge_temp_logged: Boolean(formData.morning_fridge_temp_logged),
        morning_fridge_time: formData.morning_fridge_time,
        evening_fridge_temp_logged: Boolean(formData.evening_fridge_temp_logged),
        evening_fridge_time: formData.evening_fridge_time,
        sanitizer_levels_checked: Boolean(formData.sanitizer_levels_checked),
        sanitizer_check_time: formData.sanitizer_check_time,
        equipment_sanitized: Boolean(formData.equipment_sanitized),
        sanitization_time: formData.sanitization_time,
        work_areas_cleaned: Boolean(formData.work_areas_cleaned),
        cleaning_time: formData.cleaning_time,
        batch_logs_completed: Boolean(formData.batch_logs_completed),
        batches_logged: formData.batches_logged,
        ccp_logs_completed: Boolean(formData.ccp_logs_completed),
        ccp_notes: formData.ccp_notes,
        issues_reported: formData.issues_reported,
        overall_status: status,
        ...(status === 'Complete' || existingChecklist?.completed_at
          ? { completed_at: status === 'Complete' ? new Date().toISOString() : existingChecklist.completed_at }
          : {}),
      };

      let saved;
      if (existingChecklist) {
        saved = await base44.entities.DailyChecklist.update(existingChecklist.id, dataToSave);
      } else {
        saved = await base44.entities.DailyChecklist.create(dataToSave);
      }

      const savedId = saved?.id || existingChecklist?.id;
      const confirmed = await base44.entities.DailyChecklist.get(savedId);
      setExistingChecklist(confirmed);
      setFormData(prev => ({ ...prev, ...confirmed }));

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['checklists_today'] }),
        queryClient.invalidateQueries({ queryKey: ['daily_checklists_today'] }),
        queryClient.invalidateQueries({ queryKey: ['production_audit_packet'] }),
      ]);
      setMessage({
        type: 'success',
        text: status === 'Complete'
          ? 'Daily checklist saved, verified, and complete.'
          : 'Daily checklist saved and verified. Finish the PM temperature and batch closeout when production is complete.',
      });
    } catch (error) {
      setMessage({ type: 'error', text: `Daily checklist was not saved: ${error.message}` });
    } finally {
      setIsSubmitting(false);
    }
  };

  const preProductionComplete = isDailyChecklistPreProductionComplete(formData);

  const completedCount = [
    formData.morning_fridge_temp_logged,
    formData.evening_fridge_temp_logged,
    formData.sanitizer_levels_checked,
    formData.equipment_sanitized,
    formData.work_areas_cleaned,
    formData.batch_logs_completed,
  ].filter(Boolean).length;

  const totalItems = 6;

  return (
    <Card>
      <CardHeader>
        <CardTitle>📋 Daily Checklist — {formData.shift} Shift</CardTitle>
        <p className="text-sm text-muted-foreground mt-2">
          Progress: {completedCount}/{totalItems} items completed
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Date</label>
              <input
                type="date"
                value={formData.checklist_date}
                disabled
                className="w-full border rounded-md p-2 mt-1 bg-muted text-foreground"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Shift</label>
              <select
                value={formData.shift}
                onChange={(e) => handleChange('shift', e.target.value)}
                className="w-full border rounded-md p-2 mt-1 bg-background text-foreground"
              >
                <option>Morning</option>
                <option>Afternoon</option>
                <option>Night</option>
              </select>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="font-semibold">🌡️ Temperature Checks</h3>
            <div className="flex items-center gap-3">
              <Checkbox
                checked={formData.morning_fridge_temp_logged}
                onCheckedChange={(c) => handleChange('morning_fridge_temp_logged', c)}
                id="morning_fridge"
              />
              <label htmlFor="morning_fridge" className="text-sm cursor-pointer flex-1">Morning refrigerator temperature logged</label>
              <input
                type="time"
                value={formData.morning_fridge_time}
                onChange={(e) => handleChange('morning_fridge_time', e.target.value)}
                className="w-24 border rounded p-1 text-sm bg-background text-foreground"
                placeholder="HH:MM"
              />
            </div>
            <div className="flex items-center gap-3">
              <Checkbox
                checked={formData.evening_fridge_temp_logged}
                onCheckedChange={(c) => handleChange('evening_fridge_temp_logged', c)}
                id="evening_fridge"
              />
              <label htmlFor="evening_fridge" className="text-sm cursor-pointer flex-1">Evening refrigerator temperature logged <span className="text-muted-foreground text-xs">(after production)</span></label>
              <input
                type="time"
                value={formData.evening_fridge_time}
                onChange={(e) => handleChange('evening_fridge_time', e.target.value)}
                className="w-24 border rounded p-1 text-sm bg-background text-foreground"
                placeholder="HH:MM"
              />
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="font-semibold">🧼 Sanitation</h3>
            <div className="flex items-center gap-3">
              <Checkbox
                checked={formData.sanitizer_levels_checked}
                onCheckedChange={(c) => handleChange('sanitizer_levels_checked', c)}
                id="sanitizer_check"
              />
              <label htmlFor="sanitizer_check" className="text-sm cursor-pointer flex-1">Sanitizer levels checked</label>
              <input
                type="time"
                value={formData.sanitizer_check_time}
                onChange={(e) => handleChange('sanitizer_check_time', e.target.value)}
                className="w-24 border rounded p-1 text-sm bg-background text-foreground"
              />
            </div>
            <div className="flex items-center gap-3">
              <Checkbox
                checked={formData.equipment_sanitized}
                onCheckedChange={(c) => handleChange('equipment_sanitized', c)}
                id="equipment_san"
              />
              <label htmlFor="equipment_san" className="text-sm cursor-pointer flex-1">Equipment sanitized</label>
              <input
                type="time"
                value={formData.sanitization_time}
                onChange={(e) => handleChange('sanitization_time', e.target.value)}
                className="w-24 border rounded p-1 text-sm bg-background text-foreground"
              />
            </div>
            <div className="flex items-center gap-3">
              <Checkbox
                checked={formData.work_areas_cleaned}
                onCheckedChange={(c) => handleChange('work_areas_cleaned', c)}
                id="areas_clean"
              />
              <label htmlFor="areas_clean" className="text-sm cursor-pointer flex-1">Work areas cleaned</label>
              <input
                type="time"
                value={formData.cleaning_time}
                onChange={(e) => handleChange('cleaning_time', e.target.value)}
                className="w-24 border rounded p-1 text-sm bg-background text-foreground"
              />
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="font-semibold">📊 Logs Completed</h3>
            <div className="flex items-start gap-3">
              <Checkbox
                checked={formData.batch_logs_completed}
                onCheckedChange={(c) => handleChange('batch_logs_completed', c)}
                id="batch_logs"
              />
              <div className="flex-1">
                <label htmlFor="batch_logs" className="text-sm cursor-pointer block">Batch logs completed</label>
                <input
                  type="text"
                  value={formData.batches_logged}
                  onChange={(e) => handleChange('batches_logged', e.target.value)}
                  placeholder="Which batches? (e.g., #101, #102)"
                  className="w-full border rounded p-2 mt-1 text-sm bg-background text-foreground"
                />
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                checked={formData.ccp_logs_completed}
                onCheckedChange={(c) => handleChange('ccp_logs_completed', c)}
                id="ccp_logs"
              />
              <div className="flex-1">
                <label htmlFor="ccp_logs" className="text-sm cursor-pointer block">CCP logs completed <span className="text-muted-foreground text-xs">(only when a CCP check was required)</span></label>
                <input
                  type="text"
                  value={formData.ccp_notes}
                  onChange={(e) => handleChange('ccp_notes', e.target.value)}
                  placeholder="CCP details or notes..."
                  className="w-full border rounded p-2 mt-1 text-sm bg-background text-foreground"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Any Issues or Concerns?</label>
            <textarea
              value={formData.issues_reported}
              onChange={(e) => handleChange('issues_reported', e.target.value)}
              placeholder="Report any problems, equipment issues, or other concerns..."
              className="w-full border rounded-md p-2 mt-1 resize-none bg-background text-foreground"
              rows="3"
            />
          </div>

          {!preProductionComplete && (
            <div className="flex gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800">
                <p className="font-semibold">Required Pre-Production Items Incomplete</p>
                <p>Complete the temperature check, sanitizer check, equipment sanitation, and work area cleaning before submitting.</p>
              </div>
            </div>
          )}

          {preProductionComplete && completedCount < totalItems && (
            <div className="flex gap-2 p-3 bg-blue-50 border border-blue-200 rounded-md">
              <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-800">
                <p className="font-semibold">Pre-Production Ready</p>
                <p>You can submit now. PM temperature and batch closeout can be updated after production completes. CCP is optional unless a deviation requires it. ({completedCount}/{totalItems} required items done)</p>
              </div>
            </div>
          )}

          {message && (
            <div className={`rounded-md p-3 text-sm ${message.type === 'error' ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'}`}>
              {message.text}
            </div>
          )}

          <Button
            type="submit"
            disabled={isSubmitting || !preProductionComplete}
            className="w-full"
          >
            {isSubmitting ? 'Saving...' : `Submit Checklist (${completedCount}/${totalItems})`}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
