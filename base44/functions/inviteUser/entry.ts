import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });

    const { email, role } = await req.json();

    if (!email) {
      return Response.json({ error: 'Email required' }, { status: 400 });
    }

    // Admin can only invite 'user' or 'admin' roles
    const allowedRoles = ['user', 'admin'];
    const targetRole = role || 'user';
    if (!allowedRoles.includes(targetRole)) {
      return Response.json({ error: `Invalid role. Must be one of: ${allowedRoles.join(', ')}` }, { status: 400 });
    }

    await base44.users.inviteUser(email, targetRole);
    
    return Response.json({ status: 'success', message: `User ${email} invited as ${role || 'user'}` });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});