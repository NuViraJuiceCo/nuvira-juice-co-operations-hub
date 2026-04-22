import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function RecipeManager() {
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    base44.entities.Recipe.list().then(data => {
      setRecipes(data);
      setLoading(false);
    });
  }, []);

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this recipe?")) return;
    await base44.entities.Recipe.delete(id);
    setRecipes(recipes.filter(r => r.id !== id));
  };

  const toggleExpand = (id) => setExpandedId(expandedId === id ? null : id);

  if (loading) return <div className="flex justify-center py-12"><div className="w-6 h-6 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">These recipes define how much of each ingredient goes into one bottle. They are used to calculate purchase needs from orders.</p>
      </div>

      <div className="space-y-3">
        {recipes.map(recipe => (
          <div key={recipe.id} className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{recipe.product_name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {recipe.bottle_size_oz}oz bottle · {recipe.ingredients?.length || 0} ingredients · {recipe.yield_factor ? `${((recipe.yield_factor - 1) * 100).toFixed(0)}% buffer` : 'no buffer'}
                  </p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${recipe.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
                  {recipe.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleDelete(recipe.id)} className="text-red-400 hover:text-red-600 p-1">
                  <Trash2 className="h-4 w-4" />
                </button>
                <button onClick={() => toggleExpand(recipe.id)} className="text-muted-foreground hover:text-foreground p-1">
                  {expandedId === recipe.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {expandedId === recipe.id && (
              <div className="border-t border-border px-5 py-4 bg-muted/20">
                {recipe.notes && (
                  <p className="text-xs text-muted-foreground italic mb-3">📝 {recipe.notes}</p>
                )}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="text-left pb-2">Ingredient</th>
                      <th className="text-right pb-2">Per Bottle (oz)</th>
                      <th className="text-right pb-2">Per Bottle (g)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(recipe.ingredients || []).map((ing, i) => (
                      <tr key={i} className="border-t border-border/30">
                        <td className="py-1.5 font-medium capitalize">{ing.ingredient_name}</td>
                        <td className="py-1.5 text-right font-mono text-foreground">{ing.quantity_oz}</td>
                        <td className="py-1.5 text-right font-mono text-muted-foreground">{(ing.quantity_oz * 28.3495).toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-border font-semibold">
                      <td className="pt-2 text-foreground">Total</td>
                      <td className="pt-2 text-right font-mono text-foreground">
                        {(recipe.ingredients || []).reduce((s, i) => s + (i.quantity_oz || 0), 0).toFixed(2)}
                      </td>
                      <td className="pt-2 text-right font-mono text-muted-foreground">
                        {((recipe.ingredients || []).reduce((s, i) => s + (i.quantity_oz || 0), 0) * 28.3495).toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>

      {recipes.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm">No recipes yet. Add your first recipe to get started.</p>
        </div>
      )}
    </div>
  );
}