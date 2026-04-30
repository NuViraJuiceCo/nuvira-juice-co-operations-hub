import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * syncLoyaltyRewards — receives loyalty data from Customer App → Hub.
 * SOURCE OF TRUTH: LoyaltyMember entity.
 * PROTECTION: Never overwrites points with null, zero, or lower values unless
 * it is an explicit, valid redemption (type = 'redeemed').
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    const secret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
    const authHeader = req.headers.get('authorization')?.replace('Bearer ', '');
    const isAdmin = user?.role === 'admin';
    const isValidSecret = authHeader === secret;

    if (!isAdmin && !isValidSecret) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const customersToSync = payload.customers || [];

    if (customersToSync.length === 0) {
      return Response.json({
        status: 'ready',
        message: 'Loyalty sync ready. Awaiting customer app webhook data.',
        synced: 0
      });
    }

    const results = [];
    for (const customerData of customersToSync) {
      const email = customerData.customer_email || customerData.email;
      if (!email) {
        results.push({ email: null, action: 'skipped', reason: 'no_email' });
        continue;
      }

      try {
        const existing = await base44.asServiceRole.entities.LoyaltyMember.filter({ email });

        const incomingTotal = customerData.total_points;
        const incomingLifetime = customerData.lifetime_points;

        if (existing && existing.length > 0) {
          const member = existing[0];
          const currentTotal = member.total_points || 0;
          const currentLifetime = member.lifetime_points || 0;

          // PROTECTION: Never overwrite with null, blank, or lower points unless it is a valid redemption
          // A valid redemption: incoming total < current AND there is a 'redeemed' entry in incoming history
          const hasRedemptionEntry = (customerData.points_history || []).some(h => h.type === 'redeemed');
          const isValidRedemption = incomingTotal < currentTotal && hasRedemptionEntry;

          const safeTotal = (incomingTotal != null && (incomingTotal >= currentTotal || isValidRedemption))
            ? incomingTotal
            : currentTotal;

          const safeLifetime = (incomingLifetime != null && incomingLifetime >= currentLifetime)
            ? incomingLifetime
            : currentLifetime;

          if (safeTotal === currentTotal && safeLifetime === currentLifetime) {
            results.push({ email, action: 'skipped', reason: 'no_meaningful_change' });
            continue;
          }

          const updateData = {
            total_points: safeTotal,
            lifetime_points: safeLifetime,
          };
          if (customerData.redeemed_points != null) {
            updateData.redeemed_points = customerData.redeemed_points;
          }
          if (customerData.points_history && customerData.points_history.length > 0) {
            updateData.points_history = customerData.points_history;
          }
          if (customerData.full_name) updateData.full_name = customerData.full_name;
          if (customerData.phone) updateData.phone = customerData.phone;

          await base44.asServiceRole.entities.LoyaltyMember.update(member.id, updateData);
          results.push({ email, action: 'updated', total_points: safeTotal });
        } else {
          // New member — create with whatever points came in (minimum 0)
          await base44.asServiceRole.entities.LoyaltyMember.create({
            email,
            full_name: customerData.full_name || '',
            phone: customerData.phone || '',
            signup_date: customerData.signup_date || new Date().toISOString().split('T')[0],
            status: 'active',
            total_points: incomingTotal || 0,
            lifetime_points: incomingLifetime || 0,
            redeemed_points: customerData.redeemed_points || 0,
            points_history: customerData.points_history || [],
          });
          results.push({ email, action: 'created', total_points: incomingTotal || 0 });
        }
      } catch (err) {
        results.push({ email, action: 'failed', error: err.message });
      }
    }

    console.log(`[SYNC-LOYALTY] Synced ${results.length} loyalty records`);
    return Response.json({ status: 'success', synced: results.length, results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});