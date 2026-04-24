import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Edit2, AlertTriangle, Check } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const PURCHASE_UNITS = ['each', 'bunch', 'lb', 'bag', 'bottle', 'case', 'carton', 'box', 'other'];
const ROUNDING_RULES = ['round_up_unit', 'round_up_case', 'exact'];

export default function YieldManager() {
  const [yields, setYields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState({
    ingredient_name: '',
    purchase_unit: 'each',
    oz_per_purchase_unit: '',
    units_per_case: '',
    trim_waste_factor: 1.0,
    split_case_allowed: true,
    rounding_rule: 'round_up_unit',
    supplier: '',
    notes: '',
  });

  useEffect(() => {
    loadYields();
  }, []);

  const loadYields = async () => {
    try {
      const data = await base44.entities.IngredientYield.list();
      setYields(data || []);
    } catch (error) {
      console.error('Load yields error:', error);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    if (!formData.ingredient_name || !formData.oz_per_purchase_unit) {
      alert('Ingredient name and yield per unit are required');
      return;
    }

    try {
      const payload = {
        ingredient_name: formData.ingredient_name,
        purchase_unit: formData.purchase_unit,
        oz_per_purchase_unit: parseFloat(formData.oz_per_purchase_unit),
        trim_waste_factor: parseFloat(formData.trim_waste_factor) || 1.0,
        split_case_allowed: formData.split_case_allowed,
        rounding_rule: formData.rounding_rule,
        supplier: formData.supplier || null,
        notes: formData.notes || null,
      };

      if (formData.units_per_case) {
        payload.units_per_case = parseFloat(formData.units_per_case);
      }

      if (editing) {
        await base44.entities.IngredientYield.update(editing.id, payload);
      } else {
        await base44.entities.IngredientYield.create(payload);
      }

      await loadYields();
      resetForm();
    } catch (error) {
      alert(`Save failed: ${error.message}`);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this yield config?')) return;
    try {
      await base44.entities.IngredientYield.delete(id);
      await loadYields();
    } catch (error) {
      alert(`Delete failed: ${error.message}`);
    }
  };

  const handleEdit = (y) => {
    setEditing(y);
    setFormData({
      ingredient_name: y.ingredient_name,
      purchase_unit: y.purchase_unit,
      oz_per_purchase_unit: y.oz_per_purchase_unit.toString(),
      units_per_case: y.units_per_case?.toString() || '',
      trim_waste_factor: y.trim_waste_factor || 1.0,
      split_case_allowed: y.split_case_allowed !== false,
      rounding_rule: y.rounding_rule || 'round_up_unit',
      supplier: y.supplier || '',
      notes: y.notes || '',
    });
  };

  const resetForm = () => {
    setEditing(null);
    setFormData({
      ingredient_name: '',
      purchase_unit: 'each',
      oz_per_purchase_unit: '',
      units_per_case: '',
      trim_waste_factor: 1.0,
      split_case_allowed: true,
      rounding_rule: 'round_up_unit',
      supplier: '',
      notes: '',
    });
  };

  if (loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Form */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h3 className="text-lg font-semibold text-foreground">
          {editing ? 'Edit Ingredient Yield' : 'Add New Ingredient Yield'}
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Ingredient Name *</label>
            <Input
              placeholder="e.g., Orange, Lemon, Kale"
              value={formData.ingredient_name}
              onChange={(e) => setFormData({ ...formData, ingredient_name: e.target.value })}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Purchase Unit *</label>
            <Select value={formData.purchase_unit} onValueChange={(v) => setFormData({ ...formData, purchase_unit: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PURCHASE_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Usable oz Per Unit *</label>
            <Input
              type="number"
              step="0.1"
              placeholder="e.g., 2.0"
              value={formData.oz_per_purchase_unit}
              onChange={(e) => setFormData({ ...formData, oz_per_purchase_unit: e.target.value })}
            />
            <p className="text-xs text-muted-foreground mt-1">Average usable oz from one purchase unit</p>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Units Per Case</label>
            <Input
              type="number"
              step="1"
              placeholder="e.g., 72"
              value={formData.units_per_case}
              onChange={(e) => setFormData({ ...formData, units_per_case: e.target.value })}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Trim/Waste Factor</label>
            <Input
              type="number"
              step="0.1"
              min="1"
              placeholder="1.0 (no waste), 1.1 (10% waste)"
              value={formData.trim_waste_factor}
              onChange={(e) => setFormData({ ...formData, trim_waste_factor: parseFloat(e.target.value) })}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Rounding Rule</label>
            <Select value={formData.rounding_rule} onValueChange={(v) => setFormData({ ...formData, rounding_rule: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROUNDING_RULES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Supplier</label>
            <Input
              placeholder="e.g., Local Produce Co."
              value={formData.supplier}
              onChange={(e) => setFormData({ ...formData, supplier: e.target.value })}
            />
          </div>

          <div className="flex items-end">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.split_case_allowed}
                onChange={(e) => setFormData({ ...formData, split_case_allowed: e.target.checked })}
              />
              <span className="text-xs font-medium text-muted-foreground">Split cases allowed</span>
            </label>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes</label>
          <Input
            placeholder="e.g., Order by Tuesday for Friday delivery"
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          />
        </div>

        <div className="flex gap-2 justify-end">
          {editing && (
            <Button variant="outline" onClick={resetForm}>
              Cancel
            </Button>
          )}
          <Button onClick={handleSave}>
            {editing ? 'Update' : 'Add'} Ingredient
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-foreground">Configured Yields ({yields.length})</h3>
        <div className="space-y-2">
          {yields.length === 0 ? (
            <div className="bg-muted/30 border border-border rounded-lg p-4 text-center text-sm text-muted-foreground">
              No ingredients configured. Add one above.
            </div>
          ) : (
            yields.map((y) => (
              <div key={y.id} className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="font-semibold text-foreground">{y.ingredient_name}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2 text-xs text-muted-foreground">
                      <div>
                        <span className="text-foreground font-medium">{y.oz_per_purchase_unit} oz</span>
                        <p>per {y.purchase_unit}</p>
                      </div>
                      {y.units_per_case && (
                        <div>
                          <span className="text-foreground font-medium">{y.units_per_case}</span>
                          <p>per case</p>
                        </div>
                      )}
                      {y.trim_waste_factor > 1 && (
                        <div>
                          <span className="text-foreground font-medium">{y.trim_waste_factor}x</span>
                          <p>waste factor</p>
                        </div>
                      )}
                      {y.supplier && (
                        <div>
                          <span className="text-foreground font-medium">{y.supplier}</span>
                          <p>supplier</p>
                        </div>
                      )}
                    </div>
                    {y.notes && <p className="text-xs text-muted-foreground mt-2">📝 {y.notes}</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleEdit(y)}
                      className="h-8 w-8"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleDelete(y.id)}
                      className="h-8 w-8 text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}