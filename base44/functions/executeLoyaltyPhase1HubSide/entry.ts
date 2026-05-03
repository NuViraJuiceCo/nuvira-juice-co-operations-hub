import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ELIGIBLE_ORDERS_TO_BACKFILL = [
  {
    order_number: 'NV-MON367R7',
    hub_order_id: '69f4cb5cc55b645ed2d3cbf7',
    customer_email: 'gk5c2nxn8m@privaterelay.appleid.com',
    customer_name: 'Deepa Jaswal',
    total_price: 41.99,
    points: 419,
    stripe_pi: 'pi_3TSJHyIrzYHaHkt23wIjLu6m'
  },
  {
    order_number: 'NV-MOOPFCUS',
    hub_order_id: '69f665d1852c5530d521f029',
    customer_email: 'jk000.gill@gmail.com',
    customer_name: 'Jasdeep Gill',
    total_price: 41.99,
    points: 419,
    stripe_pi: 'pi_3TSik4IrzYHaHkt20PVT8VSV'
  },
  {
    order_number: 'NV-MOOV82PT',
    hub_order_id: '69f6e73fca8f68f126d2c232',
    customer_email: 'gshinger425@gmail.com',
    customer_name: 'Gavandeep Shinger',
    total_price: 49.99,
    points: 499,
    stripe_pi: 'pi_3TSlHEIrzYHaHkt203EJMSDN'
  },
  {
    order_number: 'NV-MOPV2CIK',
    hub_order_id: '69f77aa2d81dbc896f90ec41',
    customer_email: 'henrryalbert23@yahoo.com',
    customer_name: 'Henrry Robles',
    total_price: 51.99,
    points: 519,
    stripe_pi: 'pi_3TT0w2IrzYHaHkt20qqFLCbQ'
  }
];

const REVERSALS_TO_CREATE = [
  {
    customer_email: 'amar.kahlon23@yahoo.com',
    original_order_id: '69f5439553a775a4ef2fa3ac',
    reversal_amount: -439,
    description: 'REVERSAL — Order NV-MONL4I2M was fully refunded (Stripe refund confirmed, do_not_recover=true). Original earn of 439 pts reversed per loyalty rules. Phase 1 repair 2026-05-03. Original UserPoints record preserved for audit.'
  },
  {
    customer_email: 'kirandeepkd@hotmail.com',
    original_order_id: '69ea7d9c8a47acacd00cdb96',
    reversal_amount: -390,
    description: 'REVERSAL — Order NV-MOBUSDSC was cancelled with payment_captured=false. Original earn of 390 pts reversed per loyalty rules. Phase 1 repair 2026-05-03. Original UserPoints record preserved for audit.'
  }
];

const BALANCE_RECALC_TARGETS = [
  {
    email: 'gthand@yahoo.com',
    memberId: '69ed723ddab0bde80582dd4b',
    new_total: 929,
    new_lifetime: 1029,
    calc: 'NV-MOF1S04J(+1029)+welcome(+100)+redemption(-200)=929'
  },
  {
    email: 'mm6r278756@privaterelay.appleid.com',
    memberId: '69ed137617571bf7e3f834cf',
    new_total: 519,
    new_lifetime: 419,
    calc: 'NV-MODIHVQQ(+419)+welcome(+100)=519'
  },
  {
    email: 'danyellenisbet@yahoo.com',
    memberId: '69f1743a758133207231de8a',
    new_total: 898,
    new_lifetime: 798,
    calc: 'NV-MOILSACV(+399)+NV-MOILVI17(+399)+welcome(+100)=898'
  },
  {
    email: 'gk5c2nxn8m@privaterelay.appleid.com',
    memberId: '69f6a938b7912825b536e0bb',
    new_total: 419,
    new_lifetime: 419,
    calc: 'NV-MON367R7_backfill(+419)=419'
  },
  {
    email: 'jk000.gill@gmail.com',
    memberId: '69f6a9383a2d9ab7a4e46421',
    new_total: 419,
    new_lifetime: 419,
    calc: 'NV-MOOPFCUS_backfill(+419)=419'
  },
  {
    email: 'gshinger425@gmail.com',
    memberId: '69f6a936a976dc40c745e0ee',
    new_total: 499,
    new_lifetime: 499,
    calc: 'NV-MOOV82PT_backfill(+499)=499'
  },
  {
    email: 'amar.kahlon23@yahoo.com',
    memberId: '69ed13752c810ba26ff5fa50',
    new_total: 100,
    new_lifetime: 0,
    calc: 'earn(+439)+reversal(-439)+welcome(+100)=100|lifetime=0'
  },
  {
    email: 'henrryalbert23@yahoo.com',
    memberId: null,
    new_total: 519,
    new_lifetime: 519,
    calc: 'NV-MOPV2CIK_backfill(+519)=519'
  }
];

