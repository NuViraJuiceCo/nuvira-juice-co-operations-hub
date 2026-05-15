import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import {
  CheckCircle2, Clock, AlertCircle, Zap, 
  ShieldCheck, ClipboardCheck, Thermometer, Beaker, Package
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import moment from 'moment';

/**
 * ProductionReadinessDashboard
 * 
 * Wraps ProductionAuditPacket with a live production workflow.
 * - Shows readiness checklist progress
 * - Distinguishes setup vs. production-active phases
 * - Provides actionable workflow buttons
 * - Guides staff through compliance setup intuitively
 */

const READINESS_STEPS = [
  { key: 'sanitation', label: 'Sanitation Complete', icon: ShieldCheck },
  { key: 'checklist', label: 'Daily Checklist Complete', icon: ClipboardCheck },
  { key: 'temperature', label: 'Temperature Logs Started', icon: Thermometer },
  { key: 'ccp', label: 'CCP Monitoring Started', icon: Beaker },
  { key: 'batch', label: 'Batch Logs Active', icon: Package },
];

function ReadinessProgressBar({ steps, productionDate, onActionClick }) {
  const completedCount = steps.filter(s => s.complete).length;
  const progressPercent = (completedCount / steps.length) * 100;
  const isSetupPhase = completedCount < steps.length;

  return (
    <div className="bg-gradient-to-r from-primary/5 to-accent/5 border border-primary/20 rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-bold text-sm flex items-center gap-2">
            {isSetupPhase ? (
              <>
                <Clock className="w-4 h-4 text-amber-500" />
                Production Setup In Progress
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Production Ready
              </>
            )}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {moment(productionDate).format('MMMM D, YYYY')} — {completedCount}/{steps.length} steps complete
          </p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1.5">
        <Progress value={progressPercent} className="h-2" />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{Math.round(progressPercent)}% Complete</span>
          <span>{completedCount}/{steps.length} Steps</span>
        </div>
      </div>

      {/* Checklist Items */}
      <div className="space-y-2">
        {steps.map((step) => (
          <div key={step.key} className="flex items-center gap-2">
            {step.complete ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                <span className="text-sm text-foreground line-through opacity-60">{step.label}</span>
              </>
            ) : (
              <>
                <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="text-sm text-foreground font-medium flex-1">{step.label}</span>
                {step.actionButton && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onActionClick(step.key)}
                    className="h-7 px-2 text-xs"
                  >
                    <Zap className="w-3 h-3 mr-1" />
                    Start
                  </Button>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {/* Status Message */}
      {!isSetupPhase && (
        <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
          <p className="text-xs text-green-800">
            All prerequisite compliance logs are initialized. Production can proceed.
          </p>
        </div>
      )}
    </div>
  );
}

export default function ProductionReadinessDashboard({ productionDate, onClose }) {
  const { user } = useAuth();
  const [readinessSteps, setReadinessSteps] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!productionDate) return;
    checkReadiness();
  }, [productionDate]);

  const checkReadiness = async () => {
    setLoading(true);
    try {
      const [
        sanitationLogs,
        dailyChecklists,
        temperatureLogs,
        ccpLogs,
        batchLogs,
      ] = await Promise.all([
        base44.entities.SanitationLog?.list().catch(() => []),
        base44.entities.DailyChecklist?.list().catch(() => []),
        base44.entities.TemperatureLog?.list().catch(() => []),
        base44.entities.CCPLog?.list().catch(() => []),
        base44.entities.BatchComplianceLog?.list().catch(() => []),
      ]);

      const steps = [
        {
          key: 'sanitation',
          label: 'Sanitation Complete',
          icon: ShieldCheck,
          complete: (sanitationLogs || []).some(l => l.log_date === productionDate),
          actionButton: true,
        },
        {
          key: 'checklist',
          label: 'Daily Checklist Complete',
          icon: ClipboardCheck,
          complete: (dailyChecklists || []).some(l => l.checklist_date === productionDate),
          actionButton: true,
        },
        {
          key: 'temperature',
          label: 'Temperature Logs Started',
          icon: Thermometer,
          complete: (temperatureLogs || []).some(l => l.log_date === productionDate),
          actionButton: true,
        },
        {
          key: 'ccp',
          label: 'CCP Monitoring Started',
          icon: Beaker,
          complete: (ccpLogs || []).some(l => l.log_date === productionDate),
          actionButton: true,
        },
        {
          key: 'batch',
          label: 'Batch Logs Active',
          icon: Package,
          complete: (batchLogs || []).some(l => l.date === productionDate),
          actionButton: false,
        },
      ];

      setReadinessSteps(steps);
    } finally {
      setLoading(false);
    }
  };

  const handleActionClick = async (stepKey) => {
    // Route to appropriate form/workflow
    const workflows = {
      sanitation: '/compliance?tab=sanitation&date=' + productionDate,
      checklist: '/compliance?tab=checklist&date=' + productionDate,
      temperature: '/compliance?tab=temperature&date=' + productionDate,
      ccp: '/compliance?tab=ccp&date=' + productionDate,
    };

    if (workflows[stepKey]) {
      window.location.href = workflows[stepKey];
    }
  };

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <ReadinessProgressBar
            steps={readinessSteps}
            productionDate={productionDate}
            onActionClick={handleActionClick}
          />
        </>
      )}
    </div>
  );
}