import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import TemperatureLogForm from '@/components/compliance/TemperatureLogForm';
import PHLogForm from '@/components/compliance/pHLogForm';
import CCPLogForm from '@/components/compliance/CCPLogForm';
import SanitationLogForm from '@/components/compliance/SanitationLogForm';
import CorrectiveActionForm from '@/components/compliance/CorrectiveActionForm';
import DailyChecklistForm from '@/components/compliance/DailyChecklistForm';
import ReceivingLogForm from '@/components/compliance/ReceivingLogForm';
import { getChicagoDateInput } from '@/lib/compliancePersistence';

const LOG_TYPES = {
  temperature: { label: 'Temperature', component: TemperatureLogForm },
  pH: { label: 'pH', component: PHLogForm },
  CCP: { label: 'CCP', component: CCPLogForm },
  sanitation: { label: 'Sanitation', component: SanitationLogForm },
  daily_checklist: { label: 'Daily Checklist', component: DailyChecklistForm },
  receiving: { label: 'Receiving', component: ReceivingLogForm },
  corrective_action: { label: 'Corrective Action', component: CorrectiveActionForm },
};

function normalizeTab(value) {
  if (value === 'ccp') return 'CCP';
  if (value === 'checklist') return 'daily_checklist';
  return Object.hasOwn(LOG_TYPES, value) ? value : 'temperature';
}

export default function UnifiedComplianceForm() {
  const [searchParams] = useSearchParams();
  const requestedTab = normalizeTab(searchParams.get('tab'));
  const requestedDate = searchParams.get('date') || getChicagoDateInput();
  const [activeTab, setActiveTab] = useState(requestedTab);

  useEffect(() => {
    setActiveTab(requestedTab);
  }, [requestedTab]);

  const ActiveForm = LOG_TYPES[activeTab].component;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>New Compliance Entry</CardTitle>
          <p className="text-sm text-muted-foreground">
            Records are saved to the same compliance entities used by production gates and audit packets.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Object.entries(LOG_TYPES).map(([key, config]) => (
              <button
                type="button"
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-3 py-2 rounded-md text-xs font-medium border transition-colors ${
                  activeTab === key
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-foreground border-border hover:bg-muted'
                }`}
              >
                {config.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <ActiveForm key={`${activeTab}-${requestedDate}`} initialDate={requestedDate} />
    </div>
  );
}
