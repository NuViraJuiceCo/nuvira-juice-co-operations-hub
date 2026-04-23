import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CUSTOMER_APP_API = Deno.env.get('CUSTOMER_APP_API_URL');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

// Shared validation
function validateSync(syncSecret) {
  if (!syncSecret || syncSecret !== SYNC_SECRET) {
    throw { status: 401, message: 'Invalid sync secret' };
  }
}

// Enroll: POST /loyaltySync with action=enroll
async function enrollMember(base44, memberData) {
  const { email, full_name, phone, signup_date, status, total_points, lifetime_points, redeemed_points, points_history } = memberData;

  if (!email) {
    throw { status: 400, message: 'Email required' };
  }

  // Check for duplicate
  const existing = await base44.asServiceRole.entities.Loyalty.filter({ email });
  if (existing?.length > 0) {
    return { success: true, member_id: existing[0].id, total_points: existing[0].total_points, note: 'Member already enrolled' };
  }

  // Create single Loyalty record with profile + points
  const loyalty = await base44.asServiceRole.entities.Loyalty.create({
    email,
    full_name: full_name || email.split('@')[0],
    phone: phone || '',
    signup_date: signup_date || new Date().toISOString().split('T')[0],
    status: status || 'active',
    total_points: total_points || 0,
    lifetime_points: lifetime_points || 0,
    redeemed_points: redeemed_points || 0,
    points_history: points_history || []
  });

  // Record enrollment bonus if provided
  if (total_points > 0 && (!points_history || points_history.length === 0)) {
    await base44.asServiceRole.entities.UserPoints.create({
      customer_email: email,
      amount: total_points,
      type: 'earned',
      description: points_history?.[0]?.description || 'Pre-order enrollment bonus',
      sync_status: 'synced'
    });
  }

  console.log(`[LOYALTY-ENROLL] Enrolled ${email} with ${total_points}pt`);
  return { success: true, member_id: loyalty.id, total_points };
}

// Claim: POST /loyaltySync with action=claim
async function claimReward(base44, claimData) {
  const { customer_email, email, reward_id, reward_title, reward_type, claimed_at } = claimData;
  const emailToUse = email || customer_email;

  if (!emailToUse || !reward_id) {
    throw { status: 400, message: 'email and reward_id required' };
  }

  const existing = await base44.asServiceRole.entities.Loyalty.filter({ email: emailToUse });
  if (!existing?.length) {
    throw { status: 404, message: 'Member not found' };
  }

  const loyalty = existing[0];
  const rewardDetails = await base44.asServiceRole.entities.Rewards.get(reward_id);
  if (!rewardDetails) {
    throw { status: 404, message: 'Reward not found' };
  }

  // Deduct points
  const newTotal = (loyalty.total_points || 0) - rewardDetails.points_required;
  const newRedeemed = (loyalty.redeemed_points || 0) + rewardDetails.points_required;

  const updatedLoyalty = await base44.asServiceRole.entities.Loyalty.update(loyalty.id, {
    total_points: newTotal,
    redeemed_points: newRedeemed,
    points_history: [
      ...(loyalty.points_history || []),
      {
        amount: rewardDetails.points_required,
        type: 'redeemed',
        description: `Redeemed: ${reward_title}`,
        reward_id,
        timestamp: claimed_at || new Date().toISOString()
      }
    ]
  });

  // Record in UserPoints
  await base44.asServiceRole.entities.UserPoints.create({
    customer_email: emailToUse,
    amount: -rewardDetails.points_required,
    type: 'redeemed',
    description: `Claimed reward: ${reward_title}`,
    reward_id,
    claimed_rewards: [{
      reward_id,
      reward_title,
      points_redeemed: rewardDetails.points_required,
      claimed_at: claimed_at || new Date().toISOString()
    }],
    sync_status: 'synced'
  });

  console.log(`[LOYALTY-CLAIM] ${emailToUse} claimed ${reward_title}`);
  return { success: true, claimed_rewards: updatedLoyalty.points_history?.filter(h => h.type === 'redeemed') || [] };
}

