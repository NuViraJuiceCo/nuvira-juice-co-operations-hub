import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * redeemReward — deducts points from LoyaltyMember (source of truth).
 * Logs to UserPoints for audit trail.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { customer_email, reward_id } = await req.json();

    if (!customer_email || !reward_id) {
      return Response.json({ error: 'customer_email and reward_id required' }, { status: 400 });
    }

    // Get loyalty member (source of truth)
    const members = await base44.asServiceRole.entities.LoyaltyMember.filter({ email: customer_email });
    if (!members || members.length === 0) {
      return Response.json({ error: 'Loyalty member not found' }, { status: 404 });
    }
    const member = members[0];

    // Get reward details
    const reward = await base44.asServiceRole.entities.Rewards.get(reward_id);
    if (!reward) {
      return Response.json({ error: 'Reward not found' }, { status: 404 });
    }

    if ((member.total_points || 0) < reward.points_required) {
      return Response.json({ error: 'Insufficient points' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const newTotal = member.total_points - reward.points_required;
    const newRedeemed = (member.redeemed_points || 0) + reward.points_required;

    const redemptionEntry = {
      amount: reward.points_required,
      type: 'redeemed',
      description: `Redeemed: ${reward.title}`,
      reward_id,
      timestamp: now,
    };

    const updatedHistory = [...(member.points_history || []), redemptionEntry];

    // Update LoyaltyMember — source of truth
    await base44.asServiceRole.entities.LoyaltyMember.update(member.id, {
      total_points: newTotal,
      redeemed_points: newRedeemed,
      points_history: updatedHistory,
    });

    // Log to UserPoints for audit trail
    await base44.asServiceRole.entities.UserPoints.create({
      customer_email,
      amount: -reward.points_required,
      type: 'redeemed',
      description: `Redeemed: ${reward.title}`,
      reward_id,
      sync_status: 'pending',
      claimed_rewards: [{
        reward_id,
        reward_title: reward.title,
        points_redeemed: reward.points_required,
        claimed_at: now,
      }],
    });

    console.log(`[REDEEM] ${customer_email} redeemed ${reward.points_required} pts for "${reward.title}" (${member.total_points} → ${newTotal})`);
    return Response.json({
      status: 'success',
      message: `${reward.title} redeemed`,
      new_total_points: newTotal,
      points_deducted: reward.points_required,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});