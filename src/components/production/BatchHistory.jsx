import { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Filter, Download, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import moment from 'moment';

export default function BatchHistory() {
  const [filters, setFilters] = useState({
    batchId: '',
    flavor: '',
    status: 'all',
    passFail: 'all',
    startDate: moment().subtract(90, 'days').format('YYYY-MM-DD'),
    endDate: moment().format('YYYY-MM-DD'),
  });

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['batch_history', filters],
    queryFn: async () => {
      // Query ALL ProductionBatch records directly — do not filter by status first
      const allBatches = await base44.asServiceRole.entities.ProductionBatch.list('-production_date', 1000);
      
      // Filter: only include batches with actual historical dates (completed, verified, archived, or locked retrospective)
      const historyStatuses = ['completed_pending_verification', 'verified_logged', 'archived', 'completed', 'fulfilled'];
      
      return allBatches.filter(b => {
        // Only show batches that are truly historical (have one of the historical statuses)
        const isHistorical = historyStatuses.includes(b.status) || b.is_locked;
        if (!isHistorical) return false;
        
        const dateMatch = b.production_date >= filters.startDate && b.production_date <= filters.endDate;
        const idMatch = !filters.batchId || b.batch_id.toLowerCase().includes(filters.batchId.toLowerCase());
        const flavorMatch = !filters.flavor || b.product_name.toLowerCase().includes(filters.flavor.toLowerCase());
        const statusMatch = filters.status === 'all' || b.status === filters.status;
        const passFailMatch = filters.passFail === 'all' || b.passed_failed === filters.passFail;
        return dateMatch && idMatch && flavorMatch && statusMatch && passFailMatch;
      });
    },
  });

  const handleExport = async () => {
    const csv = [
      ['Date', 'Batch ID', 'Flavor', 'Quantity', 'Staff', 'pH', 'Pass/Fail', 'Status', 'Verified By'].join(','),
      ...batches.map(b => [
        b.production_date,
        b.batch_id,
        b.product_name,
        b.actual_quantity_produced || '',
        (b.staff_on_duty || []).join('; '),
        b.pH_result || '',
        b.passed_failed || '',
        b.status,
        b.verified_by || '',
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    const link = document.createElement('a');
    link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
    link.download = `batch-history-${filters.startDate}-to-${filters.endDate}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getStatusColor = (status) => {
    const colors = {
      planned:                        'bg-muted text-foreground/80 border border-border',
      ready_for_production:           'bg-status-info-bg text-status-info border border-status-info-border',
      in_production:                  'bg-status-warning-bg text-status-warning border border-status-warning-border',
      completed_pending_verification: 'bg-status-warning-bg text-status-warning border border-status-warning-border',
      verified_logged:                'bg-status-success-bg text-status-success border border-status-success-border',
      archived:                       'bg-muted text-muted-foreground border border-border',
    };
    return colors[status] || 'bg-muted text-foreground/80 border border-border';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Batch History</h2>
          <p className="text-muted-foreground mt-1">Completed and verified production batches</p>
        </div>
        <Button onClick={handleExport} variant="outline" className="gap-2">
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Filter className="h-4 w-4" /> Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div>
              <label className="text-xs font-medium">From Date</label>
              <Input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
                className="mt-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium">To Date</label>
              <Input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
                className="mt-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Batch ID</label>
              <Input
                type="text"
                placeholder="Search batch ID"
                value={filters.batchId}
                onChange={(e) => setFilters(prev => ({ ...prev, batchId: e.target.value }))}
                className="mt-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Flavor</label>
              <Input
                type="text"
                placeholder="Search flavor"
                value={filters.flavor}
                onChange={(e) => setFilters(prev => ({ ...prev, flavor: e.target.value }))}
                className="mt-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Status</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
                className="mt-1 w-full p-2 text-sm border border-border rounded-lg bg-background"
              >
                <option value="all">All</option>
                <option value="verified_logged">Verified</option>
                <option value="completed_pending_verification">Pending Verification</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">Pass/Fail</label>
              <select
                value={filters.passFail}
                onChange={(e) => setFilters(prev => ({ ...prev, passFail: e.target.value }))}
                className="mt-1 w-full p-2 text-sm border border-border rounded-lg bg-background"
              >
                <option value="all">All</option>
                <option value="passed">Passed</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Batches List */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" />
          </div>
        ) : batches.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No batches found for the selected filters.</p>
        ) : (
          batches.map(batch => (
            <Card key={batch.id} className={batch.passed_failed === 'failed' ? 'border-status-danger-border' : ''}>
              <CardContent className="pt-6">
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <h3 className="font-bold text-foreground">{batch.batch_id}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${getStatusColor(batch.status)}`}>
                          {batch.status.replace(/_/g, ' ')}
                        </span>
                        {batch.passed_failed === 'failed' && (
                          <AlertCircle className="h-4 w-4 text-status-danger" />
                        )}
                        {batch.passed_failed === 'passed' && (
                          <CheckCircle2 className="h-4 w-4 text-status-success" />
                        )}
                      </div>
                      <p className="text-sm font-medium text-foreground/80">
                        {batch.product_name} <span className="text-foreground/50">•</span> {batch.production_date}
                      </p>
                    </div>
                    {batch.verified_at && (
                      <div className="text-right text-xs text-foreground/60">
                        <p>Verified {moment(batch.verified_at).fromNow()}</p>
                        <p>by {batch.verified_by?.split('@')[0]}</p>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t text-sm">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Quantity</p>
                      <p className="font-semibold text-foreground">{batch.actual_quantity_produced || '-'} units</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">pH</p>
                      <p className="font-semibold text-foreground">{batch.pH_result || '-'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Staff</p>
                      <p className="font-semibold text-foreground">{(batch.staff_on_duty || []).length} members</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Compliance Log</p>
                      <p className="font-semibold text-foreground">
                        {batch.compliance_log_id ? '✓ Created' : '—'}
                      </p>
                    </div>
                  </div>

                  {(batch.corrective_action_required || batch.issue_identified) && (
                    <div className="pt-2 mt-2 border-t border-status-warning-border bg-status-warning-bg p-2 rounded text-sm">
                      <p className="font-semibold text-xs mb-1 text-status-warning">⚠️ Corrective Action Required</p>
                      {batch.issue_identified && (
                        <p className="text-xs text-foreground/80">{batch.issue_identified}</p>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {batches.length} batch{batches.length !== 1 ? 'es' : ''} • {filters.startDate} to {filters.endDate}
      </p>
    </div>
  );
}