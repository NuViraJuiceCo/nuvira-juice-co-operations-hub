const CHICAGO_TIME_ZONE = 'America/Chicago';

function getPart(parts, type) {
  return parts.find((part) => part.type === type)?.value || '';
}

export function getChicagoDateInput(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  return `${getPart(parts, 'year')}-${getPart(parts, 'month')}-${getPart(parts, 'day')}`;
}

export function getChicagoTimeInput(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  return `${getPart(parts, 'hour')}:${getPart(parts, 'minute')}`;
}

export function getChicagoShift(date = new Date()) {
  const hour = Number(getChicagoTimeInput(date).split(':')[0]);
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  return 'Night';
}

export function isDailyChecklistPreProductionComplete(data) {
  return Boolean(
    data.morning_fridge_temp_logged &&
    data.sanitizer_levels_checked &&
    data.equipment_sanitized &&
    data.work_areas_cleaned
  );
}

export function calculateDailyChecklistStatus(data) {
  if (!isDailyChecklistPreProductionComplete(data)) return 'Incomplete';

  const closeoutComplete = Boolean(
    data.evening_fridge_temp_logged && data.batch_logs_completed
  );

  return closeoutComplete ? 'Complete' : 'Pending';
}