// Query: GET /loyaltySync?action=query&email={email}
async function queryMember(base44, email) {
  if (!email) {
    throw { status: 400, message: 'Email required' };
  }

  const loyalty = await base44.asServiceRole.entities.Loyalty.filter({ email });
  if (!loyalty?.length) {
    throw { status: 404, message: 'Member not found' };
  }

  const member = loyalty[0];
  const claimed = member.points_history?.filter(h => h.type === 'redeemed') || [];

  return {
    email: member.email,
    full_name: member.full_name || '',
    total_points: member.total_points || 0,
    lifetime_points: member.lifetime_points || 0,
    redeemed_points: member.redeemed_points || 0,
    points_history: member.points_history || [],
    claimed_rewards: claimed.map(c => ({ reward_id: c.reward_id, reward_title: c.description, points_redeemed: c.amount, claimed_at: c.timestamp }))
  };
}

// Update: POST /loyaltySync with action=update (from UserPoints trigger)
async function updatePoints(base44, updateData) {
  const { customer_email, email, total_points, lifetime_points, redeemed_points, points_history, claimed_rewards } = updateData;
  const emailToUse = email || customer_email;

  if (!emailToUse) {
    throw { status: 400, message: 'email required' };
  }

  const existing = await base44.asServiceRole.entities.Loyalty.filter({ email: emailToUse });
  if (!existing?.length) {
    throw { status: 404, message: 'Member not found' };
  }

  await base44.asServiceRole.entities.Loyalty.update(existing[0].id, {
    total_points: total_points !== undefined ? total_points : existing[0].total_points,
    lifetime_points: lifetime_points !== undefined ? lifetime_points : existing[0].lifetime_points,
    redeemed_points: redeemed_points !== undefined ? redeemed_points : existing[0].redeemed_points,
    points_history: points_history || existing[0].points_history
  });

  console.log(`[LOYALTY-UPDATE] Updated points for ${emailToUse}`);
  return { success: true, email: emailToUse };
}

// Main handler
Deno.serve(async (req) => {
  try {
    if (req.method === 'GET') {
      // GET /loyaltySync?action=query&email=...&token=...
      const url = new URL(req.url);
      const action = url.searchParams.get('action');
      const syncToken = url.searchParams.get('token');

      validateSync(syncToken);
      const base44 = createClientFromRequest(req);
      const user = await base44.auth.me();
      if (!user?.role === 'admin') {
        return Response.json({ error: 'Admin access required' }, { status: 403 });
      }

      if (action === 'query') {
        const email = url.searchParams.get('email');
        const result = await queryMember(base44, email);
        return Response.json(result);
      }

      throw { status: 400, message: 'Unknown action' };
    }

    if (req.method === 'POST') {
      const payload = await req.json();
      const { action, token, ...data } = payload;

      // Validate token for external calls
      if (action !== 'update') {
        validateSync(token);
      }

      const base44 = createClientFromRequest(req);
      const user = await base44.auth.me();
      if (!user && action !== 'enroll' && action !== 'claim') {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }

      let result;
      switch (action) {
        case 'enroll':
          result = await enrollMember(base44, data);
          break;
        case 'claim':
          result = await claimReward(base44, data);
          break;
        case 'update':
          if (user?.role !== 'admin') {
            return Response.json({ error: 'Admin access required' }, { status: 403 });
          }
          result = await updatePoints(base44, data);
          break;
        default:
          throw { status: 400, message: 'Unknown action' };
      }

      return Response.json(result);
    }

    throw { status: 405, message: 'Method not allowed' };
  } catch (error) {
    console.error('[LOYALTY-SYNC-ERROR]', error);
    const status = error.status || 500;
    const message = error.message || error.toString();
    return Response.json({ error: message }, { status });
  }
});