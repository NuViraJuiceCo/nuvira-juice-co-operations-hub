import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  calculateDailyChecklistStatus,
  getChicagoDateInput,
  getChicagoShift,
  getChicagoTimeInput,
  isDailyChecklistPreProductionComplete,
} from '../src/lib/compliancePersistence.js';

const preProductionComplete = {
  morning_fridge_temp_logged: true,
  sanitizer_levels_checked: true,
  equipment_sanitized: true,
  work_areas_cleaned: true,
};

assert.equal(getChicagoDateInput(new Date('2026-08-01T04:30:00.000Z')), '2026-07-31');
assert.equal(getChicagoTimeInput(new Date('2026-08-01T04:30:00.000Z')), '23:30');
assert.equal(getChicagoShift(new Date('2026-08-01T04:30:00.000Z')), 'Night');
assert.equal(getChicagoDateInput(new Date('2026-08-01T06:00:00.000Z')), '2026-08-01');

assert.equal(isDailyChecklistPreProductionComplete(preProductionComplete), true);
assert.equal(calculateDailyChecklistStatus({}), 'Incomplete');
assert.equal(calculateDailyChecklistStatus(preProductionComplete), 'Pending');
assert.equal(calculateDailyChecklistStatus({
  ...preProductionComplete,
  evening_fridge_temp_logged: true,
  batch_logs_completed: true,
  ccp_logs_completed: false,
}), 'Complete');

const unifiedForm = await readFile(new URL('../src/components/compliance/UnifiedComplianceForm.jsx', import.meta.url), 'utf8');
for (const canonicalForm of [
  'TemperatureLogForm',
  'PHLogForm',
  'CCPLogForm',
  'SanitationLogForm',
  'DailyChecklistForm',
  'ReceivingLogForm',
  'CorrectiveActionForm',
]) {
  assert.match(unifiedForm, new RegExp(canonicalForm));
}
assert.doesNotMatch(unifiedForm, /ComplianceLog\.create/);

const preStartGate = await readFile(new URL('../src/components/production/PreProductionChecklist.jsx', import.meta.url), 'utf8');
assert.match(preStartGate, /tab=daily_checklist&date=/);
assert.match(preStartGate, /isDailyChecklistPreProductionComplete/);

const auditPacket = await readFile(new URL('../src/components/compliance/ProductionAuditPacket.jsx', import.meta.url), 'utf8');
assert.match(auditPacket, /No CCP entry is required unless a deviation/);
assert.match(auditPacket, /receivingLogs/);

const complianceSchema = JSON.parse(await readFile(new URL('../base44/entities/ComplianceLog.jsonc', import.meta.url), 'utf8'));
assert.equal(complianceSchema.properties.log_type.enum.includes('receiving'), true);

console.log('Compliance persistence regressions passed.');
