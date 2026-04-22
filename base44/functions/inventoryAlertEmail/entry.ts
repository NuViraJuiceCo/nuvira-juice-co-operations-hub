import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const items = await base44.asServiceRole.entities.InventoryItem.list('-updated_date', 100);
    const lowStock = items.filter(i => i.stock <= i.reorder_point);

    if (lowStock.length === 0) {
      return Response.json({ message: 'No low stock items', sent: false });
    }

    const users = await base44.asServiceRole.entities.User.list();
    const admins = users.filter(u => u.role === 'admin' || u.role === 'inventory_manager');

    const itemRows = lowStock.map(i =>
      `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee">${i.ingredient}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">${i.stock} ${i.unit}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">${i.reorder_point} ${i.unit}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#dc2626;font-weight:600;text-align:center">${i.supplier || '—'}</td></tr>`
    ).join('');

    const body = `<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1a4731;padding:24px;border-radius:12px 12px 0 0">
        <h1 style="color:#fff;font-size:20px;margin:0">⚠️ Low Stock Alert — nuVira Operations</h1>
        <p style="color:rgba(255,255,255,0.7);margin:8px 0 0">${lowStock.length} ingredient${lowStock.length > 1 ? 's' : ''} need reordering</p>
      </div>
      <div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;border:1px solid #eee;border-top:none">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead><tr style="background:#f9fafb">
            <th style="padding:8px 12px;text-align:left;color:#6b7280;font-size:12px;text-transform:uppercase">Ingredient</th>
            <th style="padding:8px 12px;text-align:center;color:#6b7280;font-size:12px;text-transform:uppercase">Current Stock</th>
            <th style="padding:8px 12px;text-align:center;color:#6b7280;font-size:12px;text-transform:uppercase">Reorder Point</th>
            <th style="padding:8px 12px;text-align:center;color:#6b7280;font-size:12px;text-transform:uppercase">Supplier</th>
          </tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
        <p style="margin-top:20px;font-size:13px;color:#6b7280">Please log in to nuVira Operations Hub to create purchase orders.</p>
      </div>
    </div>`;

    await base44.asServiceRole.integrations.Core.SendEmail({
      to: 'operations@nuvirajuice.com',
      subject: `🔴 Low Stock Alert: ${lowStock.length} item${lowStock.length > 1 ? 's' : ''} need reordering`,
      body,
    });

    return Response.json({ message: `Alert sent for ${lowStock.length} items`, sent: true, items: lowStock.map(i => i.ingredient) });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});