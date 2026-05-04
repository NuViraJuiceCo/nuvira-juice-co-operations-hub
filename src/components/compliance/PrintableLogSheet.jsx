import React from 'react';
import moment from 'moment';

// Printable sheet for a single compliance log — works for all log types
export default function PrintableLogSheet({ log, onClose }) {
  if (!log) return null;

  const handlePrint = () => window.print();

  const isBatch = log.source === 'production_batch';

  const title = isBatch
    ? '📦 Batch Production Compliance Log'
    : {
        temperature: '🌡️ Temperature Log',
        pH: '🧪 pH Log',
        CCP: '⚠️ Critical Control Point Log',
        sanitation: '🧹 Sanitation Log',
        corrective_action: '🔧 Corrective Action Log',
        daily_checklist: '📋 Daily Checklist Log',
      }[log.log_type] || 'Compliance Log';

  const date = log.log_date || log.date;
  const staffMember = log.staff_member || log.verified_by?.split('@')[0] || '—';
  const passFail = log.passed_failed || log.status || '—';

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center p-4 overflow-y-auto">
      {/* Screen-only controls */}
      <div className="print:hidden w-full max-w-2xl mb-4 flex gap-3 justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50"
        >
          ✕ Close
        </button>
        <button
          onClick={handlePrint}
          className="px-4 py-2 bg-green-700 text-white rounded-lg text-sm font-medium hover:bg-green-800"
        >
          🖨️ Print / Save as PDF
        </button>
      </div>

      {/* Printable sheet */}
      <div
        id="printable-log"
        className="bg-white w-full max-w-2xl rounded-lg shadow-xl p-8 print:shadow-none print:rounded-none print:p-6 print:max-w-full"
        style={{ fontFamily: 'Arial, sans-serif' }}
      >
        {/* Header */}
        <div className="border-b-2 border-gray-800 pb-4 mb-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-xl font-bold text-gray-900">NuVira Juice Company</h1>
              <h2 className="text-base font-semibold text-gray-700 mt-1">{title}</h2>
            </div>
            <div className="text-right text-sm text-gray-600">
              <p className="font-bold text-base">{moment(date).format('MMMM D, YYYY')}</p>
              {log.log_time && <p>{log.log_time}</p>}
            </div>
          </div>
        </div>

        {/* Common fields */}
        <div className="grid grid-cols-3 gap-4 mb-6 text-sm">
          <div>
            <p className="text-gray-500 text-xs uppercase font-semibold mb-1">Staff Member</p>
            <p className="font-medium">{staffMember}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs uppercase font-semibold mb-1">Date</p>
            <p className="font-medium">{moment(date).format('MMM D, YYYY')}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs uppercase font-semibold mb-1">Result</p>
            <p className={`font-bold ${passFail === 'passed' || passFail === 'pass' ? 'text-green-700' : passFail === 'failed' || passFail === 'fail' ? 'text-red-700' : 'text-gray-700'}`}>
              {passFail.toUpperCase()}
            </p>
          </div>
        </div>

        {/* Batch-specific fields */}
        {isBatch && (
          <div className="mb-6 space-y-4">
            <Row label="Batch ID" value={log.batch_id} />
            <Row label="Product / Flavor" value={log.juice_flavor || log.product_name} />
            <Row label="Quantity Produced" value={log.quantity_produced} />
            <Row label="pH Result" value={log.pH_result} />
            {log.start_time && <Row label="Start Time" value={moment(log.start_time).format('MMM D, HH:mm')} />}
            {log.end_time && <Row label="End Time" value={moment(log.end_time).format('MMM D, HH:mm')} />}
            {log.staff_on_duty?.length > 0 && <Row label="Staff on Duty" value={log.staff_on_duty.join(', ')} />}
            {log.ingredients?.length > 0 && (
              <div className="border border-gray-200 rounded p-3">
                <p className="text-xs text-gray-500 uppercase font-semibold mb-2">Ingredients Used</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-1 text-gray-600">Ingredient</th>
                      <th className="text-left py-1 text-gray-600">Quantity</th>
                      <th className="text-left py-1 text-gray-600">Unit</th>
                      <th className="text-left py-1 text-gray-600">Lot #</th>
                    </tr>
                  </thead>
                  <tbody>
                    {log.ingredients.map((ing, i) => (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="py-1">{ing.ingredient_name}</td>
                        <td className="py-1">{ing.quantity ?? '—'}</td>
                        <td className="py-1">{ing.unit ?? '—'}</td>
                        <td className="py-1">{ing.lot_number ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {log.verified_by && <Row label="Verified By" value={log.verified_by} />}
            {log.verified_at && <Row label="Verified At" value={moment(log.verified_at).format('MMM D, YYYY HH:mm')} />}
          </div>
        )}

        {/* CCP-specific fields */}
        {log.ccp_point && (
          <div className="mb-6 space-y-4">
            <Row label="CCP Point" value={log.ccp_point} />
            <Row label="Measurement" value={log.measurement} />
            <Row label="Critical Limit" value={log.critical_limit} />
            <Row label="Result" value={log.result} />
          </div>
        )}

        {/* Sanitation-specific fields */}
        {log.area && (
          <div className="mb-6 space-y-4">
            <Row label="Area" value={log.area} />
            <Row label="Sanitizer Type" value={log.sanitizer_type} />
            <Row label="Sanitizer Level" value={log.sanitizer_level} />
            <Row label="Cleaned" value={log.cleaned ? 'Yes' : 'No'} />
            <Row label="Sanitized" value={log.sanitized ? 'Yes' : 'No'} />
          </div>
        )}

        {/* Corrective Action-specific fields */}
        {log.issue_description && (
          <div className="mb-6 space-y-4">
            <Row label="Issue Type" value={log.issue_type} />
            <Row label="Issue Description" value={log.issue_description} />
            <Row label="Corrective Action Taken" value={log.corrective_action_taken} />
            <Row label="Status" value={log.status} />
            {log.verified_by && <Row label="Verified By" value={log.verified_by} />}
          </div>
        )}

        {/* Notes */}
        {log.notes && (
          <div className="mb-6 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm">
            <p className="font-semibold text-gray-700 mb-1">Notes:</p>
            <p className="text-gray-600">{log.notes}</p>
          </div>
        )}

        {/* Signature Lines */}
        <div className="mt-8 pt-6 border-t-2 border-gray-300 grid grid-cols-2 gap-8">
          <div>
            <p className="text-xs text-gray-500 mb-1">Staff Signature / Initials</p>
            <div className="w-full h-10 border-b border-gray-400 mt-4"></div>
            <p className="text-xs text-gray-400 mt-1">Name: _____________________ Date: _______</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Manager / Supervisor Verification</p>
            <div className="w-full h-10 border-b border-gray-400 mt-4"></div>
            <p className="text-xs text-gray-400 mt-1">Name: _____________________ Date: _______</p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-gray-200 text-xs text-gray-400 flex justify-between">
          <span>Record ID: {log.id}</span>
          <span>NuVira Juice Company — Official Compliance Record — Retain per food safety regulations</span>
        </div>
      </div>

      <style>{`
        @media print {
          body > *:not(#root) { display: none !important; }
          #root > * { display: none !important; }
          #printable-log { display: block !important; position: fixed; top: 0; left: 0; width: 100%; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between items-start border-b border-gray-100 pb-2 text-sm">
      <span className="text-gray-500 font-medium w-40 shrink-0">{label}</span>
      <span className="text-gray-800 text-right">{value ?? '—'}</span>
    </div>
  );
}