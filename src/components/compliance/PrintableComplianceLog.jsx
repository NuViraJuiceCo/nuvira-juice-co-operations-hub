import React from 'react';

export default function PrintableComplianceLog({ log }) {
  if (!log) return null;

  const getLogTypeLabel = (type) => {
    const labels = {
      temperature: '🌡️ Temperature Log',
      pH: '🧪 pH Log',
      CCP: '⚠️ Critical Control Point',
      sanitation: '🧹 Sanitation Log',
      corrective_action: '🔧 Corrective Action',
      daily_checklist: '📋 Daily Checklist'
    };
    return labels[type] || type;
  };

  return (
    <div className="bg-white p-8 border border-gray-200 rounded-lg mb-4 print:page-break-inside-avoid" style={{ pageBreakInside: 'avoid' }}>
      {/* Header */}
      <div className="border-b-2 border-gray-300 pb-4 mb-4">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-lg font-bold">{getLogTypeLabel(log.log_type)}</h2>
            <p className="text-sm text-gray-600 mt-1">NuVira Juice Company Compliance Record</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold">{log.log_date}</p>
            <p className="text-gray-600">{log.log_time}</p>
          </div>
        </div>
      </div>

      {/* Staff & Status */}
      <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
        <div>
          <p className="text-gray-600 font-semibold">Staff Member</p>
          <p>{log.staff_member}</p>
        </div>
        <div>
          <p className="text-gray-600 font-semibold">Shift</p>
          <p>{log.shift}</p>
        </div>
        <div>
          <p className="text-gray-600 font-semibold">Status</p>
          <p className={log.status === 'pass' ? 'text-green-700 font-bold' : 'text-red-700 font-bold'}>
            {log.status.toUpperCase()}
          </p>
        </div>
      </div>

      {/* Data Details */}
      {log.data && Object.keys(log.data).length > 0 && (
        <div className="mb-4">
          <p className="text-gray-600 font-semibold text-sm mb-2">Details:</p>
          <div className="grid grid-cols-2 gap-2 text-sm bg-gray-50 p-3 rounded">
            {Object.entries(log.data).map(([key, value]) => (
              <div key={key} className="flex justify-between">
                <span className="font-medium text-gray-700">{key.replace(/_/g, ' ')}:</span>
                <span className="text-gray-600">{String(value) || '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {log.notes && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm">
          <p className="font-semibold text-gray-700">Notes:</p>
          <p className="text-gray-600">{log.notes}</p>
        </div>
      )}

      {/* Signature Line */}
      <div className="mt-6 pt-4 border-t border-gray-300 flex justify-between">
        <div>
          <p className="text-xs text-gray-600 mb-1">Staff Signature / Initial</p>
          <div className="w-32 h-12 border-b border-gray-400"></div>
        </div>
        <div>
          <p className="text-xs text-gray-600 mb-1">Verification (Manager)</p>
          <div className="w-32 h-12 border-b border-gray-400"></div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 pt-4 border-t border-gray-200 text-xs text-gray-500">
        <p>Record ID: {log.id} | Created: {log.created_date || 'N/A'}</p>
        <p>This is an official compliance record and must be retained per food safety regulations.</p>
      </div>
    </div>
  );
}