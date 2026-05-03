import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const EXPECTED_EARNED = [
  { order_num: 'NV-MON367R7', email: 'gk5c2nxn8m@privaterelay.appleid.com', amt: 419 },
  { order_num: 'NV-MOOPFCUS', email: 'jk000.gill@gmail.com', amt: 419 },
  { order_num: 'NV-MOOV82PT', email: 'gshinger425@gmail.com', amt: 499 },
  { order_num: 'NV-MOPV2CIK', email: 'henrryalbert23@yahoo.com', amt: 519 }
];

const EXPECTED_REVERSALS = [
  { order_num: 'NV-MONL4I2M', email: 'amar.kahlon23@yahoo.com', amt: -439 },
  { order_num: 'NV-MOBUSDSC', email: 'kirandeepkd@hotmail.com', amt: -390 }
];

const AFFECTED_EMAILS = [
  'gk5c2nxn8m@privaterelay.appleid.com',
  'jk000.gill@gmail.com',
  'gshinger425@gmail.com',
  'henrryalbert23@yahoo.com',
  'amar.kahlon23@yahoo.com',
  'kirandeepkd@hotmail.com',
  'danyellenisbet@yahoo.com',
  'mm6r278756@privaterelay.appleid.com',
  'gthand@yahoo.com'
];

