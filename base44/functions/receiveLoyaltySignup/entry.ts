import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * receiveLoyaltySignup — called by Customer App when a new user joins loyalty.
 * SOURCE OF TRUTH: LoyaltyMember entity in Hub.
 * Creates the LoyaltyMember record and applies the 100-pt signup bonus directly.
 * Also logs a UserPoints transaction for audit trail.
 */

const SIGNUP_BONUS = 100;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Validate secret
    const secret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
    const authHeader = req.headers.get('authorization')?.replace('Bearer ', '');

    if (authHeader !== secret) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const { email, full_name, phone, signup_date } = payload;

    if (!email) {
      return Response.json({ error: 'Email is required' }, { status: 400 });
    }

    // Check if member already exists — prevent duplicate signup bonus
    const existing = await base44.asServiceRole.entities.LoyaltyMember.filter({ email });

    if (existing && existing.length > 0) {
      return Response.json({
        status: 'exists',
        message: 'Member already registered',
        member_id: existing[0].id,
        total_points: existing[0].total_points || 0
      });
    }

    const now = new Date().toISOString();
    const signupEntry = {
      amount: SIGNUP_BONUS,
      type: 'bonus',
      description: 'Welcome bonus — Loyalty signup',
      timestamp: now,
    };

    // Create LoyaltyMember with signup bonus applied — LoyaltyMember is the source of truth
    const member = await base44.asServiceRole.entities.LoyaltyMember.create({
      email,
      full_name: full_name || '',
      phone: phone || '',
      signup_date: signup_date || now.split('T')[0],
      status: 'active',
      total_points: SIGNUP_BONUS,
      lifetime_points: SIGNUP_BONUS,
      redeemed_points: 0,
      points_history: [signupEntry],
    });

    // Log to UserPoints for audit trail
    await base44.asServiceRole.entities.UserPoints.create({
      customer_email: email,
      amount: SIGNUP_BONUS,
      type: 'bonus',
      description: 'Welcome bonus — Loyalty signup',
      sync_status: 'pending',
    });

    console.log(`[LOYALTY-SIGNUP] New member created: ${email} — ${SIGNUP_BONUS} pts signup bonus applied`);
    return Response.json({
      status: 'success',
      member_id: member.id,
      total_points: SIGNUP_BONUS,
      message: 'Loyalty member created with signup bonus'
    });
  } catch (error) {
    console.error('[LOYALTY-SIGNUP] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});