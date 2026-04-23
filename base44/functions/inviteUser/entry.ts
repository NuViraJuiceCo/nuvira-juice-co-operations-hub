import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { email, role } = await req.json();

    if (!email) {
      return Response.json({ error: 'Email required' }, { status: 400 });
    }

    await base44.users.inviteUser(email, role || 'user');
    
    return Response.json({ status: 'success', message: `User ${email} invited as ${role || 'user'}` });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});