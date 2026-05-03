import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CREATED_USERPOINTS_IDS = [
  '69f7ac6f3bb18de6ba24eee4',
  '69f7ac6f6d84d46fef3e9ad2',
  '69f7ac6f9a62f3df0b4c6c62',
  '69f7ac6fa4a85ee38f66f88b',
  '69f7ac704a2b35b26d72a627',
  '69f7ac70619f8cfc31a7d3d8'
];

const APPROVED_PLAN = {
  backfill: [
    { order_number: 'NV-MON367R7', email: 'gk5c2nxn8m@privaterelay.appleid.com', amount: 419 },
    { order_number: 'NV-MODIHVQQ', email: 'mm6r278756@privaterelay.appleid.com', amount: 419 },
    { order_number: 'NV-MOILSACV', email: 'danyellenisbet@yahoo.com', amount: 399 },
    { order_number: 'NV-MOILVI17', email: 'danyellenisbet@yahoo.com', amount: 399 }
  ],
  reversals: [
    { email: 'jk000.gill@gmail.com', amount: -419 },
    { email: 'amar.kahlon23@yahoo.com', amount: -439 }
  ],
  balances: [
    { email: 'gthand@yahoo.com', total: 929, lifetime: 1029 },
    { email: 'mm6r278756@privaterelay.appleid.com', total: 519, lifetime: 419 },
    { email: 'danyellenisbet@yahoo.com', total: 898, lifetime: 798 },
    { email: 'gk5c2nxn8m@privaterelay.appleid.com', total: 419, lifetime: 419 },
    { email: 'jk000.gill@gmail.com', total: 419, lifetime: 419 },
    { email: 'gshinger425@gmail.com', total: 499, lifetime: 499 },
    { email: 'amar.kahlon23@yahoo.com', total: 100, lifetime: 0 }
  ]
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const hub = base44.asServiceRole;
    const out = {
      mode: 'READ-ONLY AUDIT',
      executed_at: new Date().toISOString(),
      audit_records: {
        userpoints_created: [],
        userpoints_issues: []
      },
      current_state: {
        loyalty_member_balances: [],
        ledger_totals_by_email: {}
      },
      comparisons: {
        backfill_matches: [],
        backfill_mismatches: [],
        reversal_matches: [],
        reversal_mismatches: []
      },
      integrity_check: {
        balance_vs_ledger_mismatches: []
      },
      repair_plan: [],
      summary: {}
    };

    // Read created UserPoints records
    for (const id of CREATED_USERPOINTS_IDS) {
      try {
        const record = await hub.entities.UserPoints.get(id);
        if (record) {
          out.audit_records.userpoints_created.push({
            id: record.id,
            customer_email: record.customer_email,
            amount: record.amount,
            type: record.type,
            order_id: record.order_id,
            description: record.description,
            sync_status: record.sync_status,
            created_date: record.created_date
          });
        }
      } catch (e) {
        out.audit_records.userpoints_issues.push({
          id,
          error: `Could not read: ${e?.message || String(e)}`
        });
      }
    }

    // Compare backfill records
    for (const planned of APPROVED_PLAN.backfill) {
      const created = out.audit_records.userpoints_created.find(
        r => r.customer_email === planned.email && r.order_id && r.type === 'earned'
      );

      if (created) {
        if (created.amount === planned.amount) {
          out.comparisons.backfill_matches.push({
            order: planned.order_number,
            email: planned.email,
            planned_amount: planned.amount,
            created_id: created.id,
            status: 'CORRECT'
          });
        } else {
          out.comparisons.backfill_mismatches.push({
            order: planned.order_number,
            email: planned.email,
            planned_amount: planned.amount,
            created_amount: created.amount,
            created_id: created.id,
            status: 'AMOUNT_MISMATCH'
          });
        }
      } else {
        out.comparisons.backfill_mismatches.push({
          order: planned.order_number,
          email: planned.email,
          planned_amount: planned.amount,
          status: 'NOT_FOUND'
        });
      }
    }

    // Compare reversal records
    for (const planned of APPROVED_PLAN.reversals) {
      const created = out.audit_records.userpoints_created.find(
        r => r.customer_email === planned.email && r.type === 'reversal'
      );

      if (created) {
        if (created.amount === planned.amount) {
          out.comparisons.reversal_matches.push({
            email: planned.email,
            planned_amount: planned.amount,
            created_id: created.id,
            status: 'CORRECT'
          });
        } else {
          out.comparisons.reversal_mismatches.push({
            email: planned.email,
            planned_amount: planned.amount,
            created_amount: created.amount,
            created_id: created.id,
            status: 'AMOUNT_MISMATCH',
            issue: created.amount > 0 ? 'POSITIVE_INSTEAD_OF_NEGATIVE' : 'UNEXPECTED_SIGN'
          });
        }
      } else {
        out.comparisons.reversal_mismatches.push({
          email: planned.email,
          planned_amount: planned.amount,
          status: 'NOT_FOUND'
        });
      }
    }

    // Read current LoyaltyMember balances
    const emails = [...new Set([...APPROVED_PLAN.backfill.map(b => b.email), ...APPROVED_PLAN.reversals.map(r => r.email)])];
    for (const email of emails) {
      try {
        const members = await hub.entities.LoyaltyMember.filter({ email });
        if (members && members.length > 0) {
          const m = members[0];
          out.current_state.loyalty_member_balances.push({
            email: m.email,
            id: m.id,
            total_points: m.total_points,
            lifetime_points: m.lifetime_points
          });
        }
      } catch (e) {
        out.current_state.loyalty_member_balances.push({
          email,
          error: `Could not read: ${e?.message || String(e)}`
        });
      }
    }

    // Calculate ledger totals by email from created UserPoints
    const ledger = {};
    for (const up of out.audit_records.userpoints_created) {
      if (!ledger[up.customer_email]) {
        ledger[up.customer_email] = { total: 0, transactions: [] };
      }
      ledger[up.customer_email].total += (up.amount || 0);
      ledger[up.customer_email].transactions.push({
        id: up.id,
        type: up.type,
        amount: up.amount
      });
    }

    out.current_state.ledger_totals_by_email = ledger;

    // Compare ledger totals against LoyaltyMember.total_points
    for (const member of out.current_state.loyalty_member_balances) {
      if (!member.error) {
        const ledgerTotal = ledger[member.email]?.total || 0;
        const memberTotal = member.total_points || 0;

        if (ledgerTotal !== memberTotal) {
          out.integrity_check.balance_vs_ledger_mismatches.push({
            email: member.email,
            member_total_points: memberTotal,
            ledger_total: ledgerTotal,
            gap: memberTotal - ledgerTotal,
            status: 'MISMATCH'
          });
        }
      }
    }

    // Build repair plan
    const hasBackfillMismatches = out.comparisons.backfill_mismatches.length > 0;
    const hasReversalMismatches = out.comparisons.reversal_mismatches.length > 0;
    const hasBalanceMismatches = out.integrity_check.balance_vs_ledger_mismatches.length > 0;

    if (hasBackfillMismatches || hasReversalMismatches || hasBalanceMismatches) {
      out.repair_plan.push({
        step: 1,
        action: 'Review created UserPoints records',
        details: out.comparisons.backfill_mismatches.concat(out.comparisons.reversal_mismatches)
      });

      out.repair_plan.push({
        step: 2,
        action: 'For each incorrect record, create a compensating UserPoints transaction',
        example: 'If 69f7ac6f6d84d46fef3e9ad2 has wrong amount/email/type, create a reversal to offset it'
      });

      out.repair_plan.push({
        step: 3,
        action: 'Recalculate LoyaltyMember balances based on corrected ledger',
        details: 'Sum all UserPoints (earned + redeemed + reversal + correction) by customer_email'
      });

      out.repair_plan.push({
        step: 4,
        action: 'Update LoyaltyMember.total_points and lifetime_points to match ledger',
        scope: 'Only update after ledger is verified correct'
      });
    }

    out.summary = {
      total_created_records: out.audit_records.userpoints_created.length,
      backfill_correct: out.comparisons.backfill_matches.length,
      backfill_incorrect: out.comparisons.backfill_mismatches.length,
      reversal_correct: out.comparisons.reversal_matches.length,
      reversal_incorrect: out.comparisons.reversal_mismatches.length,
      balance_vs_ledger_gaps: out.integrity_check.balance_vs_ledger_mismatches.length,
      overall_status: (hasBackfillMismatches || hasReversalMismatches || hasBalanceMismatches) 
        ? 'AUDIT_ISSUES_FOUND' 
        : 'ALL_RECORDS_CORRECT',
      action_required: (hasBackfillMismatches || hasReversalMismatches || hasBalanceMismatches)
        ? 'Repair plan needed before Phase 2'
        : 'Safe to proceed to Phase 2'
    };

    return Response.json(out, { status: 200 });

  } catch (error) {
    return Response.json({
      status: 'error',
      error: error?.message || String(error)
    }, { status: 500 });
  }
});