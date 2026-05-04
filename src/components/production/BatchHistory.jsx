import { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Filter, Download, CheckCircle2, AlertCircle, Clock, ChevronDown, ChevronUp, Lock, FileCheck } from 'lucide-react';
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
      const allBatches = await base44.entities.ProductionBatch.list('-production_date', 1000);
      
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

  // Resolve actual quantity produced with fallbacks
  const resolveQuantity = (batch) => {
    const candidates = [
      batch.actual_quantity_produced,
      batch.actual_units,
      batch.produced_quantity,
      batch.quantity_produced,
      batch.quantity,
      batch.actual_quantity
    ];
    for (const val of candidates) {
      if (val !== null && val !== undefined && val !== '') return val;
    }
    return null;
  };

  // Resolve planned/needed quantity with fallbacks
  const resolvePlannedQuantity = (batch) => {
    const candidates = [
      batch.planned_quantity,
      batch.needed_quantity,
      batch.quantity_needed,
      batch.expected_quantity,
      batch.planned_units
    ];
    for (const val of candidates) {
      if (val !== null && val !== undefined && val !== '') return val;
    }
    return null;
  };

  // Count delivered orders
  const getDeliveryCompletion = (batch) => {
    if (!batch.order_sources || batch.order_sources.length === 0) return null;
    const delivered = batch.order_sources.filter(os => os.delivery_status === 'delivered').length;
    return { delivered, total: batch.order_sources.length };
  };

  // Resolve ingredients list
  const resolveIngredients = (batch) => {
    if (batch.final_batch_ingredients?.length > 0) return batch.final_batch_ingredients;
    if (batch.ingredients_used?.length > 0) return batch.ingredients_used;
    return null;
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

  // Batch card component
  function BatchDetailCard({ batch }) {
    const [expanded, setExpanded] = useState({
      orders: false,
      ingredients: false,
      compliance: false,
      notes: false,
    });

    const produced = resolveQuantity(batch);
    const planned = resolvePlannedQuantity(batch);
    const delivery = getDeliveryCompletion(batch);
    const ingredients = resolveIngredients(batch);
    const isRetrospective = batch.notes?.includes('[RETROSPECTIVE]');

    const toggleSection = (section) => {
      setExpanded(prev => ({ ...prev, [section]: !prev[section] }));
    };

    return (
      <Card key={batch.id} className={batch.passed_failed === 'failed' ? 'border-status-danger-border' : ''}>
        <CardContent className="pt-6">
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <h3 className="font-bold text-foreground text-base">{batch.batch_id}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${getStatusColor(batch.status)}`}>
                    {batch.status.replace(/_/g, ' ')}
                  </span>
                  {batch.is_locked && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-foreground border border-border flex items-center gap-1">
                      <Lock className="h-3 w-3" /> Locked
                    </span>
                  )}
                  {isRetrospective && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100/50 text-amber-700 border border-amber-200">
                      📦 Retrospective
                    </span>
                  )}
                  {batch.compliance_log_id && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100/50 text-green-700 border border-green-200 flex items-center gap-1">
                      <FileCheck className="h-3 w-3" /> Log
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium text-foreground/80">
                  {batch.product_name} <span className="text-foreground/50">•</span> {batch.production_date}
                </p>
              </div>
              {batch.verified_at && (
                <div className="text-right text-xs text-foreground/60">
                  <p>Verified {moment(batch.verified_at).fromNow()}</p>
                  <p>by {batch.verified_by?.split('@')[0] || 'Unknown'}</p>
                </div>
              )}
            </div>

            {/* Quantity Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 bg-muted/20 rounded-lg text-sm">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Produced</p>
                <p className="font-semibold text-foreground">{produced ?? 'Not recorded'}</p>
              </div>
              {planned && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Planned</p>
                  <p className="font-semibold text-foreground">{planned}</p>
                </div>
              )}
              {delivery && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Delivered</p>
                  <p className="font-semibold text-foreground">{delivery.delivered}/{delivery.total}</p>
                </div>
              )}
              {batch.order_sources?.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Orders</p>
                  <p className="font-semibold text-foreground">{batch.order_sources.length}</p>
                </div>
              )}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">pH</p>
                <p className={`font-semibold ${batch.pH_result ? 'text-foreground' : 'text-foreground/50'}`}>
                  {batch.pH_result ? `${batch.pH_result} ${batch.pH_passed_failed === 'passed' ? '✓' : '✗'}` : '—'}
                </p>
              </div>
            </div>

            {/* Staff & Timing */}
            {(batch.staff_on_duty?.length > 0 || batch.actual_start_time || batch.actual_end_time) && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm border-t pt-3">
                {batch.staff_on_duty?.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Staff</p>
                    <p className="text-foreground text-xs">{batch.staff_on_duty.join(', ')}</p>
                  </div>
                )}
                {batch.actual_start_time && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Started</p>
                    <p className="font-semibold text-foreground">{moment(batch.actual_start_time).format('MMM D, HH:mm')}</p>
                  </div>
                )}
                {batch.actual_end_time && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ended</p>
                    <p className="font-semibold text-foreground">{moment(batch.actual_end_time).format('HH:mm')}</p>
                  </div>
                )}
              </div>
            )}

            {/* Expandable Sections */}
            {batch.order_sources?.length > 0 && (
              <div className="border-t pt-3">
                <button
                  onClick={() => toggleSection('orders')}
                  className="flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary/80 w-full"
                >
                  {expanded.orders ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  Order Sources ({batch.order_sources.length})
                </button>
                {expanded.orders && (
                  <div className="mt-2 ml-4 space-y-2 text-xs border-l border-border pl-3">
                    {batch.order_sources.map((os, i) => (
                      <div key={i} className="text-foreground/80">
                        <p className="font-semibold">{os.order_number}</p>
                        <p className="text-[11px]">{os.customer_name || os.customer_email}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {os.source_type} • Qty: {os.quantity}
                          {os.source_item && ` (${os.source_item})`}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {ingredients && (
              <div className="border-t pt-3">
                <button
                  onClick={() => toggleSection('ingredients')}
                  className="flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary/80 w-full"
                >
                  {expanded.ingredients ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  Ingredients / Formula
                </button>
                {expanded.ingredients && (
                  <div className="mt-2 ml-4 space-y-1 text-xs border-l border-border pl-3 text-foreground/80">
                    {ingredients.map((ing, i) => (
                      <p key={i} className="text-[11px]">
                        {ing.ingredient_name}
                        {ing.quantity_oz && ` (${ing.quantity_oz} ${ing.unit || 'oz'})`}
                        {ing.lot_number && ` • Lot: ${ing.lot_number}`}
                      </p>
                    ))}
                    {batch.ingredient_lot_notes && (
                      <p className="text-[10px] text-muted-foreground italic border-t mt-1 pt-1">
                        {batch.ingredient_lot_notes}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Compliance Details */}
            {(batch.pH_result || batch.ccp_check_complete || batch.corrective_action_required) && (
              <div className="border-t pt-3">
                <button
                  onClick={() => toggleSection('compliance')}
                  className="flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary/80 w-full"
                >
                  {expanded.compliance ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  Compliance Details
                </button>
                {expanded.compliance && (
                  <div className="mt-2 ml-4 space-y-1.5 text-xs border-l border-border pl-3">
                    {batch.pH_result && (
                      <p className="text-foreground/80">
                        <span className="font-semibold">pH:</span> {batch.pH_result}
                        <span className={`ml-2 ${batch.pH_passed_failed === 'passed' ? 'text-status-success' : 'text-status-danger'}`}>
                          {batch.pH_passed_failed?.toUpperCase() || '—'}
                        </span>
                      </p>
                    )}
                    {batch.ccp_check_complete && (
                      <p className="text-foreground/80"><span className="font-semibold">CCP Check:</span> ✓ Complete</p>
                    )}
                    {batch.sanitation_verification_complete && (
                      <p className="text-foreground/80"><span className="font-semibold">Sanitation:</span> ✓ Verified</p>
                    )}
                    {batch.corrective_action_required && (
                      <div className="bg-status-warning-bg border border-status-warning-border p-2 rounded">
                        <p className="font-semibold text-status-warning text-[10px]">⚠️ Corrective Action</p>
                        {batch.issue_identified && (
                          <p className="text-[10px] text-foreground/80 mt-1">{batch.issue_identified}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Notes */}
            {batch.notes && (
              <div className="border-t pt-3">
                <button
                  onClick={() => toggleSection('notes')}
                  className="flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary/80 w-full"
                >
                  {expanded.notes ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  Notes
                </button>
                {expanded.notes && (
                  <div className="mt-2 ml-4 text-xs text-foreground/80 border-l border-border pl-3">
                    {batch.notes}
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

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
          batches.map(batch => <BatchDetailCard key={batch.id} batch={batch} />)
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {batches.length} batch{batches.length !== 1 ? 'es' : ''} • {filters.startDate} to {filters.endDate}
      </p>
    </div>
  );
}