const HOLD_ITEMS = [
  {
    ref: 'ksukhi2000@yahoo.com',
    reason: 'Sukhwant — 1440pts for SUB-1TPMGCIR. Business rule TBD. Not modified.'
  },
  {
    ref: 'jskahlon1984@live.com',
    reason: 'Jesse — balance gap under investigation. Not modified.'
  },
  {
    ref: 'NV-MOB2D3P0',
    reason: 'Phantom order_id=69ea5b7a9ad82d9b651baffa. No matching Hub ShopifyOrder. Not counted.'
  }
];

function isEligibleForLoyalty(order) {
  if (!order) {
    return { eligible: false, reason: 'order_not_found' };
  }

  if (order.do_not_recover === true) {
    return { eligible: false, reason: 'do_not_recover=true' };
  }

  if (order.do_not_sync === true) {
    return { eligible: false, reason: 'do_not_sync=true' };
  }

  const badStatuses = ['refunded', 'cancelled', 'canceled', 'deleted'];

  if (badStatuses.includes(order.payment_status)) {
    return { eligible: false, reason: `payment_status=${order.payment_status}` };
  }

  if (badStatuses.includes(order.financial_status)) {
    return { eligible: false, reason: `financial_status=${order.financial_status}` };
  }

  if (order.payment_status === 'paid') {
    return { eligible: true, reason: 'payment_status=paid' };
  }

  if (order.payment_captured === true) {
    return { eligible: true, reason: 'payment_captured=true' };
  }

  return {
    eligible: false,
    reason: `payment_status=${order.payment_status ?? 'null'}, payment_captured=${order.payment_captured ?? 'null'} — not confirmed paid`
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const dry_run = body.dry_run !== false;
    const approved_by = body.approved_by || 'unknown';

    if (!dry_run && approved_by === 'unknown') {
      return Response.json({
        error: 'Live execution requires approved_by in payload.',
        example: {
          dry_run: false,
          approved_by: 'admin'
        }
      }, { status: 400 });
    }

    const hub = base44.asServiceRole;
    const executedAt = new Date().toISOString();

    const out = {
      dry_run,
      mode: dry_run ? 'DRY RUN — zero writes' : 'LIVE — writes executing',
      approved_by: dry_run ? 'N/A' : approved_by,
      executed_at: executedAt,
      phase: 'Phase 1 — Hub Loyalty Ledger Stabilization',
      amount_rule: 'Math.floor(total_price × 10)',
      safety: {
        customer_app_touched: false,
        stripe_touched: false,
        orders_written: false,
        production_touched: false,
        delivery_touched: false,
        events_touched: false,
        records_deleted: false,
        sukhwant_touched: false,
        jesse_touched: false
      },
      hold_items: HOLD_ITEMS,
      step1_idempotency: {
        earn_order_ids_found: [],
        reversal_order_ids_found: [],
        total_read: 0
      },
      step2_backfill: {
        previewed: [],
        created: [],
        skipped: []
      },
      step3_reversals: {
        previewed: [],
        created: [],
        skipped: []
      },
      balance_update_allowed: dry_run ? 'N/A — dry run' : null,
      balance_update_block_reason: null,
      required_userpoints_created_or_confirmed: dry_run ? 'N/A — dry run' : null,
      required_reversals_created_or_confirmed: dry_run ? 'N/A — dry run' : null,
      aborted_before_balance_update: false,
      step4_balance_recalc: {
        previewed: [],
        updated: []
      },
      step5_henrry_member: {
        preview: null,
        action_taken: null
      },
      step6_audit_log: {
        entries_to_create: [],
        created: []
      },
      errors: [],
      live_run_blockers: []
    };

    try {
      const allPoints = await hub.entities.UserPoints.list();

      const earnIds = new Set();
      const reversalIds = new Set();

      for (const p of (allPoints || [])) {
        if (p.type === 'earned' && p.order_id) {
          earnIds.add(p.order_id);
        }

        if (p.type === 'reversal' && p.order_id) {
          reversalIds.add(p.order_id);
        }
      }

      out.step1_idempotency.earn_order_ids_found = [...earnIds];
      out.step1_idempotency.reversal_order_ids_found = [...reversalIds];
      out.step1_idempotency.total_read = allPoints?.length ?? 0;

      for (const order of ELIGIBLE_ORDERS_TO_BACKFILL) {
        const alreadyEarned = earnIds.has(order.hub_order_id);

        let liveOrder = null;
        let eligibility = { eligible: false, reason: 'not_checked' };

        try {
          liveOrder = await hub.entities.ShopifyOrder.get(order.hub_order_id);
          eligibility = isEligibleForLoyalty(liveOrder);
        } catch (e) {
          out.errors.push({
            step: 'live_order_read',
            order_number: order.order_number,
            error: e?.message || String(e)
          });
        }

        const amountValue = liveOrder?.total_price ?? order.total_price;
        const pointsCalc = Math.floor(amountValue * 10);

        const action = alreadyEarned
          ? 'SKIP_idempotent'
          : !eligibility.eligible
            ? 'SKIP_not_eligible'
            : 'CREATE';

        const recordToCreate = action !== 'CREATE'
          ? null
          : {
              customer_email: order.customer_email,
              amount: pointsCalc,
              type: 'earned',
              description: `Purchase points — Order ${order.order_number} ($${amountValue} × 10 pts/$) [Phase1-backfill-20260503]`,
              order_id: order.hub_order_id,
              sync_status: 'pending'
            };

        out.step2_backfill.previewed.push({
          order_number: order.order_number,
          customer_email: order.customer_email,
          hub_order_id: order.hub_order_id,
          amount_field_used: 'total_price',
          amount_value: amountValue,
          points_calculated: pointsCalc,
          formula: `Math.floor(${amountValue} × 10) = ${pointsCalc}`,
          hub_payment_status: liveOrder?.payment_status ?? 'not_read',
          hub_payment_captured: liveOrder?.payment_captured ?? null,
          hub_financial_status: liveOrder?.financial_status ?? null,
          hub_do_not_recover: liveOrder?.do_not_recover ?? null,
          hub_do_not_sync: liveOrder?.do_not_sync ?? null,
          hub_order_lock_status: liveOrder?.order_lock_status ?? null,
          stripe_pi: order.stripe_pi,
          eligibility_check: eligibility,
          existing_userpoints_earn: alreadyEarned ? 'EXISTS — will skip (idempotent)' : 'NONE',
          proposed_action: action,
          record_to_create: recordToCreate
        });

        if (action === 'SKIP_not_eligible') {
          out.live_run_blockers.push({
            order_number: order.order_number,
            reason: eligibility.reason,
            impact: 'balance_update_blocked'
          });
        }

        if (!dry_run) {
          if (action === 'CREATE') {
            try {
              const created = await hub.entities.UserPoints.create(recordToCreate);

              out.step2_backfill.created.push({
                order_number: order.order_number,
                email: order.customer_email,
                points: pointsCalc,
                id: created?.id,
                status: 'created'
              });
            } catch (e) {
              out.errors.push({
                step: 'backfill_create',
                order_number: order.order_number,
                error: e?.message || String(e)
              });

              out.live_run_blockers.push({
                order_number: order.order_number,
                reason: `UserPoints create FAILED: ${e?.message || String(e)}`,
                impact: 'balance_update_blocked'
              });
            }
          } else {
            out.step2_backfill.skipped.push({
              order_number: order.order_number,
              reason: action
            });
          }
        }
      }

      for (const rev of REVERSALS_TO_CREATE) {
        const alreadyReversed = reversalIds.has(rev.original_order_id);

        const action = alreadyReversed
          ? 'SKIP_idempotent'
          : 'CREATE';

        const recordToCreate = action !== 'CREATE'
          ? null
          : {
              customer_email: rev.customer_email,
              amount: rev.reversal_amount,
              type: 'reversal',
              description: rev.description,
              order_id: rev.original_order_id,
              sync_status: 'pending'
            };

        out.step3_reversals.previewed.push({
          customer_email: rev.customer_email,
          original_order_id: rev.original_order_id,
          reversal_amount: rev.reversal_amount,
          existing_reversal_found: alreadyReversed ? 'EXISTS — will skip (idempotent)' : 'NONE',
          proposed_action: action,
          record_to_create: recordToCreate
        });

        if (!dry_run) {
          if (action === 'CREATE') {
            try {
              const created = await hub.entities.UserPoints.create(recordToCreate);

              out.step3_reversals.created.push({
                email: rev.customer_email,
                amount: rev.reversal_amount,
                id: created?.id,
                status: 'created'
              });
            } catch (e) {
              out.errors.push({
                step: 'reversal_create',
                email: rev.customer_email,
                error: e?.message || String(e)
              });

              out.live_run_blockers.push({
                email: rev.customer_email,
                reason: `Reversal create FAILED: ${e?.message || String(e)}`,
                impact: 'balance_update_blocked'
              });
            }
          } else {
            out.step3_reversals.skipped.push({
              email: rev.customer_email,
              reason: 'reversal already exists (idempotent)'
            });
          }
        }
      }

    } catch (e) {
      out.errors.push({
        step: 'step1_userpoints_list',
        error: e?.message || String(e)
      });

      out.live_run_blockers.push({
        reason: 'UserPoints list failed — cannot verify idempotency',
        impact: 'balance_update_blocked'
      });
    }

    if (!dry_run) {
      const ordersNeedingCreate = out.step2_backfill.previewed.filter(p => p.proposed_action === 'CREATE');
      const earnsConfirmed = out.step2_backfill.created.length + out.step2_backfill.skipped.filter(s => s.reason === 'SKIP_idempotent').length;
      const earnsNeeded = ordersNeedingCreate.length;

      const reversalsNeedCreate = out.step3_reversals.previewed.filter(p => p.proposed_action === 'CREATE');
      const reversalsConfirmed = out.step3_reversals.created.length + out.step3_reversals.skipped.filter(s => s.reason === 'reversal already exists (idempotent)').length;
      const reversalsNeeded = reversalsNeedCreate.length;

      out.required_userpoints_created_or_confirmed = `${earnsConfirmed}/${earnsNeeded} earn transactions confirmed`;
      out.required_reversals_created_or_confirmed = `${reversalsConfirmed}/${reversalsNeeded} reversal transactions confirmed`;

      const balanceGatePassed =
        out.live_run_blockers.length === 0 &&
        earnsConfirmed >= earnsNeeded &&
        reversalsConfirmed >= reversalsNeeded;

      out.balance_update_allowed = balanceGatePassed;

      if (!balanceGatePassed) {
        const reasons = [];

        if (out.live_run_blockers.length > 0) {
          reasons.push(`${out.live_run_blockers.length} blocker(s) present`);
        }

        if (earnsConfirmed < earnsNeeded) {
          reasons.push(`earn transactions: ${earnsConfirmed}/${earnsNeeded} confirmed`);
        }

        if (reversalsConfirmed < reversalsNeeded) {
          reasons.push(`reversal transactions: ${reversalsConfirmed}/${reversalsNeeded} confirmed`);
        }

        out.balance_update_block_reason = reasons.join('; ');
        out.aborted_before_balance_update = true;

        out.summary = {
          mode: 'LIVE — ABORTED BEFORE BALANCE UPDATES',
          overall: 'NEEDS_REVIEW',
          balance_update_allowed: false,
          balance_update_block_reason: out.balance_update_block_reason,
          aborted_before_balance_update: true,
          required_userpoints_created_or_confirmed: out.required_userpoints_created_or_confirmed,
          required_reversals_created_or_confirmed: out.required_reversals_created_or_confirmed,
          backfill_orders_created: out.step2_backfill.created.length,
          reversal_transactions_created: out.step3_reversals.created.length,
          balances_updated: 0,
          audit_logs_created: 0,
          errors: out.errors.length,
          live_run_blockers: out.live_run_blockers.length,
          action_required: 'Review blockers and errors above. Fix root causes, then re-run.'
        };

        return Response.json(out, { status: 200 });
      }
    }

    for (const target of BALANCE_RECALC_TARGETS) {
      if (!target.memberId) {
        continue;
      }

      out.step4_balance_recalc.previewed.push({
        email: target.email,
        hub_member_id: target.memberId,
        new_total_points: target.new_total,
        new_lifetime_pts: target.new_lifetime,
        calculation: target.calc,
        proposed_action: 'UPDATE LoyaltyMember'
      });

      if (!dry_run) {
        try {
          await hub.entities.LoyaltyMember.update(target.memberId, {
            total_points: target.new_total,
            lifetime_points: target.new_lifetime
          });

          out.step4_balance_recalc.updated.push({
            email: target.email,
            new_total: target.new_total,
            new_lifetime: target.new_lifetime,
            status: 'updated'
          });
        } catch (e) {
          out.errors.push({
            step: 'balance_recalc',
            email: target.email,
            error: e?.message || String(e)
          });
        }
      }
    }

    const henrry = BALANCE_RECALC_TARGETS.find(t => t.email === 'henrryalbert23@yahoo.com');

    try {
      const existing = await hub.entities.LoyaltyMember.filter({
        email: 'henrryalbert23@yahoo.com'
      });

      const exists = existing && existing.length > 0;

      out.step5_henrry_member.preview = {
        email: 'henrryalbert23@yahoo.com',
        hub_current_state: exists
          ? {
              id: existing[0].id,
              total_points: existing[0].total_points,
              lifetime_points: existing[0].lifetime_points
            }
          : 'NOT_FOUND_IN_HUB',
        proposed_action: exists ? 'UPDATE total_points + lifetime_points' : 'CREATE new LoyaltyMember',
        new_total_points: henrry.new_total,
        new_lifetime_pts: henrry.new_lifetime,
        calculation: henrry.calc
      };

      if (!dry_run) {
        if (exists) {
          await hub.entities.LoyaltyMember.update(existing[0].id, {
            full_name: 'Henrry Robles',
            total_points: henrry.new_total,
            lifetime_points: henrry.new_lifetime
          });

          out.step5_henrry_member.action_taken = `updated id=${existing[0].id}`;
        } else {
          const created = await hub.entities.LoyaltyMember.create({
            email: 'henrryalbert23@yahoo.com',
            full_name: 'Henrry Robles',
            status: 'active',
            total_points: henrry.new_total,
            lifetime_points: henrry.new_lifetime,
            redeemed_points: 0,
            points_history: [],
            order_history: [],
            signup_date: '2026-05-03'
          });

          out.step5_henrry_member.action_taken = `created id=${created?.id}`;
        }
      }

    } catch (e) {
      out.errors.push({
        step: 'henrry_member',
        error: e?.message || String(e)
      });
    }

    const auditEntries = [
      {
        action: 'backfill_missing_userpoints',
        count: dry_run
          ? out.step2_backfill.previewed.filter(p => p.proposed_action === 'CREATE').length
          : out.step2_backfill.created.length,
        detail: (dry_run
          ? out.step2_backfill.previewed.filter(p => p.proposed_action === 'CREATE')
          : out.step2_backfill.created
        ).map(r => `${r.order_number}(${r.points_calculated ?? r.points}pts)`).join(', ')
      },
      {
        action: 'create_reversal_transactions',
        count: dry_run
          ? out.step3_reversals.previewed.filter(p => p.proposed_action === 'CREATE').length
          : out.step3_reversals.created.length,
        detail: (dry_run
          ? out.step3_reversals.previewed.filter(p => p.proposed_action === 'CREATE')
          : out.step3_reversals.created
        ).map(r => `${r.customer_email}(${r.reversal_amount ?? r.amount}pts)`).join(', ')
      },
      {
        action: 'recalculate_loyalty_member_balances',
        count: dry_run
          ? out.step4_balance_recalc.previewed.length + 1
          : out.step4_balance_recalc.updated.length + (out.step5_henrry_member.action_taken ? 1 : 0),
        detail: out.step4_balance_recalc.previewed.map(p => `${p.email}→${p.new_total_points}`).join(', ') + ', henrryalbert23→519'
      }
    ];

    out.step6_audit_log.entries_to_create = auditEntries;

    if (!dry_run) {
      for (const entry of auditEntries) {
        if (entry.count === 0) {
          continue;
        }

        try {
          const created = await hub.entities.RepairAuditLog.create({
            timestamp: executedAt,
            executed_by: `Systems Control — Phase 1 Loyalty Repair (approved_by: ${approved_by})`,
            user_role: 'system',
            repair_function: 'executeLoyaltyPhase1HubSide',
            action: entry.action,
            records_affected: entry.count,
            reason: 'Phase 1 loyalty ledger stabilization. Hub as source of truth. Admin approved 2026-05-03.',
            changes: {
              detail: entry.detail,
              amount_rule: 'Math.floor(total_price × 10)',
              idempotency_key: 'order_id + type',
              held: ['ksukhi2000', 'jskahlon1984', 'NV-MOB2D3P0'],
              customer_app_touched: false,
              orders_written: false,
              stripe_touched: false
            },
            details: `Phase 1 Hub-side loyalty repair. dry_run=false. ${entry.detail}`
          });

          out.step6_audit_log.created.push({
            action: entry.action,
            id: created?.id,
            status: 'created'
          });
        } catch (e) {
          out.errors.push({
            step: 'audit_log',
            action: entry.action,
            error: e?.message || String(e)
          });
        }
      }
    }

    const backfillQueued = out.step2_backfill.previewed.filter(p => p.proposed_action === 'CREATE');
    const reversalQueued = out.step3_reversals.previewed.filter(p => p.proposed_action === 'CREATE');

    out.summary = {
      mode: dry_run ? 'DRY RUN — zero writes performed' : 'LIVE — writes executed',
      overall: out.errors.length > 0 ? 'completed_with_errors' : 'all_writes_succeeded',
      balance_update_allowed: out.balance_update_allowed,
      balance_update_block_reason: out.balance_update_block_reason,
      required_userpoints_created_or_confirmed: out.required_userpoints_created_or_confirmed,
      required_reversals_created_or_confirmed: out.required_reversals_created_or_confirmed,
      aborted_before_balance_update: out.aborted_before_balance_update,
      backfill_orders_queued: backfillQueued.length,
      backfill_orders_created: out.step2_backfill.created.length,
      reversal_transactions_queued: reversalQueued.length,
      reversal_transactions_created: out.step3_reversals.created.length,
      balances_queued: out.step4_balance_recalc.previewed.length + 1,
      balances_updated: out.step4_balance_recalc.updated.length + (out.step5_henrry_member.action_taken ? 1 : 0),
      audit_logs_created: out.step6_audit_log.created.length,
      errors: out.errors.length,
      live_run_blockers: out.live_run_blockers.length,
      live_run_clear: out.live_run_blockers.length === 0 && out.errors.length === 0,
      hold_items_untouched: HOLD_ITEMS.length
    };

    return Response.json(out, { status: 200 });

  } catch (error) {
    return Response.json({
      status: 'error',
      error: error?.message || String(error)
    }, { status: 500 });
  }
});