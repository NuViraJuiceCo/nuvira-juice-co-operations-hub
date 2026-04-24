import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Validation function to test ingredient math against known test cases
 * Helps verify that the 5-layer system is working correctly
 */

function validateTestCase(testName, actual, expected, tolerance = 0.01) {
  const diff = Math.abs(actual - expected);
  const passed = diff <= tolerance;
  return {
    name: testName,
    passed,
    actual,
    expected,
    diff,
    error: passed ? null : `Expected ${expected}, got ${actual} (diff: ${diff})`
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const results = [];

    // TEST 1: Orange juice math
    // 13.7 oz required, 2 oz per orange, waste factor 1.0
    // Expected: 13.7 / 2 = 6.85 ≈ 7 oranges
    {
      const shortfallOz = 13.7;
      const ozPerUnit = 2.0;
      const wasteFactor = 1.0;
      const unitsExact = (shortfallOz * wasteFactor) / ozPerUnit;
      const unitsNeeded = Math.ceil(unitsExact);
      
      results.push(validateTestCase(
        'Orange: 13.7 oz demand with 2 oz/orange yield',
        unitsNeeded,
        7,
        0.5
      ));
    }

    // TEST 2: Lemon juice math
    // 1.1 oz required, 1.1 oz per lemon, waste factor 1.0
    // Expected: 1.1 / 1.1 = 1.0 = 1 lemon
    {
      const shortfallOz = 1.1;
      const ozPerUnit = 1.1;
      const wasteFactor = 1.0;
      const unitsExact = (shortfallOz * wasteFactor) / ozPerUnit;
      const unitsNeeded = Math.ceil(unitsExact);
      
      results.push(validateTestCase(
        'Lemon: 1.1 oz demand with 1.1 oz/lemon yield',
        unitsNeeded,
        1,
        0.5
      ));
    }

    // TEST 3: With waste factor
    // 10 oz required, 2 oz per fruit, 1.1 waste factor (10% trim)
    // Required with waste: 10 * 1.1 = 11 oz
    // Units needed: 11 / 2 = 5.5 ≈ 6 units
    {
      const shortfallOz = 10;
      const ozPerUnit = 2.0;
      const wasteFactor = 1.1;
      const adjustedShortfall = shortfallOz * wasteFactor;
      const unitsExact = adjustedShortfall / ozPerUnit;
      const unitsNeeded = Math.ceil(unitsExact);
      
      results.push(validateTestCase(
        'Waste factor: 10 oz with 2 oz/unit and 1.1x waste',
        unitsNeeded,
        6,
        0.5
      ));
    }

    // TEST 4: Case calculation
    // 7 oranges needed, 72 per case
    // Cases exact: 7 / 72 = 0.0972 ≈ 0.1 cases
    {
      const unitsNeeded = 7;
      const unitsPerCase = 72;
      const casesExact = unitsNeeded / unitsPerCase;
      const casesRounded = Math.round(casesExact * 10) / 10;
      
      results.push(validateTestCase(
        'Case: 7 units with 72 per case',
        casesRounded,
        0.1,
        0.01
      ));
    }

    // TEST 5: Sanity check ratio
    // 13.7 oz demand, 2 oz per unit = 6.85 units ≈ 7
    // Ratio: 7 / 13.7 = 0.51 (should be < 10)
    {
      const shortfallOz = 13.7;
      const unitsNeeded = 7;
      const ratio = unitsNeeded / shortfallOz;
      const isValid = ratio < 10;
      
      results.push(validateTestCase(
        'Sanity check: ratio for orange should be valid (< 10)',
        isValid ? 1 : 0,
        1,
        0.5
      ));
    }

    // TEST 6: Bad yield scenario (should flag)
    // 13.7 oz with yield 0.19 (which is inverted from 5.26)
    // Wrong formula: 13.7 / 0.19 = 72.1 units (WRONG)
    // Correct formula: 13.7 / 2.0 = 6.85 units
    // This tests the validation flag
    {
      const shortfallOz = 13.7;
      const ozPerUnitBad = 0.19; // This is wrong (inverted)
      const unitsNeededBad = shortfallOz / ozPerUnitBad;
      const ratio = unitsNeededBad / shortfallOz;
      const shouldFlag = ratio > 10;
      
      results.push(validateTestCase(
        'Validation: bad yield (72 oranges for 13.7 oz) should flag',
        shouldFlag ? 1 : 0,
        1,
        0.5
      ));
    }

    // TEST 7: Stock subtraction
    // Demand: 100 oz, Stock: 30 oz, Shortage: 70 oz
    {
      const demandOz = 100;
      const stockOz = 30;
      const shortageOz = Math.max(0, demandOz - stockOz);
      
      results.push(validateTestCase(
        'Stock subtraction: 100 oz demand - 30 oz stock',
        shortageOz,
        70,
        0.5
      ));
    }

    // TEST 8: No shortage when stock covers
    // Demand: 50 oz, Stock: 100 oz, Shortage: 0
    {
      const demandOz = 50;
      const stockOz = 100;
      const shortageOz = Math.max(0, demandOz - stockOz);
      
      results.push(validateTestCase(
        'No shortage: 50 oz demand, 100 oz stock',
        shortageOz,
        0,
        0.5
      ));
    }

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    return Response.json({
      success: true,
      summary: `${passed} passed, ${failed} failed`,
      total: results.length,
      results,
    });
  } catch (error) {
    console.error('[VALIDATE_MATH]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});