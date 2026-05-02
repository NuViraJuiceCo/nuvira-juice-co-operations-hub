import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import moment from 'npm:moment@2.30.1';

// Test cutoff window logic without needing actual database orders
function evaluateWindow(orderPlacedAt) {
  const dayOfWeek = orderPlacedAt.day(); // 0=Sun, 6=Sat
  const timeInMinutes = orderPlacedAt.hour() * 60 + orderPlacedAt.minute();
  const twoPmMinutes = 14 * 60;

  let window = null;
  let assigned_production_day = null;
  let assigned_delivery_day = null;

  // WINDOW 1: Saturday 2:00 PM through Tuesday 2:00 PM → Tuesday production / Wednesday delivery
  if (
    (dayOfWeek === 6 && timeInMinutes >= twoPmMinutes) ||
    dayOfWeek === 0 ||
    dayOfWeek === 1 ||
    (dayOfWeek === 2 && timeInMinutes < twoPmMinutes)
  ) {
    window = 1;
    assigned_production_day = 'Tuesday';
    assigned_delivery_day = 'Wednesday';
  }
  // WINDOW 2: Tuesday 2:00 PM through Friday 2:00 PM → Friday production / Saturday delivery
  else if (
    (dayOfWeek === 2 && timeInMinutes >= twoPmMinutes) ||
    dayOfWeek === 3 ||
    dayOfWeek === 4 ||
    (dayOfWeek === 5 && timeInMinutes < twoPmMinutes)
  ) {
    window = 2;
    assigned_production_day = 'Friday';
    assigned_delivery_day = 'Saturday';
  }
  // WINDOW 3: Friday 2:00 PM through Saturday 2:00 PM → CONDITIONAL (Saturday or Tuesday depending on threshold)
  else if (
    (dayOfWeek === 5 && timeInMinutes >= twoPmMinutes) ||
    (dayOfWeek === 6 && timeInMinutes < twoPmMinutes)
  ) {
    window = 3;
    assigned_production_day = 'CONDITIONAL_SATURDAY';
    assigned_delivery_day = 'CONDITIONAL';
  }

  return { window, assigned_production_day, assigned_delivery_day };
}

Deno.serve(async (req) => {
  try {
    const testCases = [
      {
        id: 1,
        description: 'Order placed Saturday 2:01 PM',
        placedAt: moment('2026-05-02 14:01', 'YYYY-MM-DD HH:mm'), // Saturday
        expected_production: 'Tuesday',
        expected_delivery: 'Wednesday'
      },
      {
        id: 2,
        description: 'Order placed Sunday',
        placedAt: moment('2026-05-03 10:00', 'YYYY-MM-DD HH:mm'), // Sunday
        expected_production: 'Tuesday',
        expected_delivery: 'Wednesday'
      },
      {
        id: 3,
        description: 'Order placed Tuesday 1:59 PM',
        placedAt: moment('2026-05-05 13:59', 'YYYY-MM-DD HH:mm'), // Tuesday
        expected_production: 'Tuesday',
        expected_delivery: 'Wednesday'
      },
      {
        id: 4,
        description: 'Order placed Tuesday 2:01 PM',
        placedAt: moment('2026-05-05 14:01', 'YYYY-MM-DD HH:mm'), // Tuesday
        expected_production: 'Friday',
        expected_delivery: 'Saturday'
      },
      {
        id: 5,
        description: 'Order placed Friday 1:59 PM',
        placedAt: moment('2026-05-08 13:59', 'YYYY-MM-DD HH:mm'), // Friday
        expected_production: 'Friday',
        expected_delivery: 'Saturday'
      },
      {
        id: 6,
        description: 'Order placed Friday 2:01 PM (conditional window)',
        placedAt: moment('2026-05-08 14:01', 'YYYY-MM-DD HH:mm'), // Friday
        expected_production: 'CONDITIONAL_SATURDAY',
        expected_delivery: 'CONDITIONAL'
      },
      {
        id: 7,
        description: 'Order placed Saturday 1:59 PM (conditional window)',
        placedAt: moment('2026-05-09 13:59', 'YYYY-MM-DD HH:mm'), // Saturday
        expected_production: 'CONDITIONAL_SATURDAY',
        expected_delivery: 'CONDITIONAL'
      },
      {
        id: 8,
        description: 'Order placed Saturday 2:01 PM',
        placedAt: moment('2026-05-09 14:01', 'YYYY-MM-DD HH:mm'), // Saturday
        expected_production: 'Tuesday',
        expected_delivery: 'Wednesday'
      }
    ];

    const results = testCases.map(tc => {
      const eval_result = evaluateWindow(tc.placedAt);
      const passed = 
        eval_result.assigned_production_day === tc.expected_production &&
        eval_result.assigned_delivery_day === tc.expected_delivery;

      return {
        test_case: tc.id,
        description: tc.description,
        placed_at: tc.placedAt.format('YYYY-MM-DD HH:mm (dddd)'),
        expected_production: tc.expected_production,
        expected_delivery: tc.expected_delivery,
        actual_production: eval_result.assigned_production_day,
        actual_delivery: eval_result.assigned_delivery_day,
        passed,
        window: eval_result.window
      };
    });

    const allPassed = results.every(r => r.passed);

    return Response.json({
      test_summary: {
        total: results.length,
        passed: results.filter(r => r.passed).length,
        failed: results.filter(r => !r.passed).length,
        all_passed: allPassed
      },
      test_results: results,
      threshold_rules: {
        saturday_window: 'Friday after 2:00 PM through Saturday until 2:00 PM',
        threshold_requirement: '11+ eligible orders',
        threshold_met_action: 'Saturday production / Sunday delivery',
        threshold_not_met_action: 'Roll to Tuesday production / Wednesday delivery',
        case_9: '10 eligible orders in Saturday window = threshold NOT MET (roll to Tuesday)',
        case_10: '11 eligible orders in Saturday window = threshold MET (Saturday production)'
      }
    });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});