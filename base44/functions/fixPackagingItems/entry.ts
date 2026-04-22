import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get all current packaging items
    const allItems = await base44.entities.InventoryItem.list('-updated_date', 500);
    const packagingItems = allItems.filter(i => i.category === 'Packaging');

    // Define corrections needed
    const corrections = [
      { current: '2oz Bottles', correct: '8oz Bottles' },
      { current: '12oz Bottles', correct: '12oz Bottles' },
      { current: '32oz Bottles', correct: '32oz Bottles' },
      { current: '12oz Labels - Aura', correct: '12oz Labels - Aura' },
      { current: '12oz Labels - Re-Nu', correct: '12oz Labels - Re-Nu' },
      { current: '12oz Labels - Oasis', correct: '12oz Labels - Oasis' },
    ];

    const updated = [];

    for (const item of packagingItems) {
      const correction = corrections.find(c => c.current.toLowerCase() === item.ingredient?.toLowerCase());
      if (correction && correction.current !== correction.correct) {
        await base44.entities.InventoryItem.update(item.id, {
          ingredient: correction.correct
        });
        updated.push({ from: item.ingredient, to: correction.correct });
      }
    }

    return Response.json({
      message: `Updated ${updated.length} items`,
      updates: updated
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});