import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Fetch all packaging items
    const allItems = await base44.entities.InventoryItem.list('-updated_date', 500);
    const packagingItems = allItems.filter(i => i.category === 'Packaging');

    // Define the approved items we want to keep
    const approvedItems = [
      { name: '12oz Bottles', unit: 'units' },
      { name: '8oz Bottles', unit: 'units' },
      { name: '32oz Bottles', unit: 'units' },
      { name: '12oz Labels - Aura', unit: 'units' },
      { name: '12oz Labels - Re-Nu', unit: 'units' },
      { name: '12oz Labels - Oasis', unit: 'units' },
      { name: 'Caps (Black)', unit: 'units' },
      { name: 'Tote Bags', unit: 'units' },
      { name: 'Small Bags', unit: 'units' },
    ];

    const deletedIds = [];

    // Remove duplicates and non-approved items
    for (const item of packagingItems) {
      const isApproved = approvedItems.some(a => a.name.toLowerCase() === item.ingredient?.toLowerCase());
      if (!isApproved) {
        await base44.entities.InventoryItem.delete(item.id);
        deletedIds.push(item.id);
      }
    }

    return Response.json({
      message: `Cleaned up ${deletedIds.length} duplicate/non-approved items`,
      deletedIds
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});