const EXPECTED_ORDER_IDS = [
  '69f4cb5cc55b645ed2d3cbf7',
  '69f665d1852c5530d521f029',
  '69f6e73fca8f68f126d2c232',
  '69f77aa2d81dbc896f90ec41',
  '69f5439553a775a4ef2fa3ac',
  '69ea7d9c8a47acacd00cdb96'
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const hub = base44.asServiceRole;
    const out = {
      mode: 'READ-ONLY LEDGER TRUTH AUDIT',
      executed_at: new Date().toISOString(),
      cutoff_time: '2026-05-03T19:50:00Z',
      userpoints_discovered: [],
      repair_audit_logs: [],
      ledger_by_email: {},
      loyalty_member_balances: {},
      comparisons: {
        earned_expected_found: [],
        earned_expected_missing: [],
        reversal_expected_found: [],
        reversal_expected_missing: [],
        unexpected_records: []
      },
      integrity_issues: [],
      repair_plan: []
    };

    // 1. Read all UserPoints created after cutoff
    try {
      const allPoints = await hub.entities.UserPoints.list('-created_date', 500);
      
      for (const up of allPoints) {
        const createdTime = new Date(up.created_date).getTime();
        const cutoffTime = new Date('2026-05-03T19:50:00Z').getTime();
        
        if (createdTime >= cutoffTime) {
          out.userpoints_discovered.push({
            id: up.id,
            customer_email: up.customer_email,
            amount: up.amount,
            type: up.type,
            order_id: up.order_id,
            description: up.description,
            sync_status: up.sync_status,
            created_date: up.created_date
          });
        }
      }
    } catch (e) {
      out.userpoints_discovered = {
        error: `Could not list UserPoints: ${e?.message || String(e)}`
      };
    }

    // 2. Read all RepairAuditLog records from Phase 1 live run
    try {
      const allLogs = await hub.entities.RepairAuditLog.list('-created_date', 100);
      
      for (const log of allLogs) {
        const createdTime = new Date(log.timestamp || log.created_date).getTime();
        const cutoffTime = new Date('2026-05-03T19:50:00Z').getTime();
        
        if (createdTime >= cutoffTime && log.repair_function === 'executeLoyaltyPhase1HubSide') {
          out.repair_audit_logs.push({
            id: log.id,
            action: log.action,
            records_affected: log.records_affected,
            timestamp: log.timestamp,
            reason: log.reason,
            changes: log.changes
          });
        }
      }
    } catch (e) {
      out.repair_audit_logs = {
        error: `Could not list RepairAuditLog: ${e?.message || String(e)}`
      };
    }

    // 3. Build ledger from discovered UserPoints
    for (const up of (Array.isArray(out.userpoints_discovered) ? out.userpoints_discovered : [])) {
      if (!out.ledger_by_email[up.customer_email]) {
        out.ledger_by_email[up.customer_email] = {
          total: 0,
          transactions: []
        };
      }
      out.ledger_by_email[up.customer_email].total += (up.amount || 0);
      out.ledger_by_email[up.customer_email].transactions.push({
        id: up.id,
        type: up.type,
        amount: up.amount,
        order_id: up.order_id,
        description: up.description
      });
    }

    // 4. Read current LoyaltyMember balances for affected emails
    for (const email of AFFECTED_EMAILS) {
      try {
        const members = await hub.entities.LoyaltyMember.filter({ email });
        if (members && members.length > 0) {
          const m = members[0];
          out.loyalty_member_balances[email] = {
            id: m.id,
            total_points: m.total_points,
            lifetime_points: m.lifetime_points
          };
        }
      } catch (e) {
        out.loyalty_member_balances[email] = {
          error: `Could not read: ${e?.message || String(e)}`
        };
      }
    }

    // 5. Compare expected earned records against discovered
    for (const expected of EXPECTED_EARNED) {
      const found = (Array.isArray(out.userpoints_discovered) ? out.userpoints_discovered : []).find(
        up => up.customer_email === expected.email && up.type === 'earned' && up.amount === expected.amt
      );

      if (found) {
        out.comparisons.earned_expected_found.push({
          order: expected.order_num,
          email: expected.email,
          amount: expected.amt,
          found_id: found.id,
          status: 'FOUND'
        });
      } else {
        out.comparisons.earned_expected_missing.push({
          order: expected.order_num,
          email: expected.email,
          amount: expected.amt,
          status: 'MISSING'
        });
      }
    }

    // 6. Compare expected reversals against discovered
    for (const expected of EXPECTED_REVERSALS) {
      const found = (Array.isArray(out.userpoints_discovered) ? out.userpoints_discovered : []).find(
        up => up.customer_email === expected.email && up.type === 'reversal' && up.amount === expected.amt
      );

      if (found) {
        out.comparisons.reversal_expected_found.push({
          order: expected.order_num,
          email: expected.email,
          amount: expected.amt,
          found_id: found.id,
          status: 'FOUND'
        });
      } else {
        out.comparisons.reversal_expected_missing.push({
          order: expected.order_num,
          email: expected.email,
          amount: expected.amt,
          status: 'MISSING'
        });
      }
    }

    // 7. Flag unexpected records (discovered but not in expected plan)
    if (Array.isArray(out.userpoints_discovered)) {
      for (const up of out.userpoints_discovered) {
        const isExpectedEarned = EXPECTED_EARNED.find(e => e.email === up.customer_email && e.amt === up.amount && up.type === 'earned');
        const isExpectedReversal = EXPECTED_REVERSALS.find(r => r.email === up.customer_email && r.amt === up.amount && up.type === 'reversal');

        if (!isExpectedEarned && !isExpectedReversal) {
          out.comparisons.unexpected_records.push({
            id: up.id,
            email: up.customer_email,
            type: up.type,
            amount: up.amount,
            order_id: up.order_id,
            description: up.description,
            status: 'UNEXPECTED'
          });
        }
      }
    }

    // 8. Identify integrity issues
    for (const email of AFFECTED_EMAILS) {
      const ledgerTotal = out.ledger_by_email[email]?.total || 0;
      const memberBalance = out.loyalty_member_balances[email]?.total_points;

      if (memberBalance !== undefined) {
        if (ledgerTotal === memberBalance) {
          // OK
        } else {
          out.integrity_issues.push({
            email,
            ledger_total: ledgerTotal,
            member_total_points: memberBalance,
            gap: memberBalance - ledgerTotal,
            status: 'MISMATCH',
            ledger_transactions: out.ledger_by_email[email]?.transactions?.length || 0
          });
        }
      } else if (memberBalance === undefined && ledgerTotal > 0) {
        out.integrity_issues.push({
          email,
          ledger_total: ledgerTotal,
          member_total_points: 'NO_RECORD',
          gap: null,
          status: 'LEDGER_WITHOUT_MEMBER',
          ledger_transactions: out.ledger_by_email[email]?.transactions?.length || 0
        });
      }
    }

    // 9. Build repair plan
    const missingEarned = out.comparisons.earned_expected_missing.length;
    const missingReversals = out.comparisons.reversal_expected_missing.length;
    const hasMismatches = out.integrity_issues.length > 0;

    if (missingEarned > 0 || missingReversals > 0 || hasMismatches) {
      out.repair_plan.push({
        step: 1,
        action: 'Create missing earned UserPoints',
        count: missingEarned,
        details: out.comparisons.earned_expected_missing
      });

      out.repair_plan.push({
        step: 2,
        action: 'Create missing reversal UserPoints',
        count: missingReversals,
        details: out.comparisons.reversal_expected_missing
      });

      out.repair_plan.push({
        step: 3,
        action: 'Verify ledger totals match LoyaltyMember balances',
        issues: out.integrity_issues
      });

      out.repair_plan.push({
        step: 4,
        action: 'If still mismatched, create compensating UserPoints to correct ledger'
      });
    } else {
      out.repair_plan.push({
        step: 1,
        action: 'NO REPAIRS NEEDED',
        message: 'All expected records found. Ledger matches member balances.'
      });
    }

    out.summary = {
      userpoints_discovered_count: Array.isArray(out.userpoints_discovered) ? out.userpoints_discovered.length : 0,
      repair_audit_logs_count: Array.isArray(out.repair_audit_logs) ? out.repair_audit_logs.length : 0,
      earned_expected_found: out.comparisons.earned_expected_found.length,
      earned_expected_missing: out.comparisons.earned_expected_missing.length,
      reversal_expected_found: out.comparisons.reversal_expected_found.length,
      reversal_expected_missing: out.comparisons.reversal_expected_missing.length,
      unexpected_records: out.comparisons.unexpected_records.length,
      integrity_issues: out.integrity_issues.length,
      overall_status: (missingEarned + missingReversals + out.integrity_issues.length > 0) ? 'REPAIRS_NEEDED' : 'LEDGER_CLEAN',
      action_required: out.repair_plan.map(p => p.action).join(' → ')
    };

    return Response.json(out, { status: 200 });

  } catch (error) {
    return Response.json({
      status: 'error',
      error: error?.message || String(error)
    }, { status: 500 });
  }
});