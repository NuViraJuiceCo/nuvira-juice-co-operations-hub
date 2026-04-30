import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * createLoyaltySignupBonus — Admin tool to manually apply/repair a signup bonus.
 * Writes directly to LoyaltyMember (source of truth).
 * Guards against double-application by checking points_history.
 */

const SIGNUP_BONUS = 100;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const payload = await req.json();
    const { customer_email, force = false } = payload;

    if (!customer_email) {
      return Response.json({ error: 'customer_email required' }, { status: 400 });
    }

    // Find the LoyaltyMember
    const members = await base44.asServiceRole.entities.LoyaltyMember.filter({ email: customer_email });
    if (!members || members.length === 0) {
      return Response.json({ error: 'Loyalty member not found' }, { status: 404 });
    }

    const member = members[0];
    const history = member.points_history || [];

    // Guard: do not apply signup bonus more than once unless forced
    const alreadyApplied = history.some(h =>
      h.type === 'bonus' && h.description && h.description.toLowerCase().includes('signup')
    );

    if (alreadyApplied && !force) {
      return Response.json({
        status: 'skipped',
        reason: 'Signup bonus already applied. Use force=true to override.',
        current_points: member.total_points,
      });
    }

    const now = new Date().toISOString();
    const signupEntry = {
      amount: SIGNUP_BONUS,
      type: 'bonus',
      description: 'Welcome bonus — Loyalty signup (admin repair)',
      timestamp: now,
    };

    const prevPoints = member.total_points || 0;
    const newTotal = prevPoints + SIGNUP_BONUS;
    const newLifetime = (member.lifetime_points || 0) + SIGNUP_BONUS;
    const newHistory = [...history, signupEntry];

    await base44.asServiceRole.entities.LoyaltyMember.update(member.id, {
      total_points: newTotal,
      lifetime_points: newLifetime,
      points_history: newHistory,
    });

    // Log to UserPoints for audit trail
    await base44.asServiceRole.entities.UserPoints.create({
      customer_email,
      amount: SIGNUP_BONUS,
      type: 'bonus',
      description: 'Welcome bonus — Loyalty signup (admin repair)',
      sync_status: 'pending',
    });

    console.log(`[SIGNUP-BONUS] Applied ${SIGNUP_BONUS} pts to ${customer_email} (${prevPoints} → ${newTotal})`);
    return Response.json({
      status: 'success',
      customer_email,
      previous_points: prevPoints,
      points_added: SIGNUP_BONUS,
      new_total: newTotal,
    });
  } catch (error) {
    console.error('[SIGNUP-BONUS] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});