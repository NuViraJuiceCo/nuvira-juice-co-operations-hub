import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Plus, Trash2, Package, CheckCircle2, Clock, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import moment from 'moment';

const EMPTY_FORM = {
  title: '',
  purpose: '',
  production_date: '',
  use_date: '',
  status: 'active',
  notes: '',
  items: [{ product_name: '', quantity: 1 }],
};

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-800',
  included_in_planning: 'bg-blue-100 text-blue-800',
  in_production: 'bg-amber-100 text-amber-800',
  produced: 'bg-purple-100 text-purple-800',
  completed: 'bg-purple-100 text-purple-800',
  cancelled: 'bg-red-100 text-red-700',
};

const STATUS_ICON = {
  active: <Zap className="h-3 w-3" />,
  included_in_planning: <Clock className="h-3 w-3" />,
  in_production: <Clock className="h-3 w-3" />,
  produced: <CheckCircle2 className="h-3 w-3" />,
  completed: <CheckCircle2 className="h-3 w-3" />,
};

// Statuses that count as "active production demand"
const ACTIVE_STATUSES = new Set(['draft', 'active', 'included_in_planning', 'in_production']);
// Statuses that are terminal (done or cancelled)
const TERMINAL_STATUSES = new Set(['produced', 'completed', 'cancelled']);

const FILTER_TABS = [
  { key: 'active', label: 'Active' },
  { key: 'history', label: 'History' },
  { key: 'all', label: 'All' },
];

