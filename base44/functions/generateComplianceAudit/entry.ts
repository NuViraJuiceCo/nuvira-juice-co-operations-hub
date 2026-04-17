import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { jsPDF } from 'npm:jspdf@4.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { start_date, end_date, log_types } = await req.json();

    // Fetch compliance logs
    let logs = await base44.entities.ComplianceLog.list('-log_date', 500);

    // Filter by date
    logs = logs.filter(log => {
      const logDate = log.log_date;
      return logDate >= start_date && logDate <= end_date;
    });

    // Filter by type if specified
    if (log_types && log_types.length > 0) {
      logs = logs.filter(log => log_types.includes(log.log_type));
    }

    // Generate PDF
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let yPosition = 15;

    // Header
    doc.setFontSize(18);
    doc.text('NuVira Compliance Audit Report', pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 10;

    doc.setFontSize(10);
    doc.text(`Date Range: ${start_date} to ${end_date}`, pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 5;
    doc.text(`Generated: ${new Date().toISOString().split('T')[0]}`, pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 10;

    // Summary
    doc.setFontSize(12);
    doc.text('Summary', 15, yPosition);
    yPosition += 6;

    doc.setFontSize(10);
    const logTypeCounts = {};
    const statusCounts = { pass: 0, fail: 0, warning: 0, complete: 0, incomplete: 0 };

    logs.forEach(log => {
      logTypeCounts[log.log_type] = (logTypeCounts[log.log_type] || 0) + 1;
      statusCounts[log.status] = (statusCounts[log.status] || 0) + 1;
    });

    doc.text(`Total Logs: ${logs.length}`, 15, yPosition);
    yPosition += 5;
    Object.entries(logTypeCounts).forEach(([type, count]) => {
      doc.text(`  ${type}: ${count}`, 20, yPosition);
      yPosition += 4;
    });

    yPosition += 5;
    doc.text('Status Breakdown:', 15, yPosition);
    yPosition += 4;
    Object.entries(statusCounts).forEach(([status, count]) => {
      if (count > 0) {
        doc.text(`  ${status}: ${count}`, 20, yPosition);
        yPosition += 4;
      }
    });

    // Details
    yPosition += 8;
    doc.setFontSize(12);
    doc.text('Detailed Log Entries', 15, yPosition);
    yPosition += 8;

    doc.setFontSize(9);
    logs.forEach((log, idx) => {
      if (yPosition > pageHeight - 15) {
        doc.addPage();
        yPosition = 15;
      }

      // Log header
      doc.setTextColor(0, 102, 204);
      doc.text(`${idx + 1}. ${log.log_type.toUpperCase()} - ${log.log_date} ${log.log_time}`, 15, yPosition);
      yPosition += 5;
      doc.setTextColor(0);

      // Log details
      doc.text(`Staff: ${log.staff_member} | Shift: ${log.shift || 'N/A'} | Status: ${log.status}`, 20, yPosition);
      yPosition += 4;

      // Data
      if (log.data) {
        const dataStr = JSON.stringify(log.data, null, 2);
        const dataLines = doc.splitTextToSize(dataStr, pageWidth - 40);
        dataLines.forEach(line => {
          if (yPosition > pageHeight - 15) {
            doc.addPage();
            yPosition = 15;
          }
          doc.text(line, 25, yPosition);
          yPosition += 3;
        });
      }

      if (log.notes) {
        const notesLines = doc.splitTextToSize(`Notes: ${log.notes}`, pageWidth - 40);
        notesLines.forEach(line => {
          if (yPosition > pageHeight - 15) {
            doc.addPage();
            yPosition = 15;
          }
          doc.text(line, 25, yPosition);
          yPosition += 3;
        });
      }

      yPosition += 4;
    });

    // Footer
    const totalPages = doc.internal.pages.length - 1;
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.text(`Page ${i} of ${totalPages}`, pageWidth / 2, pageHeight - 5, { align: 'center' });
    }

    const pdfBlob = doc.output('arraybuffer');
    return new Response(pdfBlob, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=nuvira-compliance-audit-${start_date}-to-${end_date}.pdf`
      }
    });
  } catch (error) {
    console.error('Error generating audit:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});