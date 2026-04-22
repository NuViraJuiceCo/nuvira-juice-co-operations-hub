import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const items = await base44.entities.InventoryItem.list("-updated_date", 500);
    
    const updates = [];
    for (const item of items) {
      let newCategory = item.category;
      const ingredientLower = (item.ingredient || '').toLowerCase();

      // Change Citrus to Produce
      if (item.category === 'Citrus') {
        newCategory = 'Produce';
      }

      // Change packaging items to Packaging
      if (ingredientLower.includes('bottle') || 
          ingredientLower.includes('label') || 
          ingredientLower.includes('delivery bag') || 
          ingredientLower.includes('small bag') || 
          ingredientLower.includes('tote bag')) {
        newCategory = 'Packaging';
      }

      // Update if category changed
      if (newCategory !== item.category) {
        updates.push(base44.entities.InventoryItem.update(item.id, { category: newCategory }));
      }
    }

    await Promise.all(updates);
    return Response.json({ success: true, updated: updates.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});