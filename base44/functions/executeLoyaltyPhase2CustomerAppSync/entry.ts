import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const CUSTOMER_APP_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

const PHASE_1_TARGET_EMAILS = [
  'gthand@yahoo.com',
  'mm6r278756@privaterelay.appleid.com',
  'danyellenisbet@yahoo.com',
  'gk5c2nxn8m@privaterelay.appleid.com',
  'jk000.gill@gmail.com',
  'gshinger425@gmail.com',
  'amar.kahlon23@yahoo.com',
  'henrryalbert23@yahoo.com'
];

const HOLD_EMAILS = [
  'ksukhi2000@yahoo.com',
  'jskahlon1984@live.com'
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const params = await req.json().catch(() => ({}));
    const dry_run = params.dry_run !== false;
    const approved_by = params.approved_by || 'N/A';

    const hub = base44.asServiceRole;
    const out = {
      dry_run,
      mode: dry_run ? 'DRY RUN — zero Customer App writes' : 'LIVE — Customer App syncing',
      approved_by,
      executed_at: new Date().toISOString(),
      phase: 'Phase 2 — Customer App Loyalty Sync',
      source_of_truth: 'Hub LoyaltyMember + Hub UserPoints',
      target: 'Customer App Loyalty Display',
      
      step1_hub_data: {
        loyalty_members_read: [],
        userpoints_by_email: {},
        errors: []
      },
      
      step2_customer_app_state: {
        existing_loyalty_profiles: [],
        existing_userpoints: [],
        errors: []
      },
      
      step3_sync_plan: {
        matches: [],
        creates: [],
        updates: [],
        skips: [],
        apple_private_relay_customers: []
      },
      
      step4_held_items: {
        sukhwant_untouched: false,
        jesse_untouched: false,
        phantom_untouched: false
      },
      
      safety: {
        customer_app_writes: !dry_run,
        hub_writes: false,
        stripe_touched: false,
        orders_touched: false,
        production_touched: false,
        delivery_touched: false,
        events_touched: false
      },
      
      step5_execution: {
        created: [],
        updated: [],
        errors: []
      },
      
      summary: {},
      live_run_blockers: []
    };

    // ===== STEP 1: Read Hub LoyaltyMember + UserPoints =====
    try {
      const allMembers = await hub.entities.LoyaltyMember.list('-created_date', 100);
      
      for (const member of allMembers) {
        if (PHASE_1_TARGET_EMAILS.includes(member.email) || HOLD_EMAILS.includes(member.email)) {
          out.step1_hub_data.loyalty_members_read.push({
            id: member.id,
            email: member.email,
            full_name: member.full_name,
            total_points: member.total_points,
            lifetime_points: member.lifetime_points,
            status: member.status
          });
        }
      }

      // Read UserPoints for these members
      const allPoints = await hub.entities.UserPoints.list('-created_date', 500);
      for (const member of out.step1_hub_data.loyalty_members_read) {
        const memberPoints = allPoints.filter(p => p.customer_email === member.email);
        if (memberPoints.length > 0) {
          out.step1_hub_data.userpoints_by_email[member.email] = memberPoints.map(p => ({
            id: p.id,
            amount: p.amount,
            type: p.type,
            order_id: p.order_id,
            description: p.description,
            created_date: p.created_date
          }));
        }
      }
    } catch (e) {
      out.step1_hub_data.errors.push({
        step: 'read_hub_data',
        error: e?.message || String(e)
      });
      out.live_run_blockers.push({
        reason: 'Could not read Hub loyalty data',
        impact: 'sync_blocked'
      });
    }

    // ===== STEP 2: Fetch Customer App State =====
    if (CUSTOMER_APP_API && CUSTOMER_APP_SECRET) {
      try {
        const response = await fetch(`${CUSTOMER_APP_API}/api/loyalty/members`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${CUSTOMER_APP_SECRET}`,
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          out.step2_customer_app_state.existing_loyalty_profiles = data.members || [];
        } else {
          out.step2_customer_app_state.errors.push({
            endpoint: '/api/loyalty/members',
            status: response.status,
            error: `HTTP ${response.status}`
          });
        }

        // Try to fetch existing UserPoints
        const pointsResponse = await fetch(`${CUSTOMER_APP_API}/api/loyalty/userpoints`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${CUSTOMER_APP_SECRET}`,
            'Content-Type': 'application/json'
          }
        });

        if (pointsResponse.ok) {
          const data = await pointsResponse.json();
          out.step2_customer_app_state.existing_userpoints = data.userpoints || [];
        }
      } catch (e) {
        out.step2_customer_app_state.errors.push({
          step: 'fetch_customer_app_state',
          error: e?.message || String(e)
        });
        out.live_run_blockers.push({
          reason: 'Could not fetch Customer App state',
          impact: 'sync_blocked'
        });
      }
    } else {
      out.step2_customer_app_state.errors.push({
        reason: 'CUSTOMER_APP_API_URL or CUSTOMER_APP_SYNC_SECRET not configured'
      });
    }

    // ===== STEP 3: Build Sync Plan =====
    for (const hubMember of out.step1_hub_data.loyalty_members_read) {
      const isHeld = HOLD_EMAILS.includes(hubMember.email);
      const appMatch = out.step2_customer_app_state.existing_loyalty_profiles.find(
        m => m.email === hubMember.email
      );

      // Flag Apple Private Relay
      const isAppleRelay = hubMember.email.includes('@privaterelay.appleid.com');

      if (isHeld) {
        out.step3_sync_plan.skips.push({
          email: hubMember.email,
          reason: 'HELD_FROM_SYNC',
          hub_total: hubMember.total_points
        });

        if (hubMember.email.includes('sukh')) {
          out.step4_held_items.sukhwant_untouched = true;
        } else if (hubMember.email.includes('jskahlon')) {
          out.step4_held_items.jesse_untouched = true;
        }
      } else if (appMatch) {
        out.step3_sync_plan.matches.push({
          email: hubMember.email,
          hub_total: hubMember.total_points,
          app_total: appMatch.total_points,
          hub_id: hubMember.id,
          app_id: appMatch.id,
          apple_relay: isAppleRelay
        });

        if (appMatch.total_points !== hubMember.total_points) {
          out.step3_sync_plan.updates.push({
            email: hubMember.email,
            app_id: appMatch.id,
            current_total: appMatch.total_points,
            new_total: hubMember.total_points,
            current_lifetime: appMatch.lifetime_points,
            new_lifetime: hubMember.lifetime_points,
            reason: 'Balance mismatch — update from Hub',
            apple_relay: isAppleRelay,
            proposed_action: 'UPDATE'
          });
        }
      } else {
        out.step3_sync_plan.creates.push({
          email: hubMember.email,
          full_name: hubMember.full_name,
          total_points: hubMember.total_points,
          lifetime_points: hubMember.lifetime_points,
          status: hubMember.status,
          hub_id: hubMember.id,
          apple_relay: isAppleRelay,
          proposed_action: 'CREATE'
        });
      }

      if (isAppleRelay) {
        out.step3_sync_plan.apple_private_relay_customers.push({
          email: hubMember.email,
          full_name: hubMember.full_name,
          hub_total: hubMember.total_points
        });
      }
    }

    // ===== STEP 4: Verify Hold Items =====
    out.step4_held_items.sukhwant_untouched = out.step3_sync_plan.skips.some(s => s.email.includes('sukh'));
    out.step4_held_items.jesse_untouched = out.step3_sync_plan.skips.some(s => s.email.includes('jskahlon'));
    out.step4_held_items.phantom_untouched = true; // NV-MOB2D3P0 is not a loyalty member, so it's automatically untouched

    // ===== STEP 5: Execute (if live) =====
    if (!dry_run && CUSTOMER_APP_API && CUSTOMER_APP_SECRET) {
      // Create records
      for (const create of out.step3_sync_plan.creates) {
        try {
          const response = await fetch(`${CUSTOMER_APP_API}/api/loyalty/members`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${CUSTOMER_APP_SECRET}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              email: create.email,
              full_name: create.full_name,
              total_points: create.total_points,
              lifetime_points: create.lifetime_points,
              status: create.status,
              hub_id: create.hub_id,
              idempotency_key: `phase2-create-${create.email}`,
              source: 'Hub Phase 2 Sync'
            })
          });

          if (response.ok) {
            const data = await response.json();
            out.step5_execution.created.push({
              email: create.email,
              app_id: data.id,
              status: 'created'
            });
          } else {
            out.step5_execution.errors.push({
              action: 'create',
              email: create.email,
              status: response.status,
              error: `HTTP ${response.status}`
            });
          }
        } catch (e) {
          out.step5_execution.errors.push({
            action: 'create',
            email: create.email,
            error: e?.message || String(e)
          });
        }
      }

      // Update records
      for (const update of out.step3_sync_plan.updates) {
        try {
          const response = await fetch(`${CUSTOMER_APP_API}/api/loyalty/members/${update.app_id}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${CUSTOMER_APP_SECRET}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              total_points: update.new_total,
              lifetime_points: update.new_lifetime,
              idempotency_key: `phase2-update-${update.email}`,
              source: 'Hub Phase 2 Sync'
            })
          });

          if (response.ok) {
            out.step5_execution.updated.push({
              email: update.email,
              app_id: update.app_id,
              status: 'updated'
            });
          } else {
            out.step5_execution.errors.push({
              action: 'update',
              email: update.email,
              status: response.status,
              error: `HTTP ${response.status}`
            });
          }
        } catch (e) {
          out.step5_execution.errors.push({
            action: 'update',
            email: update.email,
            error: e?.message || String(e)
          });
        }
      }
    }

    // ===== Summary =====
    out.summary = {
      mode: out.mode,
      hub_members_read: out.step1_hub_data.loyalty_members_read.length,
      app_state_fetched: out.step2_customer_app_state.existing_loyalty_profiles.length,
      proposed_creates: out.step3_sync_plan.creates.length,
      proposed_updates: out.step3_sync_plan.updates.length,
      proposed_skips: out.step3_sync_plan.skips.length,
      apple_private_relay_customers: out.step3_sync_plan.apple_private_relay_customers.length,
      held_items: {
        sukhwant: out.step4_held_items.sukhwant_untouched,
        jesse: out.step4_held_items.jesse_untouched,
        phantom: out.step4_held_items.phantom_untouched
      },
      created: out.step5_execution.created.length,
      updated: out.step5_execution.updated.length,
      errors: out.step1_hub_data.errors.length + out.step2_customer_app_state.errors.length + out.step5_execution.errors.length,
      live_run_blockers: out.live_run_blockers.length,
      overall_status: out.live_run_blockers.length > 0 ? 'BLOCKERS_PRESENT' : (dry_run ? 'DRY_RUN_READY' : 'SYNC_COMPLETE'),
      action_required: dry_run ? 'Review dry run and approve Phase 2 live run' : 'Monitor Customer App sync completion'
    };

    return Response.json(out, { status: 200 });

  } catch (error) {
    return Response.json({
      status: 'error',
      error: error?.message || String(error)
    }, { status: 500 });
  }
});