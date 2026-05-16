import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { X, AlertCircle, History, FlaskConical } from 'lucide-react';
import moment from 'moment';
import { useProductFormula } from '@/hooks/useProductFormula';

export default function BatchStartForm({ batch, onClose, onSave }) {
  const today = moment().format('YYYY-MM-DD');
  const isRetrospective = batch.production_date < today;

  const { recipe, formulaSummary, loading: recipeLoading, notFound: recipeNotFound } = useProductFormula(batch.product_name);
  const [formulaOverridden, setFormulaOverridden] = useState(false);

  // Default start time: 9:00 PM on the production date (or today if not retrospective)
  const defaultStartTime = isRetrospective
    ? `${batch.production_date}T21:00`
    : `${batch.production_date}T21:00`;

  const STAFF_OPTIONS = ['Kirandeep Gill', 'Kiran Kahlon', 'Amar Kahlon'];
  const EQUIPMENT_OPTIONS = ['Nama J2'];

  const [formData, setFormData] = useState({
    staff_on_duty: batch.staff_on_duty || [],
    equipment_used: batch.equipment_used || [],
    pre_op_sanitation_confirmed: false,
    refrigerator_temp_checked: false,
    notes: '',
    retrospective_reason: '',
    actual_start_time_override: isRetrospective ? defaultStartTime : defaultStartTime,
    ingredients_notes: batch.ingredient_lot_notes || '',
    final_ingredients: batch.ingredients_used || [],
    manual_ingredient_override: false,
    pH_result: '',
    formula_mixed_time: '',
    bottling_start_time: '',
    refrigeration_time: '',
  });

  // Auto-fill formula ingredients once recipe loads
  useEffect(() => {
    if (recipe && !formulaOverridden && !batch.ingredients_used?.length) {
      setFormData(prev => ({
        ...prev,
        final_ingredients: recipe.ingredients || [],
      }));
    }
  }, [recipe]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [staffInput, setStaffInput] = useState('');
  const [equipmentInput, setEquipmentInput] = useState('');

  const handleAddStaff = () => {
    if (staffInput.trim()) {
      setFormData(prev => ({
        ...prev,
        staff_on_duty: [...prev.staff_on_duty, staffInput.trim()],
      }));
      setStaffInput('');
    }
  };

  const handleAddEquipment = () => {
    if (equipmentInput.trim()) {
      setFormData(prev => ({
        ...prev,
        equipment_used: [...prev.equipment_used, equipmentInput.trim()],
      }));
      setEquipmentInput('');
    }
  };

  const handleRemoveStaff = (idx) => {
    setFormData(prev => ({
      ...prev,
      staff_on_duty: prev.staff_on_duty.filter((_, i) => i !== idx),
    }));
  };

  const handleRemoveEquipment = (idx) => {
    setFormData(prev => ({
      ...prev,
      equipment_used: prev.equipment_used.filter((_, i) => i !== idx),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isRetrospective && !formData.retrospective_reason.trim()) {
      setError('A reason is required for retrospective batch logging.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await base44.functions.invoke('startBatchProduction', {
        batch_id: batch.batch_id,
        ...formData,
        ingredient_lot_notes: formData.ingredients_notes,
        final_ingredients: formData.final_ingredients,
        default_formula_ingredients: recipe?.ingredients || [],
        manual_ingredient_override: formData.manual_ingredient_override || false,
        actual_start_time_override: formData.actual_start_time_override
          ? new Date(formData.actual_start_time_override).toISOString()
          : undefined,
      });
      onSave();
    } catch (err) {
      setError(err.message || 'Failed to start batch');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-card rounded-xl shadow-lg max-w-lg w-full p-6 my-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Start Batch Production</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isRetrospective && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 flex gap-2">
            <History className="h-4 w-4 flex-shrink-0 mt-0.5 text-amber-600" />
            <div>
              <p className="font-semibold">Retrospective Logging Mode</p>
              <p className="mt-0.5">This batch is for a past production date ({batch.production_date}). Logging will create compliance records only — it will <strong>not</strong> affect delivery status, Driver Portal, or customer notifications.</p>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Batch Details */}
          <div className="bg-muted/30 rounded-lg p-3 space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Batch Details</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Batch ID</p>
                <p className="text-sm font-medium">{batch.batch_id}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Juice / Product</p>
                <p className="text-sm font-medium">{batch.product_name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Category</p>
                <p className="text-sm font-medium capitalize">{batch.product_category || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Planned Quantity</p>
                <p className="text-sm font-medium">{batch.planned_units || '—'}</p>
              </div>
            </div>
          </div>

          {/* Formula / Ingredients */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <FlaskConical className="h-3.5 w-3.5 text-primary" />
                Ingredients
              </label>
              {recipe && !formulaOverridden && (
                <span className="text-xs text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                  Auto-filled from Product Formula
                </span>
              )}
              {formulaOverridden && (
                <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                  Manual Override
                </span>
              )}
              {recipeNotFound && (
                <span className="text-xs text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                  Formula Missing — Enter Ingredients
                </span>
              )}
              {recipeLoading && (
                <span className="text-xs text-muted-foreground">Loading formula…</span>
              )}
            </div>

            {/* Ingredient list from recipe */}
            {formData.final_ingredients.length > 0 ? (
              <div className="bg-muted/30 rounded-lg p-3 space-y-1.5">
                {formData.final_ingredients.map((ing, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="font-medium">{ing.ingredient_name}</span>
                    <span className="text-muted-foreground text-xs">
                      {ing.quantity_oz ? `${ing.quantity_oz} ${ing.unit || 'oz'}` : ''}
                      {ing.notes ? ` · ${ing.notes}` : ''}
                    </span>
                  </div>
                ))}
                {!formulaOverridden && (
                  <button
                    type="button"
                    onClick={() => { setFormulaOverridden(true); setFormData(prev => ({ ...prev, manual_ingredient_override: true })); }}
                    className="text-xs text-amber-600 hover:underline mt-1"
                  >
                    Edit ingredients (manual override)
                  </button>
                )}
              </div>
            ) : recipeNotFound ? (
              <textarea
                value={formData.ingredients_notes}
                onChange={(e) => setFormData(prev => ({ ...prev, ingredients_notes: e.target.value }))}
                className="w-full p-2 border border-red-300 rounded-lg bg-background text-foreground h-16 resize-none text-sm"
                placeholder="Formula not found — manually enter ingredients (e.g. Apple, Ginger, Lemon)"
              />
            ) : null}

            {formulaOverridden && (
              <textarea
                value={formData.ingredients_notes}
                onChange={(e) => setFormData(prev => ({ ...prev, ingredients_notes: e.target.value }))}
                className="w-full p-2 border border-amber-300 rounded-lg bg-background text-foreground h-16 resize-none text-sm"
                placeholder="Override ingredients here…"
              />
            )}

            <div>
              <label className="text-xs text-muted-foreground font-medium">Ingredient Lot / Source Notes</label>
              <textarea
                value={formData.ingredients_notes}
                onChange={(e) => setFormData(prev => ({ ...prev, ingredients_notes: e.target.value }))}
                className="mt-1 w-full p-2 border border-border rounded-lg bg-background h-12 resize-none text-sm"
                placeholder="Lot #, source farm, prep notes, deviations…"
              />
            </div>
          </div>

          {/* Start time — always shown, defaults to 9 PM */}
          <div>
            <label className="text-sm font-medium">
              {isRetrospective ? 'Actual Start Time (Historical)' : 'Batch Start Time'}
              {isRetrospective && <span className="text-amber-600 ml-1">*</span>}
            </label>
            <input
              type="datetime-local"
              value={formData.actual_start_time_override}
              onChange={(e) => setFormData(prev => ({ ...prev, actual_start_time_override: e.target.value }))}
              className={`mt-1 w-full p-2 border rounded-lg bg-background text-foreground text-sm ${isRetrospective ? 'border-amber-300' : 'border-border'}`}
            />
            {!isRetrospective && (
              <p className="text-xs text-muted-foreground mt-1">Default: 9:00 PM. Adjust if production starts at a different time.</p>
            )}
          </div>

          {isRetrospective && (
            <div>
              <label className="text-sm font-medium text-amber-700">Retrospective Reason <span className="text-red-500">*</span></label>
              <textarea
                value={formData.retrospective_reason}
                onChange={(e) => setFormData(prev => ({ ...prev, retrospective_reason: e.target.value }))}
                className="mt-1 w-full p-2 border border-amber-300 rounded-lg bg-background text-foreground h-14 resize-none text-sm"
                placeholder="e.g. May 1 production was completed before batch logging workflow was active. Logging for compliance accuracy."
                required
              />
            </div>
          )}

          <div>
            <label className="text-sm font-medium">Staff on Duty</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {STAFF_OPTIONS.map(name => {
                const selected = formData.staff_on_duty.includes(name);
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setFormData(prev => ({
                      ...prev,
                      staff_on_duty: selected
                        ? prev.staff_on_duty.filter(s => s !== name)
                        : [...prev.staff_on_duty, name],
                    }))}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      selected
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-foreground border-border hover:bg-muted'
                    }`}
                  >
                    {selected ? '✓ ' : ''}{name}
                  </button>
                );
              })}
            </div>
            {/* Free-text for additional staff */}
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                value={staffInput}
                onChange={(e) => setStaffInput(e.target.value)}
                placeholder="Add other staff..."
                className="flex-1 p-2 border border-border rounded-lg bg-background text-foreground text-sm"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddStaff(); } }}
              />
              <Button type="button" variant="outline" size="sm" onClick={handleAddStaff}>Add</Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {formData.staff_on_duty.filter(s => !STAFF_OPTIONS.includes(s)).map((staff, idx) => (
                <div key={idx} className="bg-primary/10 text-primary px-3 py-1 rounded-full text-sm flex items-center gap-2">
                  {staff}
                  <button type="button" onClick={() => handleRemoveStaff(formData.staff_on_duty.indexOf(staff))} className="hover:opacity-70">×</button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Equipment Used</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {EQUIPMENT_OPTIONS.map(eq => {
                const selected = formData.equipment_used.includes(eq);
                return (
                  <button
                    key={eq}
                    type="button"
                    onClick={() => setFormData(prev => ({
                      ...prev,
                      equipment_used: selected
                        ? prev.equipment_used.filter(e => e !== eq)
                        : [...prev.equipment_used, eq],
                    }))}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      selected
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-foreground border-border hover:bg-muted'
                    }`}
                  >
                    {selected ? '✓ ' : ''}{eq}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                value={equipmentInput}
                onChange={(e) => setEquipmentInput(e.target.value)}
                placeholder="Add other equipment..."
                className="flex-1 p-2 border border-border rounded-lg bg-background text-foreground text-sm"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddEquipment(); } }}
              />
              <Button type="button" variant="outline" size="sm" onClick={handleAddEquipment}>Add</Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {formData.equipment_used.filter(e => !EQUIPMENT_OPTIONS.includes(e)).map((eq, idx) => (
                <div key={idx} className="bg-secondary/20 text-foreground px-3 py-1 rounded-full text-sm flex items-center gap-2">
                  {eq}
                  <button type="button" onClick={() => handleRemoveEquipment(formData.equipment_used.indexOf(eq))} className="hover:opacity-70">×</button>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={formData.pre_op_sanitation_confirmed}
                onChange={(e) => setFormData(prev => ({ ...prev, pre_op_sanitation_confirmed: e.target.checked }))}
                className="w-4 h-4"
              />
              Pre-op sanitation confirmed
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={formData.refrigerator_temp_checked}
                onChange={(e) => setFormData(prev => ({ ...prev, refrigerator_temp_checked: e.target.checked }))}
                className="w-4 h-4"
              />
              Refrigerator temp checked
            </label>
          </div>

          <div className="border-t pt-4 space-y-4">
            <h3 className="font-semibold text-sm">Quality & Timing</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">pH Result</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="14"
                  value={formData.pH_result}
                  onChange={(e) => setFormData(prev => ({ ...prev, pH_result: parseFloat(e.target.value) || '' }))}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                  placeholder="0.0 – 14.0"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Formula Mixed Time</label>
                <input
                  type="time"
                  value={formData.formula_mixed_time}
                  onChange={(e) => setFormData(prev => ({ ...prev, formula_mixed_time: e.target.value }))}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Bottling Start Time</label>
                <input
                  type="time"
                  value={formData.bottling_start_time}
                  onChange={(e) => setFormData(prev => ({ ...prev, bottling_start_time: e.target.value }))}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Time to Fridge</label>
                <input
                  type="time"
                  value={formData.refrigeration_time}
                  onChange={(e) => setFormData(prev => ({ ...prev, refrigeration_time: e.target.value }))}
                  className="mt-1 w-full p-2 border border-border rounded-lg bg-background text-sm"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              className="mt-1 w-full p-2 border border-border rounded-lg bg-background h-16 resize-none text-sm"
              placeholder="Production start notes..."
            />
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className={`flex-1 ${isRetrospective ? 'bg-amber-600 hover:bg-amber-700' : ''}`}>
              {loading ? 'Starting...' : isRetrospective ? '📦 Log Retrospective Batch' : 'Start Batch'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}