import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Plus, Trash2, Save, FlaskConical, Edit2, Check, X } from "lucide-react";

const UNITS = ['oz', 'g', 'lbs', 'ml', 'L', 'count', 'bunch', 'tsp', 'tbsp', 'pinch'];

function IngredientRow({ ing, index, onChange, onDelete }) {
  return (
    <div className="flex gap-2 items-center">
      <input
        type="text"
        value={ing.ingredient_name || ''}
        onChange={e => onChange(index, 'ingredient_name', e.target.value)}
        placeholder="Ingredient name"
        className="flex-1 text-sm p-1.5 border border-border rounded-md bg-background"
      />
      <input
        type="number"
        value={ing.quantity_oz || ''}
        onChange={e => onChange(index, 'quantity_oz', parseFloat(e.target.value) || 0)}
        placeholder="Qty"
        className="w-20 text-sm p-1.5 border border-border rounded-md bg-background"
        step="0.1"
        min="0"
      />
      <select
        value={ing.unit || 'oz'}
        onChange={e => onChange(index, 'unit', e.target.value)}
        className="w-20 text-sm p-1.5 border border-border rounded-md bg-background"
      >
        {UNITS.map(u => <option key={u}>{u}</option>)}
      </select>
      <button onClick={() => onDelete(index)} className="text-red-400 hover:text-red-600 p-1">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function RecipeCard({ recipe, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [ingredients, setIngredients] = useState(recipe.ingredients || []);
  const [yieldFactor, setYieldFactor] = useState(recipe.yield_factor || 1.05);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  const handleIngredientChange = (index, field, value) => {
    setIngredients(prev => prev.map((ing, i) => i === index ? { ...ing, [field]: value } : ing));
  };

  const handleAddIngredient = () => {
    setIngredients(prev => [...prev, { ingredient_name: '', quantity_oz: 0, unit: 'oz', notes: '' }]);
  };

  const handleDeleteIngredient = (index) => {
    setIngredients(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSaving(true);
    await base44.entities.Recipe.update(recipe.id, {
      ingredients,
      yield_factor: yieldFactor,
    });
    setSaving(false);
    setEditing(false);
    onSaved();
  };

  const handleCancel = () => {
    setIngredients(recipe.ingredients || []);
    setYieldFactor(recipe.yield_factor || 1.05);
    setEditing(false);
  };

  const ingCount = recipe.ingredients?.length || 0;

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-3 bg-muted/20 hover:bg-muted/40 cursor-pointer"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm text-foreground">{recipe.product_name}</span>
          <span className="text-xs text-muted-foreground">
            {ingCount > 0 ? `${ingCount} ingredients` : 'No ingredients yet'}
          </span>
          {ingCount === 0 && (
            <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">Setup needed</span>
          )}
        </div>
        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
          {!editing && (
            <button
              onClick={() => { setOpen(true); setEditing(true); }}
              className="text-primary hover:text-primary/80 p-1"
              title="Edit recipe"
            >
              <Edit2 className="h-3.5 w-3.5" />
            </button>
          )}
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </div>

      {open && (
        <div className="p-4 space-y-3">
          {!editing && ingCount === 0 && (
            <p className="text-sm text-muted-foreground italic">No ingredients defined. Click Edit to add ingredients.</p>
          )}

          {!editing && ingCount > 0 && (
            <div className="space-y-1">
              <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground font-medium mb-1 px-1">
                <span>Ingredient</span><span>Per Bottle</span><span>Unit</span>
              </div>
              {(recipe.ingredients || []).map((ing, i) => (
                <div key={i} className="grid grid-cols-3 gap-2 text-sm px-1 py-1 rounded hover:bg-muted/20">
                  <span>{ing.ingredient_name}</span>
                  <span>{ing.quantity_oz}</span>
                  <span className="text-muted-foreground">{ing.unit || 'oz'}</span>
                </div>
              ))}
              <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border">
                Yield factor: {yieldFactor}× · Bottle size: {recipe.bottle_size_oz || 12}oz
              </p>
            </div>
          )}

          {editing && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Yield factor:</label>
                <input
                  type="number"
                  value={yieldFactor}
                  onChange={e => setYieldFactor(parseFloat(e.target.value) || 1.0)}
                  step="0.01"
                  min="1"
                  max="2"
                  className="w-24 text-sm p-1.5 border border-border rounded-md bg-background"
                />
                <span className="text-xs text-muted-foreground">(e.g. 1.05 = 5% waste buffer)</span>
              </div>

              <div>
                <div className="grid grid-cols-[1fr_80px_80px_32px] gap-2 text-xs text-muted-foreground font-medium mb-2 px-1">
                  <span>Ingredient</span><span>Qty / bottle</span><span>Unit</span><span></span>
                </div>
                <div className="space-y-2">
                  {ingredients.map((ing, i) => (
                    <IngredientRow
                      key={i}
                      ing={ing}
                      index={i}
                      onChange={handleIngredientChange}
                      onDelete={handleDeleteIngredient}
                    />
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddIngredient}
                  className="mt-2 gap-1.5 text-xs"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Ingredient
                </Button>
              </div>

              <div className="flex gap-2 pt-2 border-t border-border">
                <Button onClick={handleSave} disabled={saving} size="sm" className="gap-1.5">
                  <Check className="h-3.5 w-3.5" />
                  {saving ? 'Saving...' : 'Save Recipe'}
                </Button>
                <Button onClick={handleCancel} variant="outline" size="sm" className="gap-1.5">
                  <X className="h-3.5 w-3.5" />
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RecipeEditor({ onRecipeSaved }) {
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const loadRecipes = async () => {
    const data = await base44.entities.Recipe.list();
    setRecipes(data.filter(r => r.is_active !== false));
    setLoading(false);
  };

  useEffect(() => { loadRecipes(); }, []);

  const handleSaved = () => {
    loadRecipes();
    if (onRecipeSaved) onRecipeSaved();
  };

  const missingIngredients = recipes.filter(r => !r.ingredients || r.ingredients.length === 0);

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
          open ? 'bg-muted/60' : 'bg-muted/30 hover:bg-muted/50'
        }`}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <FlaskConical className="h-4 w-4 text-primary" />
            Recipe Editor
          </span>
          <span className="text-xs text-muted-foreground">{recipes.length} recipes</span>
          {missingIngredients.length > 0 && (
            <span className="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full font-medium">
              {missingIngredients.length} need setup
            </span>
          )}
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="p-4 space-y-3">
          {loading ? (
            <div className="flex justify-center py-4">
              <div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" />
            </div>
          ) : recipes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No recipes found. Add products first.</p>
          ) : (
            recipes.map(recipe => (
              <RecipeCard key={recipe.id} recipe={recipe} onSaved={handleSaved} />
            ))
          )}
        </div>
      )}
    </div>
  );
}