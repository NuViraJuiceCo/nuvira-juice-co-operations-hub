import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Download, Filter, AlertCircle, CheckCircle2, Trash2 } from 'lucide-react';
import UnifiedComplianceForm from '@/components/compliance/UnifiedComplianceForm';
import moment from 'moment';

export default function ComplianceLogs() {
  const queryClient = useQueryClient();
  const [startDate, setStartDate] = useState(moment().subtract(30, 'days').format('YYYY-MM-DD'));
  const [endDate, setEndDate] = useState(moment().format('YYYY-MM-DD'));
  const [logTypeFilter, setLogTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isExporting, setIsExporting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const { data: logs = [], isLoading, refetch } = useQuery({
    queryKey: ['compliance_logs', startDate, endDate],
    queryFn: async () => {
      const allLogs = await base44.entities.ComplianceLog.list('-log_date', 500);
      return allLogs.filter(log => {
        const matchDate = log.log_date >= startDate && log.log_date <= endDate;
        const matchType = logTypeFilter === 'all' || log.log_type === logTypeFilter;
        const matchStatus = statusFilter === 'all' || log.status === statusFilter;
        return matchDate && matchType && matchStatus;
      });
    }
  });

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await base44.functions.invoke('generateComplianceAudit', {
        start_date: startDate,
        end_date: endDate,
        log_types: logTypeFilter === 'all' ? null : [logTypeFilter]
      });

      if (response.data && response.data.url) {
        window.open(response.data.url, '_blank');
      }
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setIsExporting(false);
    }
  };

  const handleDelete = async (logId) => {
    setDeletingId(logId);
    try {
      await base44.entities.ComplianceLog.delete(logId);
      queryClient.invalidateQueries({ queryKey: ['compliance_logs'] });
    } catch (error) {
      console.error('Delete failed:', error);
    } finally {
      setDeletingId(null);
    }
  };

  const failedLogs = logs.filter(l => l.status === 'fail');
  const passedLogs = logs.filter(l => l.status === 'pass');

  const getStatusIcon = (status) => {
    return status === 'pass' ? (
      <CheckCircle2 className="w-4 h-4 text-green-600" />
    ) : (
      <AlertCircle className="w-4 h-4 text-red-600" />
    );
  };

  const getLogTypeLabel = (type) => {
    const labels = {
      temperature: '🌡️ Temperature',
      pH: '🧪 pH',
      CCP: '⚠️ CCP',
      sanitation: '🧹 Sanitation',
      corrective_action: '🔧 Corrective Action',
      daily_checklist: '📋 Daily Checklist'
    };
    return labels[type] || type;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Compliance Logs</h1>
          <p className="text-muted-foreground mt-1">Temperature, pH, CCP, Sanitation & Corrective Actions</p>
        </div>
        <Button onClick={handleExport} disabled={isExporting} className="gap-2">
          <Download className="w-4 h-4" />
          {isExporting ? 'Generating...' : 'Export Audit PDF'}
        </Button>
      </div>

      {/* New Log Form */}
      <UnifiedComplianceForm />

      {/* Stats */}
      {!isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Total Logs</p>
              <p className="text-3xl font-bold mt-2">{logs.length}</p>
            </CardContent>
          </Card>
          <Card className="border-green-200">
            <CardContent className="pt-6">
              <p className="text-sm text-green-700">Passed</p>
              <p className="text-3xl font-bold text-green-600 mt-2">{passedLogs.length}</p>
            </CardContent>
          </Card>
          <Card className="border-red-200">
            <CardContent className="pt-6">
              <p className="text-sm text-red-700">Failed/Issues</p>
              <p className="text-3xl font-bold text-red-600 mt-2">{failedLogs.length}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="w-4 h-4" /> Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium">From Date</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">To Date</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Log Type</label>
              <select
                value={logTypeFilter}
                onChange={(e) => setLogTypeFilter(e.target.value)}
                className="mt-1 w-full p-2 border rounded-lg"
              >
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
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="mt-1 w-full p-2 border rounded-lg"
              >
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

      {/* Log List */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No logs found for the selected date range.</p>
        ) : (
          logs.map(log => (
            <Card key={log.id} className={log.status === 'fail' ? 'border-red-200' : ''}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      {getStatusIcon(log.status)}
                      <span className="font-semibold">{getLogTypeLabel(log.log_type)}</span>
                      <span className="text-xs px-2 py-1 rounded bg-muted">{log.status.toUpperCase()}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">
                      {log.log_date} {log.log_time} • {log.staff_member} • Shift: {log.shift}
                    </p>
                    {log.data && (
                      <div className="text-sm bg-muted p-2 rounded">
                        <pre className="text-xs">{JSON.stringify(log.data, null, 2)}</pre>
                      </div>
                    )}
                    {log.notes && <p className="text-sm mt-2 text-muted-foreground">📝 {log.notes}</p>}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(log.id)}
                    disabled={deletingId === log.id}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}