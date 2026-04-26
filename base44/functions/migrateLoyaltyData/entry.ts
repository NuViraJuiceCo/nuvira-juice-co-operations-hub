import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { confirm_migrate } = body;

    // If no confirmation flag, return plan only
    if (!confirm_migrate) {
      const loyaltyMembers = await base44.asServiceRole.entities.LoyaltyMember.list('', 1000);
      let customerLoyalties = [];
      try {
        customerLoyalties = await base44.asServiceRole.entities.CustomerLoyalty.list('', 1000);
      } catch (err) {
        customerLoyalties = [];
      }
      return Response.json({
        success: true,
        action: 'plan_only',
        message: 'MANUAL APPROVAL REQUIRED: Call with confirm_migrate=true to execute migration',
        stats: {
          loyalty_members_to_migrate: loyaltyMembers?.length || 0,
          customer_loyalties_to_merge: customerLoyalties?.length || 0
        },
        warning: 'This is a data migration. Review carefully before executing.'
      }, { status: 200 });
    }

    // Fetch all LoyaltyMember and old CustomerLoyalty data
    const loyaltyMembers = await base44.asServiceRole.entities.LoyaltyMember.list('', 1000);
    
    // Try to get CustomerLoyalty data if it still exists
    let customerLoyalties = [];
    try {
      customerLoyalties = await base44.asServiceRole.entities.CustomerLoyalty.list('', 1000);
    } catch (err) {
      console.log('CustomerLoyalty entity not found or empty');
    }

    // Create a map of CustomerLoyalty by email
    const loyaltyMap = {};
    if (Array.isArray(customerLoyalties)) {
      customerLoyalties.forEach(cl => {
        if (cl.customer_email) {
          loyaltyMap[cl.customer_email.toLowerCase()] = cl;
        }
      });
    }

    // Merge data into LoyaltyMembers
    const updated = [];
    for (const member of loyaltyMembers) {
      const emailKey = member.email?.toLowerCase();
      const matchingLoyalty = loyaltyMap[emailKey];

      if (matchingLoyalty) {
        // Update member with points data
        await base44.asServiceRole.entities.LoyaltyMember.update(member.id, {
          total_points: matchingLoyalty.total_points || 0,
          lifetime_points: matchingLoyalty.lifetime_points || 0,
          redeemed_points: matchingLoyalty.redeemed_points || 0,
          points_history: matchingLoyalty.points_history || []
        });
        updated.push({ email: member.email, status: 'migrated' });
      }
    }

    console.log(`[MIGRATE] Updated ${updated.length} members with points data`);
    return Response.json({ status: 'success', migrated: updated.length, updated });
  } catch (error) {
    console.error('Migration error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});