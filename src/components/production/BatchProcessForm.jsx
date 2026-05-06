import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { X, AlertCircle, History, FlaskConical, Play, Save } from 'lucide-react';
import moment from 'moment';
import { useProductFormula } from '@/hooks/useProductFormula';

/**
 * Unified Batch Processing Form
 * Used by both Play (mode="start") and Edit (mode="edit") actions.
 * Merges all fields from BatchStartForm + BatchCompleteForm + BatchEditForm.
 */
export default function BatchProcessForm({ batch, mode = 'edit', onClose, onSave }) {
  const today = moment().format('YYYY-MM-DD');
  const isRetrospective = batch.production_date < today;

  const { recipe, formulaSummary, loading: recipeLoading, notFound: recipeNotFound } = useProductFormula(batch.product_name);
  const [formulaOverridden, setFormulaOverridden] = useState(false);

  // Normalize quantity: resolve from multiple possible field names, parse safely
  // Fallback order: actual_quantity_produced → actual_units → quantity_produced → planned_units
  const resolveQty = (b) => {
    const raw = b.actual_quantity_produced ?? b.actual_units ?? b.quantity_produced ?? b.planned_units ?? '';
    const n = parseInt(raw, 10);
    return isNaN(n) ? '' : n;
  };

  const [formData, setFormData] = useState({
    // Start fields
    pre_op_sanitation_confirmed: batch.pre_op_sanitation_confirmed || false,
    refrigerator_temp_checked: batch.refrigerator_temp_checked || false,
    retrospective_reason: '',
    actual_start_time_override: isRetrospective ? `${batch.production_date}T06:00` : '',
    formula_mixed_time: batch.formula_mixed_time || '',
    bottling_start_time: batch.bottling_start_time || '',
    refrigeration_time: batch.refrigeration_time || '',
    final_ingredients: batch.ingredients_used || [],
    ingredients_notes: batch.ingredient_lot_notes || '',
    manual_ingredient_override: false,
    // Complete fields
    actual_quantity_produced: resolveQty(batch),
    actual_end_time: batch.actual_end_time ? moment(batch.actual_end_time).format('YYYY-MM-DDTHH:mm') : '',
    bottles_produced: batch.bottles_produced || '',
    bottles_rejected_or_wasted: batch.bottles_rejected_or_wasted || '',
    final_usable_quantity: batch.final_usable_quantity || '',
    storage_location: batch.storage_location || '',
    use_by_date: batch.use_by_date || '',
    ingredient_lot_notes: batch.ingredient_lot_notes || '',
    pH_result: batch.pH_result || '',
    pH_passed_failed: batch.pH_passed_failed || 'passed',
    pH_meter_id: batch.pH_meter_id || '',
    calibration_checked: batch.calibration_checked || false,
    ccp_check_complete: batch.ccp_check_complete || false,
    sanitation_verification_complete: batch.sanitation_verification_complete || false,
    labels_applied: batch.labels_applied || false,
    passed_failed: batch.passed_failed || 'passed',
    corrective_action_required: batch.corrective_action_required || false,
    issue_identified: batch.issue_identified || '',
    detection_method: batch.detection_method || '',
    product_involved: batch.product_involved || '',
    action_taken: batch.action_taken || '',
    disposed: batch.disposed || false,
    quantity_disposed: batch.quantity_disposed || '',
    preventive_steps: batch.preventive_steps || '',
    // Edit fields
    status: batch.status || 'planned',
    assigned_to: batch.assigned_to || '',
    notes: batch.notes || '',
    // Staff / equipment
    staff_on_duty: batch.staff_on_duty || [],
    equipment_used: batch.equipment_used || [],
  });

  const [staffInput, setStaffInput] = useState('');
  const [equipmentInput, setEquipmentInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Auto-fill formula ingredients once recipe loads
  useEffect(() => {
    if (recipe && !formulaOverridden && !batch.ingredients_used?.length) {
      setFormData(prev => ({ ...prev, final_ingredients: recipe.ingredients || [] }));
    }
  }, [recipe]);

  const set = (field, value) => setFormData(prev => ({ ...prev, [field]: value }));

  const handleAddStaff = () => {
    if (staffInput.trim()) { set('staff_on_duty', [...formData.staff_on_duty, staffInput.trim()]); setStaffInput(''); }
  };
  const handleRemoveStaff = (idx) => set('staff_on_duty', formData.staff_on_duty.filter((_, i) => i !== idx));
  const handleAddEquipment = () => {
    if (equipmentInput.trim()) { set('equipment_used', [...formData.equipment_used, equipmentInput.trim()]); setEquipmentInput(''); }
  };
  const handleRemoveEquipment = (idx) => set('equipment_used', formData.equipment_used.filter((_, i) => i !== idx));

  // ── SAVE ONLY (no processing) ──────────────────────────────────────────────
  const handleSave = async () => {
    setError(null);
    setLoading(true);
    try {
      const patch = {
        status: formData.status,
        assigned_to: formData.assigned_to,
        notes: formData.notes,
        staff_on_duty: formData.staff_on_duty,
        equipment_used: formData.equipment_used,
        ingredient_lot_notes: formData.ingredient_lot_notes || formData.ingredients_notes,
        pre_op_sanitation_confirmed: formData.pre_op_sanitation_confirmed,
        refrigerator_temp_checked: formData.refrigerator_temp_checked,
        pH_result: formData.pH_result !== '' ? parseFloat(formData.pH_result) : null,
        pH_passed_failed: formData.pH_passed_failed,
        passed_failed: formData.passed_failed,
        storage_location: formData.storage_location,
        use_by_date: formData.use_by_date,
      };
      // Persist actual quantity — write all three fields so reopen always finds them
      const rawQtySave = formData.actual_quantity_produced !== '' ? formData.actual_quantity_produced : batch.planned_units;
      const qtySave = parseInt(rawQtySave, 10);
      if (!isNaN(qtySave) && qtySave > 0) {
        patch.actual_quantity_produced = qtySave;
        patch.actual_units = qtySave;
        patch.quantity_produced = qtySave;
      }
      await base44.entities.ProductionBatch.update(batch.id, patch);
      onSave();
    } catch (err) {
      setError(err.message || 'Failed to save changes');
      setLoading(false);
    }
  };

  // ── PROCESS BATCH (start + complete in one action) ─────────────────────────
  const handleProcess = async () => {
    setError(null);

    // Normalize quantity — fallback chain: form field → batch saved field → planned_units
    const rawQty = (formData.actual_quantity_produced !== '' && formData.actual_quantity_produced != null)
      ? formData.actual_quantity_produced
      : (batch.actual_quantity_produced ?? batch.actual_units ?? batch.quantity_produced ?? batch.planned_units);
    const qty = parseInt(rawQty, 10);

    console.log('[BatchProcessForm] Validating — batch_id:', batch.batch_id,
      'planned_units:', batch.planned_units,
      'form.actual_quantity_produced:', formData.actual_quantity_produced,
      'resolved qty:', qty);

    if (isNaN(qty) || qty <= 0) {
      setError(`Quantity must be greater than 0. (resolved=${qty}, form=${formData.actual_quantity_produced}, planned=${batch.planned_units})`);
      return;
    }
    if (isRetrospective && !formData.retrospective_reason.trim()) {
      setError('A retrospective reason is required.');
      return;
    }

    setLoading(true);
    try {
      // Step 1: Start batch (if not already started)
      if (!batch.actual_start_time) {
        await base44.functions.invoke('startBatchProduction', {
          batch_id: batch.batch_id,
          staff_on_duty: formData.staff_on_duty,
          equipment_used: formData.equipment_used,
          pre_op_sanitation_confirmed: formData.pre_op_sanitation_confirmed,
          refrigerator_temp_checked: formData.refrigerator_temp_checked,
          notes: formData.notes,
          retrospective_reason: formData.retrospective_reason,
          ingredient_lot_notes: formData.ingredients_notes || formData.ingredient_lot_notes,
          final_ingredients: formData.final_ingredients,
          default_formula_ingredients: recipe?.ingredients || [],
          manual_ingredient_override: formData.manual_ingredient_override || false,
          actual_start_time_override: isRetrospective && formData.actual_start_time_override
            ? new Date(formData.actual_start_time_override).toISOString()
            : undefined,
        });
      }

      // Step 2: Complete batch — send all quantity field aliases so backend validation passes
      await base44.functions.invoke('completeBatchProduction', {
        batch_id: batch.batch_id,
        actual_quantity_produced: qty,
        actual_units: qty,
        quantity_produced: qty,
        staff_on_duty: formData.staff_on_duty,
        actual_end_time: formData.actual_end_time ? new Date(formData.actual_end_time).toISOString() : new Date().toISOString(),
        bottles_produced: formData.bottles_produced || qty,
        bottles_rejected_or_wasted: formData.bottles_rejected_or_wasted,
        final_usable_quantity: formData.final_usable_quantity || qty,
        storage_location: formData.storage_location,
        use_by_date: formData.use_by_date,
        final_ingredients: formData.final_ingredients,
        ingredient_lot_notes: formData.ingredient_lot_notes || formData.ingredients_notes,
        default_formula_ingredients: recipe?.ingredients || [],
        manual_ingredient_override: formData.manual_ingredient_override || false,
        pH_result: formData.pH_result !== '' ? parseFloat(formData.pH_result) : 0,
        pH_passed_failed: formData.pH_passed_failed,
        pH_meter_id: formData.pH_meter_id,
        calibration_checked: formData.calibration_checked,
        ccp_check_complete: formData.ccp_check_complete,
        sanitation_verification_complete: formData.sanitation_verification_complete,
        labels_applied: formData.labels_applied,
        passed_failed: formData.passed_failed,
        corrective_action_required: formData.corrective_action_required,
        issue_identified: formData.issue_identified,
        detection_method: formData.detection_method,
        product_involved: formData.product_involved,
        action_taken: formData.action_taken,
        disposed: formData.disposed,
        quantity_disposed: formData.quantity_disposed,
        preventive_steps: formData.preventive_steps,
        notes: formData.notes,
      });

      onSave();
    } catch (err) {
      setError(err.message || 'Failed to process batch');
      setLoading(false);
    }
  };

  const showCorrectiveFields = formData.corrective_action_required;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 overflow-y-auto"
      style={{ paddingTop: 'max(16px, env(safe-area-inset-top))', paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
    >
      <div className="relative bg-card rounded-xl shadow-2xl w-full max-w-2xl mx-4 my-4 flex flex-col max-h-[calc(100dvh-32px)]">

        {/* ── STICKY HEADER ── */}
        <div className="flex items-start justify-between p-5 border-b border-border shrink-0">
          <div>
            <div className="flex items-center gap-2">
              {mode === 'start' ? <Play className="h-4 w-4 text-primary" /> : null}
              <h2 className="text-lg font-semibold text-foreground">
                {mode === 'start' ? 'Run Batch' : 'Edit Batch'}
              </h2>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {batch.product_name} · {batch.batch_id} · {batch.production_date}
            </p>
            <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium ${
              batch.status === 'in_production' ? 'bg-yellow-100 text-yellow-700' :
              batch.status === 'planned' || batch.status === 'ready_for_production' ? 'bg-blue-50 text-blue-700' :
              'bg-muted text-muted-foreground'
            }`}>{batch.status?.replace(/_/g, ' ').toUpperCase()}</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 shrink-0">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── SCROLLABLE BODY ── */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">

          {isRetrospective && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 flex gap-2">
              <History className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
              <div>
                <p className="font-semibold">Retrospective Logging Mode</p>
                <p className="mt-0.5">This is a past production date ({batch.production_date}). Logging creates compliance records only — it will not affect delivery status or customer notifications.</p>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Batch Details */}
          <section className="bg-muted/30 rounded-lg p-4 grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Batch ID</p>
              <p className="text-sm font-medium">{batch.batch_id}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Product</p>
              <p className="text-sm font-medium">{batch.product_name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Category</p>
              <p className="text-sm font-medium capitalize">{batch.product_category || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Planned Qty</p>
              <p className="text-sm font-semibold text-primary">{batch.planned_units || '—'}</p>
            </div>
            {batch.actual_start_time && (
              <div>
                <p className="text-xs text-muted-foreground">Started</p>
                <p className="text-sm font-medium">{moment(batch.actual_start_time).format('MMM D, HH:mm')}</p>
              </div>
            )}
          </section>

          {/* Status + Assignment */}
          <section className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Status</label>
              <select
                value={formData.status}
                onChange={(e) => set('status', e.target.value)}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
              >
                <option value="planned">Planned</option>
                <option value="ready_for_production">Ready for Production</option>
                <option value="in_production">In Production</option>
                <option value="completed_pending_verification">Completed — Pending Verification</option>
                <option value="verified_logged">Verified & Logged</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Assigned To</label>
              <input
                type="text"
                value={formData.assigned_to}
                onChange={(e) => set('assigned_to', e.target.value)}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                placeholder="Staff member name"
              />
            </div>
          </section>

          {/* Production Output */}
          <section className="border-t pt-4 space-y-4">
            <h3 className="font-semibold text-sm">Production Output</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">
                  Actual Quantity Produced
                  <span className="text-xs text-muted-foreground ml-1">(defaults to planned: {batch.planned_units})</span>
                </label>
                <input
                  type="number"
                  value={formData.actual_quantity_produced}
                  onChange={(e) => set('actual_quantity_produced', e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                  placeholder={`${batch.planned_units || 'e.g. 24'}`}
                />
              </div>
              <div>
                <label className="text-sm font-medium">End Time</label>
                <input
                  type="datetime-local"
                  value={formData.actual_end_time}
                  onChange={(e) => set('actual_end_time', e.target.value)}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Bottles Produced</label>
                <input
                  type="number"
                  value={formData.bottles_produced}
                  onChange={(e) => set('bottles_produced', parseInt(e.target.value, 10) || '')}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                  placeholder="Count"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Bottles Rejected/Wasted</label>
                <input
                  type="number"
                  value={formData.bottles_rejected_or_wasted}
                  onChange={(e) => set('bottles_rejected_or_wasted', parseInt(e.target.value, 10) || '')}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Final Usable Quantity</label>
                <input
                  type="number"
                  value={formData.final_usable_quantity}
                  onChange={(e) => set('final_usable_quantity', parseInt(e.target.value, 10) || '')}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Storage Location</label>
                <input
                  type="text"
                  value={formData.storage_location}
                  onChange={(e) => set('storage_location', e.target.value)}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                  placeholder="e.g., Cold Room A"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Use By Date</label>
                <input
                  type="date"
                  value={formData.use_by_date}
                  onChange={(e) => set('use_by_date', e.target.value)}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                />
              </div>
            </div>
          </section>

          {/* Timing */}
          <section className="border-t pt-4 space-y-4">
            <h3 className="font-semibold text-sm">Timing</h3>
            <div className="grid grid-cols-2 gap-4">
              {isRetrospective && (
                <div className="col-span-2">
                  <label className="text-sm font-medium text-amber-700">Actual Start Time (Historical)</label>
                  <input
                    type="datetime-local"
                    value={formData.actual_start_time_override}
                    onChange={(e) => set('actual_start_time_override', e.target.value)}
                    className="mt-1 w-full p-2 border border-amber-300 rounded-lg bg-background text-sm"
                  />
                </div>
              )}
              <div>
                <label className="text-sm font-medium">Formula Mixed Time</label>
                <input type="time" value={formData.formula_mixed_time} onChange={(e) => set('formula_mixed_time', e.target.value)} className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm" />
              </div>
              <div>
                <label className="text-sm font-medium">Bottling Start Time</label>
                <input type="time" value={formData.bottling_start_time} onChange={(e) => set('bottling_start_time', e.target.value)} className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm" />
              </div>
              <div>
                <label className="text-sm font-medium">Time to Fridge</label>
                <input type="time" value={formData.refrigeration_time} onChange={(e) => set('refrigeration_time', e.target.value)} className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm" />
              </div>
            </div>
          </section>

          {/* Ingredients */}
          <section className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm flex items-center gap-1.5">
                <FlaskConical className="h-3.5 w-3.5 text-primary" /> Ingredients
              </h3>
              {recipe && !formulaOverridden && <span className="text-xs text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">Auto-filled from Formula</span>}
              {formulaOverridden && <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">Manual Override</span>}
              {recipeNotFound && <span className="text-xs text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">Formula Missing</span>}
              {recipeLoading && <span className="text-xs text-muted-foreground">Loading…</span>}
            </div>
            {formData.final_ingredients.length > 0 ? (
              <div className="bg-muted/30 rounded-lg p-3 space-y-1.5">
                {formData.final_ingredients.map((ing, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="font-medium">{ing.ingredient_name}</span>
                    <span className="text-muted-foreground text-xs">{ing.quantity_oz ? `${ing.quantity_oz} ${ing.unit || 'oz'}` : ''}{ing.notes ? ` · ${ing.notes}` : ''}</span>
                  </div>
                ))}
                {!formulaOverridden && (
                  <button type="button" onClick={() => { setFormulaOverridden(true); set('manual_ingredient_override', true); }} className="text-xs text-amber-600 hover:underline mt-1">
                    Edit ingredients (manual override)
                  </button>
                )}
              </div>
            ) : null}
            {(formulaOverridden || recipeNotFound) && (
              <textarea
                value={formData.ingredient_lot_notes}
                onChange={(e) => set('ingredient_lot_notes', e.target.value)}
                className={`w-full p-2 border ${recipeNotFound ? 'border-red-300' : 'border-amber-300'} rounded-lg bg-background h-16 resize-none text-sm`}
                placeholder={recipeNotFound ? 'Formula not found — manually enter ingredients' : 'Override ingredients here…'}
              />
            )}
            <div>
              <label className="text-xs text-muted-foreground font-medium">Ingredient Lot / Source Notes</label>
              <textarea
                value={formData.ingredient_lot_notes}
                onChange={(e) => set('ingredient_lot_notes', e.target.value)}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background h-12 resize-none text-sm"
                placeholder="Lot #, source farm, prep notes, deviations…"
              />
            </div>
          </section>

          {/* Staff & Equipment */}
          <section className="border-t pt-4 space-y-4">
            <h3 className="font-semibold text-sm">Staff & Equipment</h3>
            <div>
              <label className="text-sm font-medium">Staff on Duty</label>
              <div className="flex gap-2 mt-1">
                <input type="text" value={staffInput} onChange={(e) => setStaffInput(e.target.value)} placeholder="Add staff member" className="flex-1 p-2 border border-border rounded-lg bg-background text-sm"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddStaff(); } }} />
                <Button type="button" variant="outline" size="sm" onClick={handleAddStaff}>Add</Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {formData.staff_on_duty.map((s, i) => (
                  <div key={i} className="bg-primary/10 px-3 py-1 rounded-full text-sm flex items-center gap-2">
                    {s}<button type="button" onClick={() => handleRemoveStaff(i)} className="text-primary hover:text-primary/70">×</button>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Equipment Used</label>
              <div className="flex gap-2 mt-1">
                <input type="text" value={equipmentInput} onChange={(e) => setEquipmentInput(e.target.value)} placeholder="Add equipment" className="flex-1 p-2 border border-border rounded-lg bg-background text-sm"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddEquipment(); } }} />
                <Button type="button" variant="outline" size="sm" onClick={handleAddEquipment}>Add</Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {formData.equipment_used.map((eq, i) => (
                  <div key={i} className="bg-secondary/20 px-3 py-1 rounded-full text-sm flex items-center gap-2">
                    {eq}<button type="button" onClick={() => handleRemoveEquipment(i)} className="text-primary hover:text-primary/70">×</button>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Pre-op Checks */}
          <section className="border-t pt-4 space-y-2">
            <h3 className="font-semibold text-sm">Pre-Op Checks</h3>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={formData.pre_op_sanitation_confirmed} onChange={(e) => set('pre_op_sanitation_confirmed', e.target.checked)} className="w-4 h-4" />
              Pre-op sanitation confirmed
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={formData.refrigerator_temp_checked} onChange={(e) => set('refrigerator_temp_checked', e.target.checked)} className="w-4 h-4" />
              Refrigerator temp checked
            </label>
          </section>

          {/* Quality Check */}
          <section className="border-t pt-4 space-y-4">
            <h3 className="font-semibold text-sm">Quality Check</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">pH Result</label>
                <input type="number" step="0.1" min="0" max="14" value={formData.pH_result}
                  onChange={(e) => set('pH_result', parseFloat(e.target.value) || '')}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm" placeholder="0.0–14.0" />
              </div>
              <div>
                <label className="text-sm font-medium">pH Pass/Fail</label>
                <select value={formData.pH_passed_failed} onChange={(e) => set('pH_passed_failed', e.target.value)} className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm">
                  <option value="passed">Passed</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">pH Meter ID</label>
                <input type="text" value={formData.pH_meter_id} onChange={(e) => set('pH_meter_id', e.target.value)} className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm" placeholder="Meter ID" />
              </div>
              <div>
                <label className="text-sm font-medium">Batch Passed/Failed</label>
                <select value={formData.passed_failed} onChange={(e) => set('passed_failed', e.target.value)} className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm">
                  <option value="passed">Passed</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['calibration_checked', 'Calibration checked'],
                ['ccp_check_complete', 'CCP check complete'],
                ['sanitation_verification_complete', 'Sanitation verification complete'],
                ['labels_applied', 'Labels applied'],
                ['corrective_action_required', 'Corrective action required'],
              ].map(([field, label]) => (
                <label key={field} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={formData[field]} onChange={(e) => set(field, e.target.checked)} className="w-4 h-4" />
                  {label}
                </label>
              ))}
            </div>
          </section>

          {/* Corrective Action */}
          {showCorrectiveFields && (
            <section className="border-t border-red-200 bg-red-50/50 p-4 rounded-lg space-y-4">
              <h3 className="font-semibold text-sm text-red-700">Corrective Action Details</h3>
              <div>
                <label className="text-sm font-medium">Issue Identified *</label>
                <textarea value={formData.issue_identified} onChange={(e) => set('issue_identified', e.target.value)} className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm h-16 resize-none" placeholder="Description of issue" />
              </div>
              <div>
                <label className="text-sm font-medium">Action Taken *</label>
                <textarea value={formData.action_taken} onChange={(e) => set('action_taken', e.target.value)} className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm h-16 resize-none" placeholder="What was done to correct it" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Detection Method</label>
                  <input type="text" value={formData.detection_method} onChange={(e) => set('detection_method', e.target.value)} className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm" />
                </div>
                <div>
                  <label className="text-sm font-medium">Product Involved</label>
                  <input type="text" value={formData.product_involved} onChange={(e) => set('product_involved', e.target.value)} className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={formData.disposed} onChange={(e) => set('disposed', e.target.checked)} className="w-4 h-4" />
                Product disposed
              </label>
              {formData.disposed && (
                <input type="number" value={formData.quantity_disposed} onChange={(e) => set('quantity_disposed', parseInt(e.target.value, 10) || '')} className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm" placeholder="Quantity disposed" />
              )}
              <div>
                <label className="text-sm font-medium">Preventive Steps</label>
                <textarea value={formData.preventive_steps} onChange={(e) => set('preventive_steps', e.target.value)} className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm h-12 resize-none" placeholder="How will this be prevented?" />
              </div>
            </section>
          )}

          {/* Retrospective reason */}
          {isRetrospective && (
            <section className="border-t pt-4">
              <label className="text-sm font-medium text-amber-700">Retrospective Reason *</label>
              <textarea
                value={formData.retrospective_reason}
                onChange={(e) => set('retrospective_reason', e.target.value)}
                className="mt-1 w-full p-2 border border-amber-300 rounded-lg bg-background h-14 resize-none text-sm"
                placeholder="e.g. Production completed before logging workflow was active…"
              />
            </section>
          )}

          {/* Notes */}
          <section className="border-t pt-4">
            <label className="text-sm font-medium">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => set('notes', e.target.value)}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background h-16 resize-none text-sm"
              placeholder="Production notes…"
            />
          </section>
        </div>

        {/* ── STICKY FOOTER ── */}
        <div className="border-t border-border p-4 shrink-0 flex gap-3 bg-card">
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button type="button" variant="outline" onClick={handleSave} disabled={loading} className="flex-1 gap-1.5">
            <Save className="h-4 w-4" />
            {loading ? 'Saving…' : 'Save'}
          </Button>
          <Button
            type="button"
            onClick={handleProcess}
            disabled={loading}
            className={`flex-1 gap-1.5 ${isRetrospective ? 'bg-amber-600 hover:bg-amber-700' : ''}`}
          >
            <Play className="h-4 w-4" />
            {loading ? 'Processing…' : isRetrospective ? 'Log Batch' : 'Process Batch'}
          </Button>
        </div>
      </div>
    </div>
  );
}