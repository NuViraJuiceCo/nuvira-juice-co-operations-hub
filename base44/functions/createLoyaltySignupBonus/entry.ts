import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();
    const { event, data } = payload;

    if (!data || !data.email) {
      return Response.json({ error: 'Missing email' }, { status: 400 });
    }

    // Create initial signup bonus UserPoints record
    const userPoints = await base44.asServiceRole.entities.UserPoints.create({
      customer_email: data.email,
      amount: 100,
      type: 'bonus',
      description: 'Welcome bonus - Loyalty signup',
      sync_status: 'pending'
    });

    console.log(`[SIGNUP-BONUS] Created 100pt signup bonus for ${data.email}`);
    return Response.json({ 
      status: 'success',
      points_id: userPoints.id,
      message: '100pt signup bonus created'
    });
  } catch (error) {
    console.error('Signup bonus error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});