import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const docs = await base44.asServiceRole.entities.ComplianceDoc.list('-expiry_date', 100);

    const today = new Date();
    const in30Days = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

    const overdue = docs.filter(d => d.status === 'Overdue' || d.status === 'Expired');
    const dueSoon = docs.filter(d => {
      if (!d.expiry_date) return false;
      const exp = new Date(d.expiry_date);
      return exp >= today && exp <= in30Days && d.status !== 'Expired';
    });

    if (overdue.length === 0 && dueSoon.length === 0) {
      return Response.json({ message: 'All compliance docs are valid', sent: false });
    }

    const users = await base44.asServiceRole.entities.User.list();
    const admins = users.filter(u => u.role === 'admin' || u.role === 'compliance_manager');

    const buildRows = (items, color) => items.map(d =>
      `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee">${d.name}</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${d.type}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;color:${color};font-weight:600">${d.status}</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${d.expiry_date || '—'}</td></tr>`
    ).join('');

    const body = `<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1a4731;padding:24px;border-radius:12px 12px 0 0">
        <h1 style="color:#fff;font-size:20px;margin:0">📋 Compliance Expiry Report</h1>
        <p style="color:rgba(255,255,255,0.7);margin:8px 0 0">${overdue.length} overdue · ${dueSoon.length} due within 30 days</p>
      </div>
      <div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;border:1px solid #eee;border-top:none">
        ${overdue.length > 0 ? `<h3 style="color:#dc2626;margin:0 0 12px">🔴 Overdue / Expired (${overdue.length})</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px">
          <thead><tr style="background:#fef2f2"><th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase">Document</th><th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase">Type</th><th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase">Status</th><th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase">Expiry</th></tr></thead>
          <tbody>${buildRows(overdue, '#dc2626')}</tbody>
        </table>` : ''}
        ${dueSoon.length > 0 ? `<h3 style="color:#d97706;margin:0 0 12px">🟡 Due Within 30 Days (${dueSoon.length})</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead><tr style="background:#fffbeb"><th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase">Document</th><th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase">Type</th><th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase">Status</th><th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase">Expiry</th></tr></thead>
          <tbody>${buildRows(dueSoon, '#d97706')}</tbody>
        </table>` : ''}
        <p style="margin-top:20px;font-size:13px;color:#6b7280">Log in to nuVira Operations Hub to renew or update compliance documents.</p>
      </div>
    </div>`;

    for (const admin of admins) {
      if (admin.email) {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: admin.email,
          subject: `📋 Compliance Alert: ${overdue.length} overdue, ${dueSoon.length} due soon`,
          body,
        });
      }
    }

    return Response.json({ message: 'Compliance report sent', overdue: overdue.length, dueSoon: dueSoon.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});