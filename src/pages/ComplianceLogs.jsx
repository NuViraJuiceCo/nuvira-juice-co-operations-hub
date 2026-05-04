import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Download, Filter, AlertCircle, CheckCircle2, Printer, BookOpen } from 'lucide-react';
import AdminGuide from '@/components/shared/AdminGuide';
import UnifiedComplianceForm from '@/components/compliance/UnifiedComplianceForm';
import PrintableLogSheet from '@/components/compliance/PrintableLogSheet';
import MonthlyBinderExport from '@/components/compliance/MonthlyBinderExport';
import BatchLogsGrouped from '@/components/compliance/BatchLogsGrouped';
import { useAuth } from '@/lib/AuthContext';
import moment from 'moment';

export default function ComplianceLogs() {
  const [startDate, setStartDate] = useState(moment().subtract(30, 'days').format('YYYY-MM-DD'));
  const [endDate, setEndDate] = useState(moment().format('YYYY-MM-DD'));
  const [logTypeFilter, setLogTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [printingLog, setPrintingLog] = useState(null);
  const [showMonthlyExport, setShowMonthlyExport] = useState(false);
  const [activeTab, setActiveTab] = useState('batch');
  const { user } = useAuth();

  // Fetch all batch compliance logs (used by the grouped batch tab)
  const { data: batchLogs = [], isLoading: batchLoading } = useQuery({
    queryKey: ['batch_compliance_logs'],
    queryFn: () => base44.entities.BatchComplianceLog?.list('-date', 500).catch(() => []),
  });

  // Fetch other compliance logs (manual: temp, pH, CCP, sanitation, corrective)
  const { data: otherLogs = [], isLoading: otherLoading } = useQuery({
    queryKey: ['other_compliance_logs', startDate, endDate, logTypeFilter, statusFilter],
    queryFn: async () => {
      const logs = await base44.entities.ComplianceLog?.list('-log_date', 500).catch(() => []);
      return (logs || []).filter(log => {
        const matchDate = (log.log_date || '') >= startDate && (log.log_date || '') <= endDate;
        const matchType = logTypeFilter === 'all' || log.log_type === logTypeFilter;
        const pf = (log.passed_failed || log.status || '').toLowerCase();
        const matchStatus = statusFilter === 'all'
          || (statusFilter === 'pass' && (pf === 'pass' || pf === 'passed'))
          || (statusFilter === 'fail' && (pf === 'fail' || pf === 'failed'))
          || (statusFilter === 'complete' && pf === 'complete')
          || (statusFilter === 'incomplete' && pf === 'incomplete');
        return matchDate && matchType && matchStatus;
      }).sort((a, b) => new Date(b.log_date) - new Date(a.log_date));
    },
  });

  const handleExportOtherLogs = () => {
    if (otherLogs.length === 0) {
      alert('No logs to export for the selected date range.');
      return;
    }
    const rows = [
      ['Date', 'Time', 'Type', 'Staff', 'Pass/Fail', 'Notes', 'Verified By', 'Verified At']
    ];
    otherLogs.forEach(log => {
      rows.push([
        log.log_date || '',
        log.log_time || '',
        log.log_type || '',
        log.staff_member || '',
        log.passed_failed || log.status || '',
        (log.notes || '').replace(/,/g, ';'),
        log.verified_by || '',
        log.verified_at ? moment(log.verified_at).format('YYYY-MM-DD HH:mm') : '',
      ]);
    });
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `NuVira-OtherLogs-${startDate}-to-${endDate}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getStatusIcon = (log) => {
    const pf = (log.passed_failed || log.status || '').toLowerCase();
    if (pf === 'pass' || pf === 'passed') return <CheckCircle2 className="w-4 h-4 text-green-600" />;
    if (pf === 'fail' || pf === 'failed') return <AlertCircle className="w-4 h-4 text-red-600" />;
    return <AlertCircle className="w-4 h-4 text-slate-400" />;
  };

  const LOG_TYPE_LABELS = {
    temperature: '🌡️ Temperature',
    pH: '🧪 pH',
    CCP: '⚠️ CCP',
    sanitation: '🧹 Sanitation',
    corrective_action: '🔧 Corrective Action',
    daily_checklist: '📋 Daily Checklist',
  };

  return (
    <div className="space-y-6">
      <AdminGuide
        title="Admin Guide — Compliance Logs"
        steps={[
          "Use the form below to log a new compliance entry (Temperature, pH, CCP, Sanitation, etc.).",
          "Batch Logs tab shows production batch records grouped by product and month — populated after Verify & Log in Production.",
          "Logs with a Fail status are highlighted in red and require a Corrective Action entry.",
          "Use Export Product Month Logs on any product card to get a PDF for just that product.",
          "Use Export Monthly Binder to generate a full compliance binder for any month.",
        ]}
        tips={[
          "Temperature logs should be entered twice daily per food safety standards.",
          "Every failed CCP or temperature log must have a corresponding Corrective Action log.",
          "Batch logs are read-only and auto-populated when batches are verified in Production.",
        ]}
      />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold">Compliance Logs</h1>
          <p className="text-muted-foreground mt-1">Temperature, pH, CCP, Sanitation, Batch & Corrective Actions</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <Button variant="outline" onClick={() => setShowMonthlyExport(true)} className="gap-2">
            <BookOpen className="w-4 h-4" />
            Export Monthly Binder
          </Button>
        </div>
      </div>

      {/* New Log Form */}
      <UnifiedComplianceForm />

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {[
          { key: 'batch', label: '📦 Batch Logs' },
          { key: 'other', label: '📋 Other Logs' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── BATCH LOGS TAB ── */}
      {activeTab === 'batch' && (
        <BatchLogsGrouped
          batchLogs={batchLogs}
          onPrintLog={setPrintingLog}
        />
      )}

      {/* ── OTHER LOGS TAB ── */}
      {activeTab === 'other' && (
        <div className="space-y-4">
          {/* Export button */}
          <div className="flex justify-end">
            <Button onClick={handleExportOtherLogs} variant="outline" className="gap-2" size="sm">
              <Download className="w-4 h-4" />
              Export CSV
            </Button>
          </div>

          {/* Filters */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Filter className="w-4 h-4" /> Filters
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-sm font-medium">From Date</label>
                  <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <label className="text-sm font-medium">To Date</label>
                  <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <label className="text-sm font-medium">Log Type</label>
                  <select value={logTypeFilter} onChange={e => setLogTypeFilter(e.target.value)} className="mt-1 w-full p-2 border rounded-lg bg-background">
                    <option value="all">All Types</option>
                    <option value="temperature">Temperature</option>
                    <option value="pH">pH</option>
                    <option value="CCP">CCP</option>
                    <option value="sanitation">Sanitation</option>
                    <option value="corrective_action">Corrective Action</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">Status</label>
                  <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="mt-1 w-full p-2 border rounded-lg bg-background">
                    <option value="all">All Status</option>
                    <option value="pass">Pass</option>
                    <option value="fail">Fail</option>
                    <option value="complete">Complete</option>
                    <option value="incomplete">Incomplete</option>
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Log list */}
          <div className="space-y-3">
            {otherLoading ? (
              <div className="flex items-center justify-center h-32">
                <div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" />
              </div>
            ) : otherLogs.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No logs found for the selected date range.</p>
            ) : (
              otherLogs.map(log => (
                <Card key={log.id} className={log.passed_failed === 'failed' || log.status === 'fail' ? 'border-red-200' : ''}>
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          {getStatusIcon(log)}
                          <span className="font-semibold">{LOG_TYPE_LABELS[log.log_type] || log.log_type}</span>
                          <span className="text-xs px-2 py-0.5 rounded bg-muted">{(log.passed_failed || log.status || '').toUpperCase()}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {log.log_date} {log.log_time || ''} · {log.staff_member || '—'} · Shift: {log.shift || '—'}
                        </p>
                        {log.notes && <p className="text-sm mt-1.5 text-muted-foreground">📝 {log.notes}</p>}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-xs ml-4 shrink-0"
                        onClick={() => setPrintingLog(log)}
                      >
                        <Printer className="w-3.5 h-3.5" />
                        Export PDF
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      )}

      {printingLog && (
        <PrintableLogSheet log={printingLog} onClose={() => setPrintingLog(null)} />
      )}
      {showMonthlyExport && (
        <MonthlyBinderExport user={user} onClose={() => setShowMonthlyExport(false)} />
      )}
    </div>
  );
}