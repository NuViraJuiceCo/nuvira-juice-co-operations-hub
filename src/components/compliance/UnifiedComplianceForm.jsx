import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

const LOG_TYPES = {
  temperature: {
    label: '🌡️ Temperature',
    fields: ['location', 'temperature', 'min_range', 'max_range'],
    defaults: { location: 'Cold Room 1', temperature: '', min_range: 0, max_range: 5 }
  },
  pH: {
    label: '🧪 pH',
    fields: ['batch_id', 'product_name', 'ph_value', 'min_ph', 'max_ph'],
    defaults: { batch_id: '', product_name: '', ph_value: '', min_ph: 3.5, max_ph: 4.5 }
  },
  CCP: {
    label: '⚠️ CCP',
    fields: ['ccp_point', 'batch_id', 'measurement', 'critical_limit'],
    defaults: { ccp_point: 'Pasteurization', batch_id: '', measurement: '', critical_limit: '' }
  },
  sanitation: {
    label: '🧹 Sanitation',
    fields: ['area', 'sanitizer_type', 'cleaned', 'sanitized'],
    defaults: { area: 'Prep Area', sanitizer_type: '', cleaned: false, sanitized: false }
  },
  corrective_action: {
    label: '🔧 Corrective Action',
    fields: ['issue_type', 'issue_description', 'corrective_action_taken', 'verified_by'],
    defaults: { issue_type: 'Temperature Out of Range', issue_description: '', corrective_action_taken: '', verified_by: '' }
  },
  daily_checklist: {
    label: '📋 Daily Checklist',
    fields: ['shift', 'fridge_logged', 'sanitizer_checked', 'equipment_sanitized', 'areas_cleaned', 'batches_logged'],
    defaults: { shift: 'Morning', fridge_logged: false, sanitizer_checked: false, equipment_sanitized: false, areas_cleaned: false, batches_logged: false }
  }
};

export default function UnifiedComplianceForm() {
  const [activeTab, setActiveTab] = useState('temperature');
  const [formData, setFormData] = useState(LOG_TYPES.temperature.defaults);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    base44.auth.me().then(u => setUser(u));
  }, []);

  const handleLogTypeChange = (type) => {
    setActiveTab(type);
    setFormData(LOG_TYPES[type].defaults);
    setMessage('');
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!user) return;
    setLoading(true);
    setMessage('');

    try {
      const logEntry = {
        log_type: activeTab,
        log_date: new Date().toISOString().split('T')[0],
        log_time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }),
        staff_member: user.full_name,
        shift: getShift(),
        data: formData,
        status: getStatus(activeTab, formData)
      };

      await base44.entities.ComplianceLog.create(logEntry);
      setMessage('✓ Log saved successfully');
      setFormData(LOG_TYPES[activeTab].defaults);

      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const getShift = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Morning';
    if (hour < 17) return 'Afternoon';
    return 'Night';
  };

  const getStatus = (type, data) => {
    if (type === 'temperature') {
      return (data.temperature >= data.min_range && data.temperature <= data.max_range) ? 'pass' : 'fail';
    }
    if (type === 'pH') {
      return (data.ph_value >= data.min_ph && data.ph_value <= data.max_ph) ? 'pass' : 'fail';
    }
    if (type === 'sanitation') {
      return (data.cleaned && data.sanitized) ? 'complete' : 'incomplete';
    }
    return 'pass';
  };

  const config = LOG_TYPES[activeTab];
  const isValid = config.fields.every(f => formData[f] !== '' && formData[f] !== null);
  const status = getStatus(activeTab, formData);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Compliance Log Entry</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={handleLogTypeChange} className="w-full">
          <TabsList className="grid w-full grid-cols-3 lg:grid-cols-6">
            {Object.entries(LOG_TYPES).map(([key, val]) => (
              <TabsTrigger key={key} value={key} className="text-xs">{val.label}</TabsTrigger>
            ))}
          </TabsList>

          {Object.entries(LOG_TYPES).map(([logType, cfg]) => (
            <TabsContent key={logType} value={logType} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {cfg.fields.map(field => (
                  <div key={field}>
                    <label className="text-sm font-medium capitalize">{field.replace(/_/g, ' ')}</label>
                    {typeof formData[field] === 'boolean' ? (
                      <input
                        type="checkbox"
                        checked={formData[field]}
                        onChange={(e) => handleChange(field, e.target.checked)}
                        className="mt-1 w-full p-2 border rounded-lg"
                      />
                    ) : (
                      <input
                        type={field.includes('range') || field.includes('temp') || field.includes('pH') ? 'number' : 'text'}
                        value={formData[field]}
                        onChange={(e) => handleChange(field, e.target.value)}
                        className="mt-1 w-full p-2 border rounded-lg"
                        placeholder={`Enter ${field}`}
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* Status indicator */}
              {['temperature', 'pH'].includes(logType) && formData[logType === 'temperature' ? 'temperature' : 'ph_value'] && (
                <div className={`flex items-center gap-2 p-3 rounded-lg ${status === 'pass' ? 'bg-green-50' : 'bg-red-50'}`}>
                  {status === 'pass' ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      <span className="text-sm text-green-700">Within range ✓</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-4 h-4 text-red-600" />
                      <span className="text-sm text-red-700">Out of range ⚠️</span>
                    </>
                  )}
                </div>
              )}

              {message && (
                <div className={`p-3 rounded-lg text-sm ${message.includes('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                  {message}
                </div>
              )}

              <Button
                onClick={handleSubmit}
                disabled={!isValid || loading}
                className="w-full"
              >
                {loading ? 'Saving...' : 'Save Log Entry'}
              </Button>
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}