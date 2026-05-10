import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { CheckCircle2, AlertTriangle, X, ClipboardCheck, ExternalLink, Clock, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

/**
 * PreProductionChecklist
 *
 * Shows a modal/gate before starting a production batch.
 * Checks if today's required logs (Sanitation, Daily Checklist, Temperature) exist.
 * Admin can jump to the missing log or override/confirm.
 *
 * Props:
 *   batch       — ProductionBatch record being started
 *   onConfirm   — callback when admin confirms (proceed, overrideInfo?)
 *   onCancel    — callback when admin cancels
 */
export default function PreProductionChecklist({ batch, onConfirm, onCancel }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [showOverrideInput, setShowOverrideInput] = useState(false);

  const today = new Date().toISOString().split('T')[0];
  const prodDate = batch?.production_date || today;

  useEffect(() => {
    loadChecks();
  }, [batch?.id]);

  const loadChecks = async () => {
    setLoading(true);
    try {
      const [sanitationLogs, dailyChecklists, temperatureLogs, ccpLogs] = await Promise.all([
        base44.entities.SanitationLog?.list('-log_date', 50).catch(() => []),
        base44.entities.DailyChecklist?.list('-checklist_date', 20).catch(() => []),
        base44.entities.TemperatureLog?.list('-log_date', 50).catch(() => []),
        base44.entities.CCPLog?.list('-log_date', 50).catch(() => []),
      ]);

      // SanitationLog uses log_date; DailyChecklist uses checklist_date (canonical field name)
      const hasSanitation = (sanitationLogs || []).some(l => l.log_date === prodDate || l.log_date === today);
      const hasDailyChecklist = (dailyChecklists || []).some(l =>
        l.checklist_date === prodDate || l.checklist_date === today
      );
      const hasTemperature = (temperatureLogs || []).some(l => l.log_date === prodDate || l.log_date === today);
      const hasCCP = (ccpLogs || []).some(l => l.log_date === prodDate || l.log_date === today);

      setChecks([
        {
          id: 'sanitation',
          label: 'Pre-Op Sanitation Log',
          description: 'All equipment and surfaces sanitized and logged.',
          complete: hasSanitation,
          required: true,
          navigateTo: '/compliance',
        },
        {
          id: 'daily_checklist',
          label: 'Daily Checklist',
          description: 'Opening checklist completed for today.',
          complete: hasDailyChecklist,
          required: true,
          navigateTo: '/compliance',
        },
        {
          id: 'temperature',
          label: 'Temperature / Refrigerator Log',
          description: 'Cold storage temperature check logged.',
          complete: hasTemperature,
          required: false,
          navigateTo: '/compliance',
        },
        {
          id: 'ccp',
          label: 'CCP Monitoring',
          description: 'Critical control points checked.',
          complete: hasCCP,
          required: false,
          navigateTo: '/compliance',
        },
        {
          id: 'batch_ready',
          label: 'Batch Record Started',
          description: `Batch ${batch?.batch_id} is in the system.`,
          complete: !!batch?.batch_id,
          required: true,
          navigateTo: null,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const missingRequired = checks.filter(c => c.required && !c.complete);
  const allRequiredMet = missingRequired.length === 0;

  const handleConfirm = async (isOverride = false) => {
    setConfirming(true);
    const overrideInfo = isOverride ? {
      overridden_by: user?.email || 'unknown',
      overridden_at: new Date().toISOString(),
      override_reason: overrideReason || 'No reason provided',
      missing_checks: missingRequired.map(c => c.label),
    } : null;
    await onConfirm(overrideInfo);
    setConfirming(false);
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className={`px-5 py-4 rounded-t-2xl flex items-center justify-between ${allRequiredMet ? 'bg-green-600' : 'bg-amber-600'}`}>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-white" />
            <div>
              <p className="text-white font-bold text-sm">Pre-Production Checklist</p>
              <p className="text-white/80 text-[11px]">{batch?.batch_id} · {prodDate}</p>
            </div>
          </div>
          <button onClick={onCancel} className="text-white/80 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {!allRequiredMet && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800 font-medium">
                    {missingRequired.length} required log{missingRequired.length > 1 ? 's are' : ' is'} missing. 
                    Complete them before starting production or override below.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                {checks.map(check => (
                  <div key={check.id} className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                    check.complete
                      ? 'bg-green-50 border-green-200'
                      : check.required
                      ? 'bg-red-50 border-red-200'
                      : 'bg-amber-50/50 border-amber-200'
                  }`}>
                    {check.complete
                      ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                      : <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${check.required ? 'text-red-500' : 'text-amber-500'}`} />
                    }
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-semibold ${check.complete ? 'text-green-800' : check.required ? 'text-red-800' : 'text-amber-800'}`}>
                        {check.label}
                        {check.required && !check.complete && <span className="ml-1 text-red-500">*</span>}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{check.description}</p>
                    </div>
                    {!check.complete && check.navigateTo && (
                      <button
                        onClick={() => { onCancel(); navigate(check.navigateTo); }}
                        className="shrink-0 flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline"
                      >
                        Log it <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Staff / timestamp note */}
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground px-1">
                <Clock className="w-3 h-3" />
                <span>Checked at {new Date().toLocaleTimeString()} — Production date: {prodDate}</span>
              </div>
            </>
          )}
        </div>

        {/* Override reason input */}
        {showOverrideInput && !allRequiredMet && (
          <div className="px-5 pb-3">
            <p className="text-xs font-semibold text-amber-800 mb-1 flex items-center gap-1">
              <ShieldAlert className="w-3 h-3" /> Override Reason <span className="text-red-500">*</span>
            </p>
            <textarea
              value={overrideReason}
              onChange={e => setOverrideReason(e.target.value)}
              rows={2}
              placeholder="e.g. Sanitation completed verbally, log will be entered after batch starts..."
              className="w-full text-xs border border-amber-300 rounded-lg px-3 py-2 bg-amber-50 resize-none focus:outline-none focus:ring-1 focus:ring-amber-400"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Recorded by {user?.email} at {new Date().toLocaleTimeString()}
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-2">
          <Button variant="outline" onClick={onCancel} className="flex-1" size="sm">
            Cancel
          </Button>
          {!allRequiredMet && !showOverrideInput && (
            <Button
              variant="outline"
              onClick={() => setShowOverrideInput(true)}
              disabled={confirming || loading}
              className="flex-1 border-amber-300 text-amber-700 hover:bg-amber-50"
              size="sm"
            >
              Override & Start
            </Button>
          )}
          {!allRequiredMet && showOverrideInput && (
            <Button
              variant="outline"
              onClick={() => handleConfirm(true)}
              disabled={confirming || loading || !overrideReason.trim()}
              className="flex-1 border-amber-300 text-amber-700 hover:bg-amber-50"
              size="sm"
            >
              {confirming ? 'Starting...' : 'Confirm Override'}
            </Button>
          )}
          {allRequiredMet && (
            <Button
              onClick={() => handleConfirm(false)}
              disabled={confirming || loading}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
              size="sm"
            >
              {confirming ? 'Starting...' : '✓ Start Production'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}