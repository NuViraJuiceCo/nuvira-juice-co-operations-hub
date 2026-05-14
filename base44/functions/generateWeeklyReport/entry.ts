import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { jsPDF } from 'npm:jspdf@4.0.0';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  
  // Admin-only: sensitive operational and financial reporting
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Admin access required — weekly reports are admin-only' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { start_date, end_date, recipient_email, report_types = ['financial', 'operational'] } = body;

  // Default to last 7 days if no dates provided
  const now = new Date();
  const endDate = end_date ? new Date(end_date) : now;
  const startDate = start_date ? new Date(start_date) : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const fmtDate = (d) => d.toISOString().split('T')[0];
  const startStr = fmtDate(startDate);
  const endStr = fmtDate(endDate);

  // Fetch all data in parallel
  const [orders, batches, fulfillment] = await Promise.all([
    base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500),
    base44.asServiceRole.entities.ProductionBatch.list('-production_date', 200),
    base44.asServiceRole.entities.FulfillmentTask.list('-scheduled_date', 200),
  ]);

  // Filter by date range (created_date for orders, production_date for batches)
  const inRange = (dateStr) => dateStr >= startStr && dateStr <= endStr;

  const rangeOrders = orders.filter(o => {
    const d = (o.created_date || '').substring(0, 10);
    return d >= startStr && d <= endStr;
  });

  const rangeBatches = batches.filter(b => inRange(b.production_date || ''));

  // --- Financial Metrics ---
  const totalRevenue = rangeOrders.reduce((s, o) => s + (o.total_price || 0), 0);
  const totalOrders = rangeOrders.length;
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const paidOrders = rangeOrders.filter(o => o.payment_status === 'paid');
  const pendingPayments = rangeOrders.filter(o => o.payment_status === 'pending');

  const ordersByChannel = {};
  rangeOrders.forEach(o => {
    const ch = o.source_channel || 'Other';
    if (!ordersByChannel[ch]) ordersByChannel[ch] = { count: 0, revenue: 0 };
    ordersByChannel[ch].count++;
    ordersByChannel[ch].revenue += o.total_price || 0;
  });

  const ordersByStatus = {};
  rangeOrders.forEach(o => {
    ordersByStatus[o.production_status] = (ordersByStatus[o.production_status] || 0) + 1;
  });

  // Daily revenue trend
  const dailyRevenue = {};
  rangeOrders.forEach(o => {
    const d = (o.created_date || '').substring(0, 10);
    if (!d) return;
    dailyRevenue[d] = (dailyRevenue[d] || 0) + (o.total_price || 0);
  });

  // --- Operational Metrics ---
  const completedBatches = rangeBatches.filter(b => b.status === 'Completed').length;
  const totalUnitsPlanned = rangeBatches.reduce((s, b) => s + (b.planned_units || 0), 0);
  const totalUnitsActual = rangeBatches.filter(b => b.actual_units).reduce((s, b) => s + (b.actual_units || 0), 0);

  // --- Generate PDF ---
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210;
  const margin = 18;
  let y = 0;

  const addPage = () => { doc.addPage(); y = 20; };
  const checkY = (needed = 15) => { if (y + needed > 270) addPage(); };

  // --- Cover Page ---
  doc.setFillColor(22, 101, 52); // emerald-800
  doc.rect(0, 0, W, 60, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('NuVira Operations Hub', margin, 28);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.text('Weekly Operations & Financial Report', margin, 40);
  doc.setFontSize(10);
  doc.text(`Period: ${startStr}  to  ${endStr}`, margin, 52);

  doc.setTextColor(40, 40, 40);
  y = 80;

  // --- Section helper ---
  const sectionHeader = (title) => {
    checkY(18);
    doc.setFillColor(240, 253, 244);
    doc.rect(margin - 2, y - 5, W - margin * 2 + 4, 12, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(22, 101, 52);
    doc.text(title, margin, y + 2);
    doc.setTextColor(40, 40, 40);
    y += 14;
  };

  const row = (label, value, indent = false) => {
    checkY(8);
    doc.setFont('helvetica', indent ? 'normal' : 'bold');
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    doc.text(String(label), margin + (indent ? 8 : 0), y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(22, 101, 52);
    doc.text(String(value), W - margin, y, { align: 'right' });
    doc.setTextColor(40, 40, 40);
    y += 7;
  };

  const divider = () => {
    checkY(5);
    doc.setDrawColor(220, 220, 220);
    doc.line(margin, y, W - margin, y);
    y += 5;
  };

  // --- FINANCIAL SECTION ---
  if (report_types.includes('financial')) {
    sectionHeader('📊 Financial Summary');
    row('Total Revenue', `$${totalRevenue.toFixed(2)}`);
    row('Total Orders', totalOrders);
    row('Average Order Value', `$${avgOrderValue.toFixed(2)}`);
    row('Paid Orders', paidOrders.length);
    row('Pending Payment', pendingPayments.length);
    divider();

    sectionHeader('Revenue by Channel');
    Object.entries(ordersByChannel).sort((a, b) => b[1].revenue - a[1].revenue).forEach(([ch, data]) => {
      row(ch, `$${data.revenue.toFixed(2)} (${data.count} orders)`, true);
    });
    divider();

    sectionHeader('Orders by Status');
    Object.entries(ordersByStatus).forEach(([status, count]) => {
      row(status, count, true);
    });
    divider();

    // Daily Revenue Table
    sectionHeader('Daily Revenue Breakdown');
    const sortedDays = Object.entries(dailyRevenue).sort((a, b) => a[0].localeCompare(b[0]));
    if (sortedDays.length === 0) {
      doc.setFontSize(10); doc.setTextColor(120, 120, 120);
      doc.text('No orders in this period.', margin, y); y += 8;
    } else {
      // Header
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(100, 100, 100);
      doc.text('Date', margin, y); doc.text('Revenue', W - margin - 30, y); doc.text('Orders', W - margin, y, { align: 'right' });
      y += 5; doc.line(margin, y, W - margin, y); y += 4;

      sortedDays.forEach(([date, rev]) => {
        checkY(7);
        const cnt = rangeOrders.filter(o => (o.created_date || '').startsWith(date)).length;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(40, 40, 40);
        doc.text(date, margin, y);
        doc.setTextColor(22, 101, 52); doc.setFont('helvetica', 'bold');
        doc.text(`$${rev.toFixed(2)}`, W - margin - 30, y);
        doc.setTextColor(80, 80, 80); doc.setFont('helvetica', 'normal');
        doc.text(String(cnt), W - margin, y, { align: 'right' });
        y += 6;
      });
      y += 4;
    }
  }

  // --- OPERATIONAL SECTION ---
  if (report_types.includes('operational')) {
    sectionHeader('⚙️ Operational Summary');
    row('Total Production Batches', rangeBatches.length);
    row('Completed Batches', completedBatches);
    row('Units Planned', totalUnitsPlanned);
    if (totalUnitsActual > 0) row('Units Produced (actual)', totalUnitsActual);
    row('Fulfillment Tasks', fulfillment.filter(f => inRange(f.scheduled_date || '')).length);
    divider();

    if (rangeBatches.length > 0) {
      sectionHeader('Production Batch Details');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(100, 100, 100);
      doc.text('Batch', margin, y); doc.text('Product', margin + 30, y); doc.text('Units', W - margin - 20, y); doc.text('Status', W - margin, y, { align: 'right' });
      y += 5; doc.line(margin, y, W - margin, y); y += 4;

      rangeBatches.forEach(b => {
        checkY(7);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(40, 40, 40);
        doc.text((b.batch_id || '').substring(0, 18), margin, y);
        doc.text((b.product_name || '').substring(0, 22), margin + 30, y);
        doc.text(String(b.planned_units || 0), W - margin - 20, y);
        doc.setTextColor(22, 101, 52);
        doc.text(b.status || '', W - margin, y, { align: 'right' });
        doc.setTextColor(40, 40, 40);
        y += 6;
      });
    }
  }

  // --- Footer on last page ---
  checkY(15);
  y += 5;
  doc.setDrawColor(220, 220, 220); doc.line(margin, y, W - margin, y); y += 6;
  doc.setFontSize(8); doc.setTextColor(160, 160, 160);
  doc.text(`Generated by NuVira Operations Hub · ${new Date().toLocaleString()} · Confidential`, margin, y);

  const pdfBase64 = doc.output('datauristring').split(',')[1];
  const pdfBuffer = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
  const fileName = `NuVira_Report_${startStr}_to_${endStr}.pdf`;

  // Upload the PDF
  const formData = new FormData();
  formData.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), fileName);
  const uploadRes = await base44.asServiceRole.integrations.Core.UploadFile({ file: new Blob([pdfBuffer], { type: 'application/pdf' }) });
  const fileUrl = uploadRes.file_url;

  // Send email
  const to = recipient_email || 'operations@nuvirajuice.com';
  const dateLabel = `${startStr} to ${endStr}`;
  await base44.asServiceRole.integrations.Core.SendEmail({
    to,
    subject: `NuVira Weekly Report: ${dateLabel}`,
    body: `
<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background: #166534; padding: 24px; border-radius: 12px 12px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 20px;">NuVira Operations Hub</h1>
    <p style="color: #bbf7d0; margin: 4px 0 0;">Weekly Report · ${dateLabel}</p>
  </div>
  <div style="background: #f9fafb; padding: 24px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb; border-top: none;">
    <h2 style="color: #166534; font-size: 16px;">Here's your report summary:</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <tr style="background: #f0fdf4;"><td style="padding: 8px 12px; font-weight: bold; color: #374151;">Total Revenue</td><td style="padding: 8px 12px; text-align: right; color: #166534; font-weight: bold;">$${totalRevenue.toFixed(2)}</td></tr>
      <tr><td style="padding: 8px 12px; color: #374151;">Total Orders</td><td style="padding: 8px 12px; text-align: right; color: #374151;">${totalOrders}</td></tr>
      <tr style="background: #f0fdf4;"><td style="padding: 8px 12px; color: #374151;">Avg Order Value</td><td style="padding: 8px 12px; text-align: right; color: #374151;">$${avgOrderValue.toFixed(2)}</td></tr>
      <tr><td style="padding: 8px 12px; color: #374151;">Production Batches</td><td style="padding: 8px 12px; text-align: right; color: #374151;">${rangeBatches.length}</td></tr>
      <tr style="background: #f0fdf4;"><td style="padding: 8px 12px; color: #374151;">Units Planned</td><td style="padding: 8px 12px; text-align: right; color: #374151;">${totalUnitsPlanned}</td></tr>
    </table>
    <div style="margin-top: 20px; text-align: center;">
      <a href="${fileUrl}" style="background: #166534; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">📄 Download Full PDF Report</a>
    </div>
    <p style="color: #9ca3af; font-size: 12px; margin-top: 20px; text-align: center;">NuVira Juice Company · Confidential Internal Report</p>
  </div>
</div>
    `.trim(),
  });

  return Response.json({
    success: true,
    file_url: fileUrl,
    summary: { total_revenue: totalRevenue, total_orders: totalOrders, batches: rangeBatches.length },
    sent_to: to,
    period: { start: startStr, end: endStr },
  });
});