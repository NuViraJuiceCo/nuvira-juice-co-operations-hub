import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Scale, Plus, Trash2, Check, X, Edit2 } from "lucide-react";

const PURCHASE_UNITS = ['each', 'bunch', 'lb', 'bag', 'bottle', 'case', 'carton', 'box', 'other'];
const ROUNDING_RULES = [
  { value: 'round_up_unit', label: 'Round up to whole unit' },
  { value: 'round_up_case', label: 'Round up to full case' },
  { value: 'exact', label: 'Exact (no rounding)' },
];

function YieldRow({ item, onSave, onDelete }) {
  const [editing, setEditing] = useState(!item.id);
  const [form, setForm] = useState({ ...item });
  const [saving, setSaving] = useState(false);

  const set = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    if (!form.ingredient_name || !form.purchase_unit || !form.oz_per_purchase_unit) return;
    setSaving(true);
    if (form.id) {
      await base44.entities.IngredientYield.update(form.id, form);
    } else {
      await base44.entities.IngredientYield.create(form);
    }
    setSaving(false);
    setEditing(false);
    onSave();
  };

  const handleCancel = () => {
    if (!item.id) { onDelete(); return; }
    setForm({ ...item });
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-3 px-3 py-2.5 border border-border rounded-lg bg-card hover:bg-muted/20">
        <div className="flex-1 min-w-0">
          <span className="font-medium text-sm text-foreground">{item.ingredient_name}</span>
          <span className="text-xs text-muted-foreground ml-2">
            {item.oz_per_purchase_unit} oz per {item.purchase_unit}
            {item.units_per_case ? ` · ${item.units_per_case}/${item.purchase_unit === 'case' ? 'case' : 'case'}` : ''}
            {item.supplier ? ` · ${item.supplier}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {ROUNDING_RULES.find(r => r.value === item.rounding_rule)?.label || item.rounding_rule || 'Round up unit'}
          </span>
          <button onClick={() => setEditing(true)} className="text-primary hover:text-primary/80 p-1">
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => onDelete(item.id)} className="text-red-400 hover:text-red-600 p-1">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-primary/30 rounded-lg p-3 bg-primary/5 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div className="sm:col-span-1">
          <label className="text-xs text-muted-foreground font-medium block mb-1">Ingredient Name *</label>
          <input
            type="text"
            value={form.ingredient_name || ''}
            onChange={e => set('ingredient_name', e.target.value)}
            placeholder="e.g. Pineapple"
            className="w-full text-sm p-1.5 border border-border rounded-md bg-background"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-medium block mb-1">Purchase Unit *</label>
          <select
            value={form.purchase_unit || 'each'}
            onChange={e => set('purchase_unit', e.target.value)}
            className="w-full text-sm p-1.5 border border-border rounded-md bg-background"
          >
            {PURCHASE_UNITS.map(u => <option key={u}>{u}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-medium block mb-1">Usable oz per unit *</label>
          <input
            type="number"
            value={form.oz_per_purchase_unit || ''}
            onChange={e => set('oz_per_purchase_unit', parseFloat(e.target.value) || 0)}
            placeholder="e.g. 28"
            step="0.5"
            min="0"
            className="w-full text-sm p-1.5 border border-border rounded-md bg-background"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-medium block mb-1">Units per Case</label>
          <input
            type="number"
            value={form.units_per_case || ''}
            onChange={e => set('units_per_case', parseFloat(e.target.value) || null)}
            placeholder="e.g. 6"
            min="1"
            className="w-full text-sm p-1.5 border border-border rounded-md bg-background"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-medium block mb-1">Trim/Waste Factor</label>
          <input
            type="number"
            value={form.trim_waste_factor || 1.0}
            onChange={e => set('trim_waste_factor', parseFloat(e.target.value) || 1.0)}
            placeholder="e.g. 1.1"
            step="0.05"
            min="1"
            max="2"
            className="w-full text-sm p-1.5 border border-border rounded-md bg-background"
          />
          <span className="text-xs text-muted-foreground">1.0 = no waste</span>
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-medium block mb-1">Rounding Rule</label>
          <select
            value={form.rounding_rule || 'round_up_unit'}
            onChange={e => set('rounding_rule', e.target.value)}
            className="w-full text-sm p-1.5 border border-border rounded-md bg-background"
          >
            {ROUNDING_RULES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-medium block mb-1">Supplier</label>
          <input
            type="text"
            value={form.supplier || ''}
            onChange={e => set('supplier', e.target.value)}
            placeholder="e.g. Restaurant Depot"
            className="w-full text-sm p-1.5 border border-border rounded-md bg-background"
          />
        </div>
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={form.split_case_allowed !== false}
              onChange={e => set('split_case_allowed', e.target.checked)}
              className="rounded"
            />
            <span className="text-xs text-foreground">Split case allowed</span>
          </label>
        </div>
        <div className="sm:col-span-1">
          <label className="text-xs text-muted-foreground font-medium block mb-1">Notes</label>
          <input
            type="text"
            value={form.notes || ''}
            onChange={e => set('notes', e.target.value)}
            placeholder="e.g. Order Tue for Fri delivery"
            className="w-full text-sm p-1.5 border border-border rounded-md bg-background"
          />
        </div>
      </div>
      <div className="flex gap-2 pt-1 border-t border-border">
        <Button onClick={handleSave} disabled={saving} size="sm" className="gap-1.5">
          <Check className="h-3.5 w-3.5" />
          {saving ? 'Saving...' : 'Save'}
        </Button>
        <Button onClick={handleCancel} variant="outline" size="sm" className="gap-1.5">
          <X className="h-3.5 w-3.5" />
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default function IngredientYieldEditor({ onSaved }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newItem, setNewItem] = useState(null);

  const load = async () => {
    const data = await base44.entities.IngredientYield.list();
    setItems(data.sort((a, b) => a.ingredient_name.localeCompare(b.ingredient_name)));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id) => {
    if (!id) { setNewItem(null); return; }
    await base44.entities.IngredientYield.delete(id);
    load();
  };

  const handleSaved = () => {
    setNewItem(null);
    load();
    if (onSaved) onSaved();
  };

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${open ? 'bg-muted/60' : 'bg-muted/30 hover:bg-muted/50'}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Scale className="h-4 w-4 text-primary" />
            Yield & Pack Conversion Editor
          </span>
          <span className="text-xs text-muted-foreground">{items.length} ingredients configured</span>
          {items.length === 0 && (
            <span className="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full font-medium">Setup needed</span>
          )}
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="p-4 space-y-2">
          <p className="text-xs text-muted-foreground mb-3">
            Define usable oz per unit, case sizes, and rounding rules. This enables the system to convert ingredient demand into practical purchase quantities (e.g. "5 pineapples, 1 case").
          </p>

          {loading ? (
            <div className="flex justify-center py-4">
              <div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {items.map(item => (
                <YieldRow key={item.id} item={item} onSave={handleSaved} onDelete={handleDelete} />
              ))}
              {newItem && (
                <YieldRow item={newItem} onSave={handleSaved} onDelete={() => setNewItem(null)} />
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setNewItem({ ingredient_name: '', purchase_unit: 'each', oz_per_purchase_unit: 0, trim_waste_factor: 1.0, rounding_rule: 'round_up_unit', split_case_allowed: true })}
                className="mt-2 gap-1.5 text-xs"
                disabled={!!newItem}
              >
                <Plus className="h-3.5 w-3.5" />
                Add Ingredient Yield Config
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}