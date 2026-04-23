import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { customer_id, reward_id } = await req.json();

    if (!customer_id || !reward_id) {
      return Response.json({ error: 'Customer ID and Reward ID required' }, { status: 400 });
    }

    // Get customer loyalty record
    const customer = await base44.entities.CustomerLoyalty.get(customer_id);
    if (!customer) {
      return Response.json({ error: 'Customer not found' }, { status: 404 });
    }

    // Get reward details
    const reward = await base44.entities.Rewards.get(reward_id);
    if (!reward) {
      return Response.json({ error: 'Reward not found' }, { status: 404 });
    }

    // Check if customer has enough points
    if (customer.total_points < reward.points_required) {
      return Response.json({ error: 'Insufficient points' }, { status: 400 });
    }

    // Deduct points
    const newTotal = customer.total_points - reward.points_required;
    const newRedeemed = (customer.redeemed_points || 0) + reward.points_required;
    
    // Add to points history
    const redemptionEntry = {
      amount: reward.points_required,
      type: 'redeemed',
      description: `Redeemed: ${reward.title}`,
      reward_id: reward_id,
      timestamp: new Date().toISOString(),
    };

    const updatedHistory = [...(customer.points_history || []), redemptionEntry];

    // Update customer record
    await base44.entities.CustomerLoyalty.update(customer_id, {
      total_points: newTotal,
      redeemed_points: newRedeemed,
      points_history: updatedHistory,
    });

    // Add to UserPoints for tracking
    await base44.entities.UserPoints.create({
      customer_email: customer.customer_email,
      amount: -reward.points_required,
      type: 'redeemed',
      description: `Redeemed: ${reward.title}`,
      reward_id: reward_id,
    });

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