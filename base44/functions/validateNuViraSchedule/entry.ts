/**
 * validateNuViraSchedule
 *
 * Centralized Phase 5 schedule validation engine.
 * Enforces official NuVira fulfillment schedule rules:
 *   - Production days: Tuesday (2) and Friday (5) ONLY
 *   - Delivery days: Wednesday (3) and Saturday (6) ONLY
 *   - Wednesday delivery → 5:00 PM – 8:00 PM
 *   - Saturday delivery → 12:00 PM – 3:00 PM
 *
 * Used by: customerAppEventPublicGateway, recalculateProductionBatches,
 *          FulfillmentTask creation, ProductionBatch creation, Driver Portal resolver
 *
 * Export contract:
 *   validateSchedulePayload(payload) → { valid, errors, reason_code }
 *   calculateScheduleFromPaidAt(paidAtISO, fulfillmentCount) → { fulfillments[], final_schedule_source }
 *   isValidProductionDate(dateStr) → boolean
 *   isValidDeliveryDate(dateStr) → boolean
 *   getExpectedWindowForDelivery(dateStr) → string | null
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TZ = 'America/Chicago';
const VALID_PRODUCTION_DAYS = new Set([2, 5]); // Tue=2, Fri=5
const VALID_DELIVERY_DAYS = new Set([3, 6]);   // Wed=3, Sat=6

const WINDOW_WEDNESDAY = '5:00 PM – 8:00 PM';
const WINDOW_SATURDAY  = '12:00 PM – 3:00 PM';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseDateLocal(dateStr) {
  // Parse YYYY-MM-DD as local midnight (no UTC shift)
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toChicagoDayOfWeek(dateStr) {
  // Get day-of-week in Chicago timezone from YYYY-MM-DD string
  const d = parseDateLocal(dateStr);
  return d.getDay();
}

function isValidProductionDate(dateStr) {
  if (!dateStr) return false;
  return VALID_PRODUCTION_DAYS.has(toChicagoDayOfWeek(dateStr));
}

function isValidDeliveryDate(dateStr) {
  if (!dateStr) return false;
  return VALID_DELIVERY_DAYS.has(toChicagoDayOfWeek(dateStr));
}

function getExpectedWindowForDelivery(dateStr) {
  if (!dateStr) return null;
  const dow = toChicagoDayOfWeek(dateStr);
  if (dow === 3) return WINDOW_WEDNESDAY;
  if (dow === 6) return WINDOW_SATURDAY;
  return null;
}

// ─── Validate an incoming schedule payload ────────────────────────────────────
function validateSchedulePayload(payload) {
  const errors = [];

  if (!payload) {
    return { valid: false, errors: ['No payload provided'], reason_code: 'INVALID_SCHEDULE' };
  }

  const { production_date, delivery_date, delivery_window_label, fulfillments } = payload;

  // Validate top-level dates if present (one-time order style)
  if (production_date) {
    if (!isValidProductionDate(production_date)) {
      errors.push(`production_date ${production_date} is not a valid NuVira production day (must be Tuesday or Friday)`);
    }
  }
  if (delivery_date) {
    if (!isValidDeliveryDate(delivery_date)) {
      errors.push(`delivery_date ${delivery_date} is not a valid NuVira delivery day (must be Wednesday or Saturday)`);
    } else if (delivery_window_label) {
      const expected = getExpectedWindowForDelivery(delivery_date);
      const normalized = delivery_window_label.replace(/\s+/g, ' ').trim();
      if (expected && normalized !== expected) {
        errors.push(`delivery_window_label "${delivery_window_label}" does not match expected window for ${delivery_date}: "${expected}"`);
      }
    }
  }

  // Validate fulfillments array if present (subscription style)
  if (Array.isArray(fulfillments) && fulfillments.length > 0) {
    fulfillments.forEach((f, idx) => {
      const fNum = f.fulfillment_number || idx + 1;

      if (f.production_date && !isValidProductionDate(f.production_date)) {
        errors.push(`Fulfillment #${fNum}: production_date ${f.production_date} is not a valid NuVira production day (Tue or Fri)`);
      }
      if (f.scheduled_date && !isValidDeliveryDate(f.scheduled_date)) {
        errors.push(`Fulfillment #${fNum}: scheduled_date ${f.scheduled_date} is not a valid NuVira delivery day (Wed or Sat)`);
      }
      if (f.scheduled_date && f.delivery_window_label) {
        const expected = getExpectedWindowForDelivery(f.scheduled_date);
        const normalized = f.delivery_window_label.replace(/\s+/g, ' ').trim();
        if (expected && normalized !== expected) {
          errors.push(`Fulfillment #${fNum}: delivery_window_label "${f.delivery_window_label}" should be "${expected}" for ${f.scheduled_date}`);
        }
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    reason_code: errors.length > 0 ? 'INVALID_SCHEDULE' : null,
  };
}

// ─── Calculate schedule from paid_at timestamp ────────────────────────────────
// Official NuVira cutoff rules (America/Chicago):
//   Fri before 2 PM → Fri production → Sat delivery (12–3 PM)
//   Fri at/after 2 PM through Tue before 2 PM → Tue production → Wed delivery (5–8 PM)
//   Tue before 2 PM → Tue production → Wed delivery (5–8 PM)
//   Tue at/after 2 PM through Fri before 2 PM → Fri production → Sat delivery (12–3 PM)

function calculateScheduleFromPaidAt(paidAtISO, fulfillmentCount = 1) {
  const paidAt = new Date(paidAtISO);

  // Convert to Chicago time — use separate fields to avoid locale string parsing issues
  const chicagoHour = parseInt(paidAt.toLocaleString('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }), 10);
  const chicagoMinute = parseInt(paidAt.toLocaleString('en-US', { timeZone: TZ, minute: '2-digit', hour12: false }), 10);
  const weekdayName = paidAt.toLocaleString('en-US', { timeZone: TZ, weekday: 'long' }).toLowerCase();
  const localHour = chicagoHour;
  const localMinute = chicagoMinute;
  const isPastCutoff = localHour > 14 || (localHour === 14 && localMinute > 0);

  // Get day-of-week in Chicago timezone reliably
  const chicagoDayStr = paidAt.toLocaleString('en-US', { timeZone: TZ, weekday: 'short' });
  const dowMap = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
  const dow = dowMap[chicagoDayStr] ?? new Date(paidAt.toLocaleString('en-US', { timeZone: TZ })).getDay();
  
  // Get Chicago local date for base date computation
  const chicagoDateStr = paidAt.toLocaleString('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  // chicagoDateStr format: "MM/DD/YYYY"
  const [cm, cd, cy] = chicagoDateStr.split('/').map(Number);
  const localDate = new Date(cy, cm - 1, cd);

  let productionDate;
  let deliveryDate;
  let deliveryWindow;
  let scheduleReason;
  let cutoffWindowLabel;

  // Determine which production/delivery cycle applies
  // Tue (dow=2) at or before 2PM → same Tue production → next day Wed delivery
  // Tue (dow=2) after 2PM → next Fri production → next Sat delivery
  // Fri (dow=5) at or before 2PM → same Fri production → next day Sat delivery
  // Fri (dow=5) after 2PM → next Tue production → next Wed delivery
  // All other days: find next Tue or Fri

  const baseDate = new Date(localDate);
  baseDate.setHours(0, 0, 0, 0);

  let daysUntilProduction;
  let isWednesdayDelivery;

  if (dow === 2 && !isPastCutoff) {
    // Tuesday at or before 2PM → this Tuesday → Wednesday delivery
    daysUntilProduction = 0;
    isWednesdayDelivery = true;
    scheduleReason = 'tuesday_at_or_before_2pm';
    cutoffWindowLabel = 'Tue ≤2PM';
  } else if (dow === 2 && isPastCutoff) {
    // Tuesday after 2PM → next Friday → Saturday delivery
    daysUntilProduction = 3;
    isWednesdayDelivery = false;
    scheduleReason = 'tuesday_after_2pm_through_friday_2pm';
    cutoffWindowLabel = 'Tue >2PM';
  } else if (dow === 5 && !isPastCutoff) {
    // Friday at or before 2PM → this Friday → Saturday delivery
    daysUntilProduction = 0;
    isWednesdayDelivery = false;
    scheduleReason = 'friday_at_or_before_2pm';
    cutoffWindowLabel = 'Fri ≤2PM';
  } else if (dow === 5 && isPastCutoff) {
    // Friday after 2PM → next Tuesday → Wednesday delivery
    daysUntilProduction = 4;
    isWednesdayDelivery = true;
    scheduleReason = 'friday_after_2pm_through_tuesday_2pm';
    cutoffWindowLabel = 'Fri >2PM';
  } else {
    // Other days — find next applicable production slot
    if (dow === 0) { // Sunday → next Tue
      daysUntilProduction = 2;
      isWednesdayDelivery = true;
      scheduleReason = 'sunday_next_tuesday';
      cutoffWindowLabel = 'Sun → Tue';
    } else if (dow === 1) { // Monday → next Tue
      daysUntilProduction = 1;
      isWednesdayDelivery = true;
      scheduleReason = 'monday_next_tuesday';
      cutoffWindowLabel = 'Mon → Tue';
    } else if (dow === 3) { // Wednesday → next Fri
      daysUntilProduction = 2;
      isWednesdayDelivery = false;
      scheduleReason = 'wednesday_next_friday';
      cutoffWindowLabel = 'Wed → Fri';
    } else if (dow === 4) { // Thursday → next Fri
      daysUntilProduction = 1;
      isWednesdayDelivery = false;
      scheduleReason = 'thursday_next_friday';
      cutoffWindowLabel = 'Thu → Fri';
    } else { // Saturday → next Tue
      daysUntilProduction = 3;
      isWednesdayDelivery = true;
      scheduleReason = 'saturday_next_tuesday';
      cutoffWindowLabel = 'Sat → Tue';
    }
  }

  const prodDate = new Date(baseDate);
  prodDate.setDate(prodDate.getDate() + daysUntilProduction);
  const delivDate = new Date(prodDate);
  delivDate.setDate(prodDate.getDate() + 1);

  productionDate = prodDate.toISOString().split('T')[0];
  deliveryDate = delivDate.toISOString().split('T')[0];
  deliveryWindow = isWednesdayDelivery ? WINDOW_WEDNESDAY : WINDOW_SATURDAY;

  // Build weekly fulfillment schedule
  const fulfillments = [];
  for (let i = 0; i < fulfillmentCount; i++) {
    const fp = new Date(prodDate);
    fp.setDate(prodDate.getDate() + 7 * i);
    const fd = new Date(delivDate);
    fd.setDate(delivDate.getDate() + 7 * i);
    fulfillments.push({
      fulfillment_number: i + 1,
      production_date: fp.toISOString().split('T')[0],
      scheduled_date: fd.toISOString().split('T')[0],
      delivery_window_label: deliveryWindow,
      delivery_window_start: isWednesdayDelivery ? '17:00' : '12:00',
      delivery_window_end: isWednesdayDelivery ? '20:00' : '15:00',
      schedule_timezone: TZ,
    });
  }

  return {
    production_date: productionDate,
    delivery_date: deliveryDate,
    delivery_window_label: deliveryWindow,
    delivery_window_start: isWednesdayDelivery ? '17:00' : '12:00',
    delivery_window_end: isWednesdayDelivery ? '20:00' : '15:00',
    schedule_reason: scheduleReason,
    cutoff_window_label: cutoffWindowLabel,
    schedule_timezone: TZ,
    final_schedule_source: 'central_engine',
    fulfillments,
    _debug: { dow, isPastCutoff, weekdayName, localHour, localMinute }
  };
}

// ─── HTTP handler (self-test + utility endpoint) ─────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Allow internal system calls via secret, otherwise require admin
    const internalSecret = Deno.env.get('INTERNAL_FUNCTION_SECRET');
    let isInternalCall = false;
    if (req.method === 'POST') {
      try {
        const body = await req.clone().json();
        isInternalCall = body._internalSecret && internalSecret && body._internalSecret === internalSecret;
      } catch (_) {}
    }
    if (!isInternalCall) {
      const user = await base44.auth.me();
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      if (user.role !== 'admin') return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    let body = {};
    if (req.method === 'POST') {
      body = await req.json().catch(() => ({}));
    }

    const { action, paid_at, fulfillment_count, payload } = body;

    if (action === 'calculate') {
      if (!paid_at) return Response.json({ error: 'paid_at required' }, { status: 400 });
      const result = calculateScheduleFromPaidAt(paid_at, fulfillment_count || 1);
      return Response.json({ success: true, result });
    }

    if (action === 'validate') {
      if (!payload) return Response.json({ error: 'payload required' }, { status: 400 });
      const result = validateSchedulePayload(payload);
      return Response.json({ success: true, result });
    }

    // Self-test — run all required Phase 5 tests
    const tests = [];

    // Test 1: Friday after cutoff (14:01) → Tue production, Wed delivery, 5-8PM
    const t1 = calculateScheduleFromPaidAt('2026-05-08T14:01:00-05:00', 1);
    tests.push({
      name: 'Friday 2:01 PM CST (after cutoff)',
      paid_at: '2026-05-08T14:01:00-05:00',
      expected: { production_date: '2026-05-12', delivery_date: '2026-05-13', window: WINDOW_WEDNESDAY },
      actual: { production_date: t1.production_date, delivery_date: t1.delivery_date, window: t1.delivery_window_label },
      pass: t1.production_date === '2026-05-12' && t1.delivery_date === '2026-05-13' && t1.delivery_window_label === WINDOW_WEDNESDAY,
      schedule_reason: t1.schedule_reason,
    });

    // Test 2: Tuesday after cutoff (14:01) → Fri production, Sat delivery, 12-3PM
    const t2 = calculateScheduleFromPaidAt('2026-05-12T14:01:00-05:00', 1);
    tests.push({
      name: 'Tuesday 2:01 PM CST (after cutoff)',
      paid_at: '2026-05-12T14:01:00-05:00',
      expected: { production_date: '2026-05-15', delivery_date: '2026-05-16', window: WINDOW_SATURDAY },
      actual: { production_date: t2.production_date, delivery_date: t2.delivery_date, window: t2.delivery_window_label },
      pass: t2.production_date === '2026-05-15' && t2.delivery_date === '2026-05-16' && t2.delivery_window_label === WINDOW_SATURDAY,
      schedule_reason: t2.schedule_reason,
    });

    // Test 3: Subscription paid Friday after cutoff — 4 Wednesday fulfillments
    const t3 = calculateScheduleFromPaidAt('2026-05-08T14:01:00-05:00', 4);
    const t3Expected = [
      { fn: 1, prod: '2026-05-12', deliv: '2026-05-13', win: WINDOW_WEDNESDAY },
      { fn: 2, prod: '2026-05-19', deliv: '2026-05-20', win: WINDOW_WEDNESDAY },
      { fn: 3, prod: '2026-05-26', deliv: '2026-05-27', win: WINDOW_WEDNESDAY },
      { fn: 4, prod: '2026-06-02', deliv: '2026-06-03', win: WINDOW_WEDNESDAY },
    ];
    const t3Pass = t3Expected.every((e, i) =>
      t3.fulfillments[i]?.production_date === e.prod &&
      t3.fulfillments[i]?.scheduled_date === e.deliv &&
      t3.fulfillments[i]?.delivery_window_label === e.win
    );
    tests.push({
      name: 'Subscription paid Friday after cutoff (4 fulfillments)',
      paid_at: '2026-05-08T14:01:00-05:00',
      expected: t3Expected,
      actual: t3.fulfillments.map(f => ({ fn: f.fulfillment_number, prod: f.production_date, deliv: f.scheduled_date, win: f.delivery_window_label })),
      pass: t3Pass,
    });

    // Test 4: Subscription paid Tuesday after cutoff — 4 Saturday fulfillments
    const t4 = calculateScheduleFromPaidAt('2026-05-12T14:01:00-05:00', 4);
    const t4Expected = [
      { fn: 1, prod: '2026-05-15', deliv: '2026-05-16' },
      { fn: 2, prod: '2026-05-22', deliv: '2026-05-23' },
      { fn: 3, prod: '2026-05-29', deliv: '2026-05-30' },
      { fn: 4, prod: '2026-06-05', deliv: '2026-06-06' },
    ];
    const t4Pass = t4Expected.every((e, i) =>
      t4.fulfillments[i]?.production_date === e.prod &&
      t4.fulfillments[i]?.scheduled_date === e.deliv &&
      t4.fulfillments[i]?.delivery_window_label === WINDOW_SATURDAY
    );
    tests.push({
      name: 'Subscription paid Tuesday after cutoff (4 fulfillments)',
      paid_at: '2026-05-12T14:01:00-05:00',
      expected: t4Expected.map(e => ({ ...e, win: WINDOW_SATURDAY })),
      actual: t4.fulfillments.map(f => ({ fn: f.fulfillment_number, prod: f.production_date, deliv: f.scheduled_date, win: f.delivery_window_label })),
      pass: t4Pass,
      debug: t4._debug,
    });

    // Test 5: Invalid schedule protection — Sat prod (dow=6 not in {2,5}), Sun deliv (dow=0 not in {3,6})
    // 2026-05-09 = Saturday, 2026-05-10 = Sunday — both invalid
    const t5 = validateSchedulePayload({ production_date: '2026-05-09', delivery_date: '2026-05-10' });
    tests.push({
      name: 'Invalid schedule payload (Sat production=dow6, Sun delivery=dow0)',
      payload: { production_date: '2026-05-09', delivery_date: '2026-05-10' },
      expected: 'rejected',
      actual: t5.valid ? 'accepted' : 'rejected',
      pass: !t5.valid,
      errors: t5.errors,
      dow_checks: {
        prod_dow: (function(){ const [y,m,d]='2026-05-09'.split('-').map(Number); return new Date(y,m-1,d).getDay(); })(),
        deliv_dow: (function(){ const [y,m,d]='2026-05-10'.split('-').map(Number); return new Date(y,m-1,d).getDay(); })(),
      }
    });

    // Test 6: Valid schedule payload — 2026-05-12 = Tuesday (dow=2 ✓), 2026-05-13 = Wednesday (dow=3 ✓)
    // NOTE: validateSchedulePayload only enforces for central_engine payloads
    // For top-level production_date/delivery_date it always validates regardless of source
    const t6payload = { production_date: '2026-05-12', delivery_date: '2026-05-13', delivery_window_label: WINDOW_WEDNESDAY };
    const t6 = validateSchedulePayload(t6payload);
    tests.push({
      name: 'Valid schedule payload (Tue prod=2026-05-12 dow=2, Wed deliv=2026-05-13 dow=3, correct window)',
      payload: t6payload,
      expected: 'accepted',
      actual: t6.valid ? 'accepted' : 'rejected',
      pass: t6.valid,
      errors: t6.errors,
    });

    const allPassed = tests.every(t => t.pass);

    return Response.json({
      engine: 'validateNuViraSchedule v1 — Phase 5',
      all_tests_passed: allPassed,
      tests,
      valid_production_days: 'Tuesday (2), Friday (5)',
      valid_delivery_days: 'Wednesday (3), Saturday (6)',
      wednesday_window: WINDOW_WEDNESDAY,
      saturday_window: WINDOW_SATURDAY,
    });

  } catch (error) {
    console.error('[SCHEDULE-VALIDATOR] ERROR:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});