export default function ManualBatchManager() {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [filterTab, setFilterTab] = useState('active');

  const load = async () => {
    setLoading(true);
    const data = await base44.entities.ManualProductionBatch.list('-created_date', 200);
    setBatches(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filteredBatches = batches.filter(b => {
    if (filterTab === 'active') return ACTIVE_STATUSES.has(b.status) || !b.status;
    if (filterTab === 'history') return TERMINAL_STATUSES.has(b.status);
    return true; // 'all'
  });

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const updateItem = (idx, field, value) => {
    const items = [...form.items];
    items[idx] = { ...items[idx], [field]: field === 'quantity' ? Number(value) : value };
    setForm(f => ({ ...f, items }));
  };

  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { product_name: '', quantity: 1 }] }));
  const removeItem = (idx) => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  const handleSave = async () => {
    if (!form.title || !form.production_date || form.items.some(i => !i.product_name)) {
      alert('Title, production date, and all product names are required.');
      return;
    }
    setSaving(true);
    await base44.entities.ManualProductionBatch.create({
      ...form,
      source_type: 'manual_internal_batch',
    });
    setSaving(false);
    setShowForm(false);
    load();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this manual batch?')) return;
    setDeletingId(id);
    await base44.entities.ManualProductionBatch.delete(id);
    setBatches(b => b.filter(x => x.id !== id));
    setDeletingId(null);
  };

  const handleStatusChange = async (batch, newStatus) => {
    const now = new Date().toISOString();
    const extra = {};
    if (newStatus === 'produced' || newStatus === 'completed') {
      extra.produced_at = now;
      extra.completed_at = now;
    }
    await base44.entities.ManualProductionBatch.update(batch.id, { status: newStatus, ...extra });
    setBatches(b => b.map(x => x.id === batch.id ? { ...x, status: newStatus, ...extra } : x));
  };

  if (loading) {
    return <div className="flex items-center justify-center py-16"><div className="w-7 h-7 border-4 border-muted border-t-primary rounded-full animate-spin" /></div>;
  }

  const activeCounts = batches.filter(b => ACTIVE_STATUSES.has(b.status)).length;
  const historyCounts = batches.filter(b => TERMINAL_STATUSES.has(b.status)).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Manual Internal Batches</h2>
          <p className="text-xs text-muted-foreground mt-0.5">For internal needs — influencer deliveries, staff, events. Not customer orders. No Stripe, routing, or customer notification.</p>
        </div>
        <Button onClick={openCreate} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" /> Add Batch
        </Button>
      </div>

      {/* Disclaimer */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
        ⚠ These batches are <strong>admin-created only</strong>. They are included in ingredient calculations but do <strong>not</strong> create customer orders, driver tasks, Stripe charges, or customer notifications.
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 border-b border-border">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilterTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              filterTab === tab.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
            {tab.key === 'active' && activeCounts > 0 && (
              <span className="ml-1.5 text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">{activeCounts}</span>
            )}
            {tab.key === 'history' && historyCounts > 0 && (
              <span className="ml-1.5 text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">{historyCounts}</span>
            )}
          </button>
        ))}
      </div>

      {/* Batch List */}
      {filteredBatches.length === 0 ? (
        <div className="text-center py-14 bg-card border border-border rounded-xl">
          <Package className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {filterTab === 'active' ? 'No active manual batches. Add one to include internal needs in production planning.' :
             filterTab === 'history' ? 'No completed or cancelled batches yet.' :
             'No manual batches yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredBatches.map(b => {
            const isTerminal = TERMINAL_STATUSES.has(b.status);
            return (
              <div key={b.id} className={`bg-card border rounded-xl p-4 ${isTerminal ? 'border-border/50 opacity-80' : 'border-border'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-foreground">{b.title}</p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${STATUS_COLORS[b.status] || 'bg-muted text-muted-foreground'}`}>
                        {STATUS_ICON[b.status]}
                        {(b.status || '').replace(/_/g, ' ').toUpperCase()}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full font-bold">INTERNAL</span>
                    </div>
                    {b.purpose && <p className="text-xs text-muted-foreground mt-0.5">{b.purpose}</p>}
                    <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span><span className="font-medium text-foreground">Production:</span> {b.production_date}</span>
                      {b.use_date && <span><span className="font-medium text-foreground">Use/Deliver:</span> {b.use_date}</span>}
                      {b.produced_at && <span><span className="font-medium text-foreground">Produced:</span> {moment(b.produced_at).format('MMM D, YYYY')}</span>}
                      {b.completed_by && <span><span className="font-medium text-foreground">By:</span> {b.completed_by}</span>}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {(b.items || []).map((item, i) => {
                        const pq = (b.produced_quantities || []).filter(p =>
                          p.product_name === item.product_name || p.product_name?.toLowerCase() === item.product_name?.toLowerCase()
                        ).reduce((sum, p) => sum + (p.produced_quantity || 0), 0);
                        const showPQ = isTerminal && pq > 0;
                        return (
                          <span key={i} className={`text-xs px-2 py-0.5 rounded font-medium ${isTerminal ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}>
                            {showPQ ? `${pq}/${item.quantity}` : item.quantity}× {item.product_name}
                            {showPQ && pq < item.quantity && <span className="ml-1 text-amber-600">(partial)</span>}
                          </span>
                        );
                      })}
                    </div>
                    {b.linked_production_batch_ids?.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {b.linked_production_batch_ids.map((pbId, i) => (
                          <span key={i} className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded">
                            {pbId}
                          </span>
                        ))}
                      </div>
                    )}
                    {b.notes && <p className="text-xs text-muted-foreground mt-1.5 italic">{b.notes}</p>}
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {!isTerminal && (
                      <select
                        value={b.status}
                        onChange={e => handleStatusChange(b, e.target.value)}
                        className="text-xs border border-border rounded px-1.5 py-1 bg-background"
                      >
                        <option value="draft">Draft</option>
                        <option value="active">Active</option>
                        <option value="included_in_planning">In Planning</option>
                        <option value="in_production">In Production</option>
                        <option value="produced">Produced</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancel</option>
                      </select>
                    )}
                    <button
                      onClick={() => handleDelete(b.id)}
                      disabled={deletingId === b.id}
                      className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50 flex items-center gap-1 justify-end"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> {deletingId === b.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">Created {moment(b.created_date).format('MMM D, YYYY')}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Form Modal */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Manual Internal Batch</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Batch Title *</label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Brand Influencer Sampling" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Purpose / Notes</label>
              <Input value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} placeholder="Why this batch is being produced" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Production Date *</label>
                <Input type="date" value={form.production_date} onChange={e => setForm(f => ({ ...f, production_date: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Use / Deliver Date</label>
                <Input type="date" value={form.use_date} onChange={e => setForm(f => ({ ...f, use_date: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Products *</label>
              {form.items.map((item, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <Input
                    value={item.product_name}
                    onChange={e => updateItem(idx, 'product_name', e.target.value)}
                    placeholder="Product name (e.g. Aura)"
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={e => updateItem(idx, 'quantity', e.target.value)}
                    className="w-20"
                  />
                  {form.items.length > 1 && (
                    <button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              <button onClick={addItem} className="text-xs text-primary hover:underline flex items-center gap-1">
                <Plus className="h-3 w-3" /> Add product
              </button>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Additional Notes</label>
              <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Create Batch'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}