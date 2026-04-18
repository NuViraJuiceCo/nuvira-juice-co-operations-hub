import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

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

    // Check if member already exists
    const existing = await base44.asServiceRole.entities.LoyaltyMember.filter({ email });
    
    if (existing && existing.length > 0) {
      return Response.json({ 
        status: 'exists',
        message: 'Member already registered',
        member_id: existing[0].id
      });
    }

    // Create new loyalty member
    const member = await base44.asServiceRole.entities.LoyaltyMember.create({
      email,
      full_name,
      phone,
      signup_date: signup_date || new Date().toISOString().split('T')[0],
      status: 'active'
    });

    // Also create CustomerLoyalty record for dashboard
    await base44.asServiceRole.entities.CustomerLoyalty.create({
      customer_email: email,
      total_points: 100,
      lifetime_points: 100,
      redeemed_points: 0,
      points_history: [{
        amount: 100,
        type: 'bonus',
        description: 'Welcome bonus - Loyalty signup',
        timestamp: new Date().toISOString()
      }]
    });

    console.log(`[LOYALTY-SIGNUP] New member created: ${email}`);
    return Response.json({ 
      status: 'success',
      member_id: member.id,
      message: 'Loyalty member created successfully'
    });
  } catch (error) {
    console.error('Signup error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});